use crate::model;
use crate::paths;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::env;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const RELEASES_URL: &str = "https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=30";
const DOWNLOAD_PREFIX: &str = "https://github.com/ggml-org/whisper.cpp/releases/download/";
const RELEASES_PER_BUILD: usize = 2;
const PINNED: &[(&str, &str, &str)] = &[
    ("b5907", "whisper-bin-x64.zip", "ecca07b277d943e9b9f4712856a144b857271a6b333104e511e1988e80db582b"),
    ("b5907", "whisper-bin-win-cuda-12.4.0-x64.zip", "34f872ce724ca1ff0a4afca481853e5ee74250f8cb22153e499f953562846039"),
    ("b5907", "whisper-bin-win-cpu-arm64.zip", "4e522946827dcbc517d3cd7ee8d6cfe760e8143076924ac8513622694aa3ccfd"),
    ("b5907", "whisper-bin-ubuntu-x64.tar.gz", "a6199027fe5b4239c84171d2bca4c0ff44ec86a515494d5a39b237b212d429bd"),
    ("b5907", "whisper-bin-ubuntu-arm64.tar.gz", "da2e86ac058e1db0281167355428665b82c0d92e4506d186a3894bec55ceefef"),
];

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Build {
    Cuda,
    Cpu,
}

#[derive(Debug, PartialEq)]
pub struct Asset {
    pub release: String,
    pub name: String,
    pub url: String,
    pub build: Build,
    pub sha256: Option<String>,
    pub size: Option<u64>,
}

pub struct Installed {
    pub server: PathBuf,
    pub build: Build,
}

type Matcher = (Build, fn(&str) -> bool);

pub fn matchers(os: &str, arch: &str, nvidia: bool) -> Vec<Matcher> {
    let mut list: Vec<Matcher> = Vec::new();
    match (os, arch) {
        ("windows", "x86_64") => {
            if nvidia {
                list.push((Build::Cuda, |n| n.starts_with("whisper-bin-win-cuda-12") && n.ends_with("-x64.zip")));
                list.push((Build::Cuda, |n| n.starts_with("whisper-cublas-12") && n.ends_with("-bin-x64.zip")));
            }
            list.push((Build::Cpu, |n| n == "whisper-bin-x64.zip"));
        }
        ("windows", "aarch64") => list.push((Build::Cpu, |n| n == "whisper-bin-win-cpu-arm64.zip")),
        ("linux", "x86_64") => list.push((Build::Cpu, |n| n == "whisper-bin-ubuntu-x64.tar.gz")),
        ("linux", "aarch64") => list.push((Build::Cpu, |n| n == "whisper-bin-ubuntu-arm64.tar.gz")),
        _ => {}
    }
    list
}

#[cfg(windows)]
pub fn native_arch() -> &'static str {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> isize;
        fn IsWow64Process2(process: isize, process_machine: *mut u16, native_machine: *mut u16) -> i32;
    }
    const IMAGE_FILE_MACHINE_ARM64: u16 = 0xAA64;
    const IMAGE_FILE_MACHINE_AMD64: u16 = 0x8664;
    let (mut process, mut native) = (0u16, 0u16);
    let ok = unsafe { IsWow64Process2(GetCurrentProcess(), &mut process, &mut native) } != 0;
    match (ok, native) {
        (true, IMAGE_FILE_MACHINE_ARM64) => "aarch64",
        (true, IMAGE_FILE_MACHINE_AMD64) => "x86_64",
        _ => env::consts::ARCH,
    }
}

#[cfg(not(windows))]
pub fn native_arch() -> &'static str {
    env::consts::ARCH
}

pub fn wrong_arch_build(os: &str, arch: &str, server: &Path) -> bool {
    os == "windows" && arch == "aarch64" && server.to_string_lossy().contains("-x64")
}

pub fn supported() -> bool {
    !matchers(env::consts::OS, native_arch(), false).is_empty()
}

pub fn choose(releases: &Value, matchers: &[Matcher]) -> Vec<Asset> {
    let releases = releases.as_array().map(Vec::as_slice).unwrap_or_default();
    let mut chosen: Vec<Asset> = Vec::new();
    for (build, matches) in matchers {
        let found = releases.iter().filter_map(|release| {
            let assets = release.get("assets")?.as_array()?;
            let asset = assets.iter().find(|a| a.get("name").and_then(Value::as_str).is_some_and(matches))?;
            let url = asset.get("browser_download_url")?.as_str()?;
            if !url.starts_with(DOWNLOAD_PREFIX) {
                return None;
            }
            Some(Asset {
                release: release.get("tag_name")?.as_str()?.to_string(),
                name: asset.get("name")?.as_str()?.to_string(),
                url: url.to_string(),
                build: *build,
                sha256: asset
                    .get("digest")
                    .and_then(Value::as_str)
                    .and_then(|d| d.strip_prefix("sha256:"))
                    .map(str::to_lowercase),
                size: asset.get("size").and_then(Value::as_u64),
            })
        });
        let already = chosen.iter().filter(|c| c.build == *build).count();
        for asset in found.take(RELEASES_PER_BUILD.saturating_sub(already)) {
            if !chosen.iter().any(|c| c.url == asset.url) {
                chosen.push(asset);
            }
        }
    }
    chosen
}

pub fn pinned() -> Value {
    let mut releases: Vec<Value> = Vec::new();
    for (tag, name, sha) in PINNED {
        let asset = json!({
            "name": name,
            "browser_download_url": format!("{DOWNLOAD_PREFIX}{tag}/{name}"),
            "digest": format!("sha256:{sha}"),
        });
        match releases.iter_mut().find(|r| r["tag_name"] == *tag) {
            Some(release) => release["assets"].as_array_mut().unwrap().push(asset),
            None => releases.push(json!({ "tag_name": tag, "assets": [asset] })),
        }
    }
    Value::Array(releases)
}

pub fn sha256_of(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    io::copy(&mut file, &mut hasher).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn nvidia_present() -> bool {
    Command::new("nvidia-smi")
        .arg("-L")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

fn candidates(releases: &Value, matchers: &[Matcher]) -> Vec<Asset> {
    let mut list = choose(&pinned(), matchers);
    for asset in choose(releases, matchers) {
        if !list.iter().any(|c| c.url == asset.url) {
            list.push(asset);
        }
    }
    list.sort_by_key(|a| matchers.iter().position(|(build, _)| *build == a.build));
    list
}

fn remove_other_versions(keep: &Path) {
    let Ok(entries) = fs::read_dir(paths::whisper_dir()) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && path != keep {
            let _ = fs::remove_dir_all(&path);
        }
    }
}

fn fetch_releases() -> Result<Value, String> {
    let mut request = ureq::get(RELEASES_URL)
        .set("User-Agent", "titl")
        .set("Accept", "application/vnd.github+json");
    if let Ok(token) = env::var("GITHUB_TOKEN") {
        request = request.set("Authorization", &format!("Bearer {token}"));
    }
    let text = request
        .call()
        .map_err(|e| format!("cannot list whisper.cpp releases: {e}"))?
        .into_string()
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("unexpected answer from GitHub: {e}"))
}

pub fn find_server_in(dir: &Path) -> Option<PathBuf> {
    let name = paths::exe_name("whisper-server");
    let mut stack = vec![(dir.to_path_buf(), 0)];
    while let Some((current, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&current) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && depth < 4 {
                stack.push((path, depth + 1));
            } else if path.file_name().is_some_and(|n| n == name.as_str()) {
                return Some(path);
            }
        }
    }
    None
}

fn library_version(name: &str) -> Option<String> {
    let rest = name.strip_prefix("libwhisper.")?;
    let version = rest.strip_suffix(".dylib").or_else(|| rest.strip_prefix("so."))?;
    let full = version.split('.').count() == 3 && version.split('.').all(|n| n.parse::<u32>().is_ok());
    full.then(|| version.to_string())
}

pub fn handles_vad(version: Option<&str>) -> bool {
    let Some(version) = version else { return false };
    if let Some(build) = version.strip_prefix('b') {
        return build.parse::<u32>().is_ok_and(|n| n >= 5907);
    }
    let numbers: Vec<u32> = version.split('.').filter_map(|n| n.parse().ok()).collect();
    numbers.len() == 3 && numbers >= vec![1, 9, 6]
}

pub fn version(server: &Path) -> Option<String> {
    let server = fs::canonicalize(server).ok()?;
    let dir = server.parent()?;
    let mut folders = vec![dir.to_path_buf()];
    folders.extend(dir.parent().map(|up| up.join("lib")));
    folders
        .iter()
        .filter_map(|folder| fs::read_dir(folder).ok())
        .flat_map(|entries| entries.flatten())
        .find_map(|entry| library_version(entry.file_name().to_str()?))
        .or_else(|| {
            server.ancestors().find_map(|folder| {
                let (build, _) = folder.file_name()?.to_str()?.split_once("-whisper-")?;
                let number = build.strip_prefix('b')?;
                number.parse::<u32>().is_ok().then(|| build.to_string())
            })
        })
}

pub fn downloaded_server() -> Option<PathBuf> {
    let dir = paths::whisper_dir();
    let mut releases: Vec<PathBuf> = fs::read_dir(&dir).ok()?.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    releases.sort();
    releases.iter().rev().find_map(|r| find_server_in(r))
}

fn unpack(archive: &Path, into: &Path) -> Result<(), String> {
    let file = File::open(archive).map_err(|e| format!("{}: {e}", archive.display()))?;
    if archive.extension().is_some_and(|e| e == "zip") {
        zip::ZipArchive::new(file)
            .and_then(|mut z| z.extract(into))
            .map_err(|e| format!("cannot unpack {}: {e}", archive.display()))
    } else {
        tar::Archive::new(flate2::read::GzDecoder::new(file))
            .unpack(into)
            .map_err(|e| format!("cannot unpack {}: {e}", archive.display()))
    }
}

fn runs(server: &Path) -> bool {
    let Ok(mut child) = Command::new(server)
        .arg("-h")
        .current_dir(server.parent().unwrap_or(Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    else {
        return false;
    };
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if let Ok(Some(status)) = child.try_wait() {
            return status.success();
        }
        thread::sleep(Duration::from_millis(200));
    }
    let _ = child.kill();
    false
}

fn install_dir(asset: &Asset) -> PathBuf {
    paths::whisper_dir().join(format!("{}-{}", asset.release, asset.name.replace(['.', ' '], "_")))
}

fn install_asset(asset: &Asset) -> Result<PathBuf, String> {
    let dir = install_dir(asset);
    if let Some(server) = find_server_in(&dir).filter(|s| runs(s)) {
        return Ok(server);
    }
    let _ = fs::remove_dir_all(&dir);
    let archive = paths::whisper_dir().join(&asset.name);
    model::fetch(&asset.url, &archive, None)?;
    if let Some(expected) = &asset.sha256 {
        let actual = sha256_of(&archive)?;
        if &actual != expected {
            let _ = fs::remove_file(&archive);
            return Err(format!("{} failed its checksum (expected {expected}, got {actual})", asset.name));
        }
        println!("  checksum ok");
    }
    let staging = dir.with_extension("partial");
    let _ = fs::remove_dir_all(&staging);
    let unpacked = unpack(&archive, &staging);
    let _ = fs::remove_file(&archive);
    unpacked?;
    fs::rename(&staging, &dir).map_err(|e| format!("cannot move {} into place: {e}", dir.display()))?;
    let server = find_server_in(&dir).ok_or_else(|| format!("no whisper-server in {}", asset.name))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&server, fs::Permissions::from_mode(0o755));
    }
    if !runs(&server) {
        let _ = fs::remove_dir_all(&dir);
        return Err(format!("{} does not run on this computer", asset.name));
    }
    Ok(server)
}

pub fn download(cpu_only: bool) -> Result<Installed, String> {
    if cfg!(target_os = "macos") {
        return Err("on macOS, install whisper.cpp with Homebrew: brew install whisper.cpp".into());
    }
    let nvidia = !cpu_only && nvidia_present();
    let matchers = matchers(env::consts::OS, native_arch(), nvidia);
    let releases = fetch_releases().unwrap_or_else(|e| {
        println!("{e}; only the pinned build is available.");
        Value::Null
    });
    let candidates = candidates(&releases, &matchers);
    if candidates.is_empty() {
        return Err(format!(
            "no prebuilt whisper.cpp for {}/{}: build it (https://github.com/ggml-org/whisper.cpp) and pass --server PATH",
            env::consts::OS,
            native_arch()
        ));
    }
    let mut last_error = String::new();
    for asset in &candidates {
        let size = asset.size.map(|s| format!(", {} MB", s >> 20)).unwrap_or_default();
        println!("Installing whisper.cpp {} ({}{size}).", asset.release, asset.name);
        match install_asset(asset) {
            Ok(server) => {
                remove_other_versions(&install_dir(asset));
                return Ok(Installed { server, build: asset.build });
            }
            Err(e) => {
                println!("  {e}");
                last_error = e;
            }
        }
    }
    Err(last_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn release(tag: &str, names: &[&str]) -> Value {
        json!({
            "tag_name": tag,
            "assets": names.iter().map(|n| json!({ "name": n, "browser_download_url": format!("{DOWNLOAD_PREFIX}{tag}/{n}") })).collect::<Vec<_>>(),
        })
    }

    fn picked(assets: &[Asset]) -> Vec<(String, String, Build)> {
        assets.iter().map(|a| (a.release.clone(), a.name.clone(), a.build)).collect()
    }

    #[test]
    fn windows_with_nvidia_prefers_cuda_then_falls_back_to_cpu() {
        let releases = json!([
            release("v1.9.5", &[]),
            release("b5454", &["whisper-bin-x64.zip", "whisper-bin-win-cuda-12.4.0-x64.zip", "whisper-bin-win-cuda-11.8.0-x64.zip"]),
        ]);
        assert_eq!(
            picked(&choose(&releases, &matchers("windows", "x86_64", true))),
            vec![
                ("b5454".into(), "whisper-bin-win-cuda-12.4.0-x64.zip".into(), Build::Cuda),
                ("b5454".into(), "whisper-bin-x64.zip".into(), Build::Cpu),
            ]
        );
    }

    #[test]
    fn older_cublas_names_still_match() {
        let releases = json!([release("b5130", &["whisper-bin-x64.zip", "whisper-cublas-12.4.0-bin-x64.zip"])]);
        let chosen = choose(&releases, &matchers("windows", "x86_64", true));
        assert_eq!(chosen[0].name, "whisper-cublas-12.4.0-bin-x64.zip");
    }

    #[test]
    fn windows_without_nvidia_and_linux_use_cpu_builds() {
        let releases = json!([release("b1", &["whisper-bin-x64.zip", "whisper-bin-win-cuda-12.4.0-x64.zip", "whisper-bin-ubuntu-x64.tar.gz"])]);
        assert_eq!(choose(&releases, &matchers("windows", "x86_64", false))[0].name, "whisper-bin-x64.zip");
        assert_eq!(choose(&releases, &matchers("linux", "x86_64", false))[0].name, "whisper-bin-ubuntu-x64.tar.gz");
        assert!(choose(&releases, &matchers("macos", "aarch64", false)).is_empty());
    }

    #[test]
    fn skips_releases_without_matching_files() {
        let releases = json!([release("v2", &["whisper-b2-xcframework.zip"]), release("b1", &["whisper-bin-ubuntu-x64.tar.gz"])]);
        assert_eq!(picked(&choose(&releases, &matchers("linux", "x86_64", false)))[0].0, "b1");
    }

    #[test]
    fn tries_the_previous_release_too_and_carries_checksums() {
        let mut newer = release("b2", &["whisper-bin-ubuntu-x64.tar.gz"]);
        newer["assets"][0]["digest"] = json!("sha256:ABC");
        newer["assets"][0]["size"] = json!(10485760);
        let releases = json!([newer, release("b1", &["whisper-bin-ubuntu-x64.tar.gz"]), release("b0", &["whisper-bin-ubuntu-x64.tar.gz"])]);
        let chosen = choose(&releases, &matchers("linux", "x86_64", false));
        assert_eq!(picked(&chosen).iter().map(|p| p.0.as_str()).collect::<Vec<_>>(), ["b2", "b1"]);
        assert_eq!(chosen[0].sha256.as_deref(), Some("abc"));
        assert_eq!(chosen[0].size, Some(10485760));
        assert_eq!(chosen[1].sha256, None);
    }

    #[test]
    fn ignores_downloads_outside_the_whisper_cpp_repository() {
        let releases = json!([{
            "tag_name": "b9",
            "assets": [{ "name": "whisper-bin-ubuntu-x64.tar.gz", "browser_download_url": "https://evil.example/whisper-bin-ubuntu-x64.tar.gz" }],
        }]);
        assert!(choose(&releases, &matchers("linux", "x86_64", false)).is_empty());
    }

    #[test]
    fn pinned_build_covers_every_supported_platform() {
        for (os, arch, nvidia) in [("windows", "x86_64", true), ("windows", "x86_64", false), ("windows", "aarch64", false), ("linux", "x86_64", false), ("linux", "aarch64", false)] {
            let chosen = choose(&pinned(), &matchers(os, arch, nvidia));
            assert!(!chosen.is_empty(), "{os}/{arch}");
            assert!(chosen.iter().all(|a| a.sha256.as_ref().is_some_and(|s| s.len() == 64)), "{os}/{arch}");
        }
        let cuda = choose(&pinned(), &matchers("windows", "x86_64", true));
        assert_eq!(cuda.iter().map(|a| a.build).collect::<Vec<_>>(), [Build::Cuda, Build::Cpu]);
    }

    #[test]
    fn the_pinned_build_comes_before_newer_and_older_ones() {
        let releases = json!([
            release("b9999", &["whisper-bin-x64.zip", "whisper-bin-win-cuda-12.4.0-x64.zip"]),
            release("b5907", &["whisper-bin-x64.zip", "whisper-bin-win-cuda-12.4.0-x64.zip"]),
        ]);
        let order = |list: Vec<Asset>| list.iter().map(|a| (a.release.clone(), a.build)).collect::<Vec<_>>();
        assert_eq!(
            order(candidates(&releases, &matchers("windows", "x86_64", true))),
            vec![
                ("b5907".into(), Build::Cuda),
                ("b9999".into(), Build::Cuda),
                ("b5907".into(), Build::Cpu),
                ("b9999".into(), Build::Cpu),
            ]
        );
        assert_eq!(order(candidates(&Value::Null, &matchers("linux", "x86_64", false))), vec![("b5907".into(), Build::Cpu)]);
        assert!(candidates(&releases, &matchers("macos", "aarch64", false)).is_empty());
    }

    #[test]
    fn speech_detection_is_only_safe_by_default_from_1_9_6() {
        for old in [None, Some("1.9.5"), Some("1.8.7"), Some("0.0.0"), Some("b5454"), Some("bxyz"), Some("1.9")] {
            assert!(!handles_vad(old), "{old:?}");
        }
        for new in ["1.9.6", "1.9.10", "1.10.0", "2.0.0", "b5907", "b9999"] {
            assert!(handles_vad(Some(new)), "{new}");
        }
    }

    #[test]
    fn reads_the_version_from_the_library_or_the_download_folder() {
        let root = std::env::temp_dir().join(format!("titl-version-{}", std::process::id()));
        let server = |folder: &str| {
            let path = root.join(folder).join(paths::exe_name("whisper-server"));
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, "").unwrap();
            path
        };
        let brew = server("Cellar/bin");
        fs::create_dir_all(root.join("Cellar/lib")).unwrap();
        fs::write(root.join("Cellar/lib/libwhisper.1.dylib"), "").unwrap();
        assert_eq!(version(&brew), None);
        fs::write(root.join("Cellar/lib/libwhisper.1.9.6.dylib"), "").unwrap();
        assert_eq!(version(&brew).as_deref(), Some("1.9.6"));
        let linux = server("linux");
        fs::write(root.join("linux/libwhisper.so.1.9.5"), "").unwrap();
        assert_eq!(version(&linux).as_deref(), Some("1.9.5"));
        assert_eq!(version(&server("b5907-whisper-bin-x64_zip/Release")).as_deref(), Some("b5907"));
        assert_eq!(version(&server("other/place")), None);
        assert_eq!(version(&root.join("missing")), None);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn finds_server_inside_unpacked_folders() {
        let root = std::env::temp_dir().join(format!("ct-wcpp-{}", std::process::id()));
        let server = root.join("b1/Release").join(paths::exe_name("whisper-server"));
        fs::create_dir_all(server.parent().unwrap()).unwrap();
        fs::write(&server, "").unwrap();
        assert_eq!(find_server_in(&root), Some(server));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn an_x64_build_on_arm64_windows_is_replaced() {
        let x64 = Path::new(r"C:\Users\u\AppData\Local\titl\whisper\b5907-whisper-bin-x64_zip\Release\whisper-server.exe");
        let arm = Path::new(r"C:\Users\u\AppData\Local\titl\whisper\b5907-whisper-bin-win-cpu-arm64_zip\Release\whisper-server.exe");
        assert!(wrong_arch_build("windows", "aarch64", x64));
        assert!(!wrong_arch_build("windows", "aarch64", arm));
        assert!(!wrong_arch_build("windows", "x86_64", x64));
        assert!(!wrong_arch_build("linux", "aarch64", x64));
    }

    #[test]
    fn arm64_windows_gets_the_native_cpu_build() {
        let releases = json!([release("b5907", &["whisper-bin-x64.zip", "whisper-bin-win-cpu-arm64.zip", "whisper-bin-win-cuda-13.5-arm64.zip"])]);
        assert_eq!(picked(&choose(&releases, &matchers("windows", "aarch64", false))), vec![("b5907".into(), "whisper-bin-win-cpu-arm64.zip".into(), Build::Cpu)]);
    }
}
