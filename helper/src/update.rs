use crate::paths;
use crate::whisper_cpp::sha256_of;
use serde_json::{json, Value};
use std::env;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::process::{self, Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const LATEST_URL: &str = "https://api.github.com/repos/rawmind/titl/releases/latest";
const DOWNLOAD_URL: &str = "https://github.com/rawmind/titl/releases/download";
const ASSET: &str = "titl-windows-x64.exe";
const CHECK_EVERY_SECS: u64 = 24 * 60 * 60;
const CHECK_TIMEOUT: Duration = Duration::from_secs(10);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_NOTES: usize = 6;
const MAX_NOTE_CHARS: usize = 120;
pub const CURRENT: &str = env!("CARGO_PKG_VERSION");

pub struct Release {
    pub version: String,
    pub notes: Vec<String>,
    pub url: String,
}

impl Release {
    fn to_json(&self) -> Value {
        json!({ "version": self.version, "notes": self.notes, "url": self.url })
    }

    fn from_json(value: &Value) -> Option<Self> {
        Some(Release {
            version: value.get("version")?.as_str()?.to_string(),
            notes: value
                .get("notes")?
                .as_array()?
                .iter()
                .filter_map(|n| n.as_str().map(String::from))
                .collect(),
            url: value.get("url")?.as_str()?.to_string(),
        })
    }
}

pub fn supported() -> bool {
    cfg!(windows)
}

pub fn parse_version(text: &str) -> Option<(u64, u64, u64)> {
    let mut parts = text.trim().trim_start_matches('v').splitn(3, '.');
    let mut next = || parts.next()?.parse().ok();
    Some((next()?, next()?, next()?))
}

pub fn newer(latest: &str, current: &str) -> bool {
    matches!((parse_version(latest), parse_version(current)), (Some(l), Some(c)) if l > c)
}

pub fn notes(body: &str) -> Vec<String> {
    let mut section = None;
    let mut out = Vec::new();
    for line in body.lines() {
        if let Some(heading) = line.strip_prefix("### ") {
            section = ["Fixed", "Added", "Changed"].into_iter().find(|s| *s == heading.trim());
            continue;
        }
        if line.starts_with("## ") {
            section = None;
            continue;
        }
        if let (Some(section), Some(item)) = (section, line.strip_prefix("- ")) {
            out.push(format!("{section}: {}", summary(item)));
        }
    }
    out.sort_by_key(|n| !n.starts_with("Fixed:"));
    out.truncate(MAX_NOTES);
    out
}

fn summary(item: &str) -> String {
    let text = match item.strip_prefix("**").and_then(|rest| rest.split_once("**")) {
        Some((bold, _)) => bold,
        None => item,
    };
    let text = plain(text);
    if text.chars().count() <= MAX_NOTE_CHARS {
        return text;
    }
    let cut: String = text.chars().take(MAX_NOTE_CHARS - 1).collect();
    format!("{}…", cut.trim_end())
}

fn plain(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(i) = rest.find('[') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        match after
            .split_once("](")
            .and_then(|(label, tail)| tail.split_once(')').map(|(_, tail)| (label, tail)))
        {
            Some((label, tail)) => {
                out.push_str(label);
                rest = tail;
            }
            None => {
                out.push('[');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out.replace(['`', '*'], "").trim().to_string()
}

fn latest_url() -> String {
    env::var("TITL_UPDATE_URL").unwrap_or_else(|_| LATEST_URL.to_string())
}

fn release_url() -> String {
    env::var("TITL_RELEASE_URL").unwrap_or_else(|_| DOWNLOAD_URL.to_string())
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn cache_path() -> PathBuf {
    paths::data_dir().join("update.json")
}

fn cached() -> Option<(u64, Release)> {
    let value: Value = serde_json::from_str(&fs::read_to_string(cache_path()).ok()?).ok()?;
    Some((value.get("checked")?.as_u64()?, Release::from_json(value.get("release")?)?))
}

fn fetch_latest() -> Result<Release, String> {
    let text = ureq::get(&latest_url())
        .set("User-Agent", "titl")
        .set("Accept", "application/vnd.github+json")
        .timeout(CHECK_TIMEOUT)
        .call()
        .map_err(|e| format!("cannot check for updates: {e}"))?
        .into_string()
        .map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_str(&text).map_err(|e| format!("unexpected answer from GitHub: {e}"))?;
    let tag = value.get("tag_name").and_then(Value::as_str).ok_or("GitHub sent no release tag")?;
    parse_version(tag).ok_or_else(|| format!("unexpected release tag {tag}"))?;
    Ok(Release {
        version: tag.trim_start_matches('v').to_string(),
        notes: notes(value.get("body").and_then(Value::as_str).unwrap_or("")),
        url: value.get("html_url").and_then(Value::as_str).unwrap_or(LATEST_URL).to_string(),
    })
}

pub fn check(force: bool) -> Result<Option<Release>, String> {
    if !supported() {
        return Ok(None);
    }
    let release = match cached() {
        Some((checked, release)) if !force && now().saturating_sub(checked) < CHECK_EVERY_SECS => release,
        _ => {
            let release = fetch_latest()?;
            let _ = fs::create_dir_all(paths::data_dir());
            let _ = fs::write(cache_path(), json!({ "checked": now(), "release": release.to_json() }).to_string());
            release
        }
    };
    Ok(newer(&release.version, CURRENT).then_some(release))
}

fn download(url: &str, dest: &Path) -> Result<(), String> {
    let response = ureq::get(url)
        .set("User-Agent", "titl")
        .timeout(DOWNLOAD_TIMEOUT)
        .call()
        .map_err(|e| format!("download failed: {e}"))?;
    let mut file = File::create(dest).map_err(|e| format!("cannot write {}: {e}", dest.display()))?;
    io::copy(&mut response.into_reader(), &mut file).map_err(|e| format!("download interrupted: {e}"))?;
    Ok(())
}

fn expected_sha(sums: &str, name: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let (hash, file) = line.split_once(char::is_whitespace)?;
        (file.trim().trim_start_matches('*') == name).then(|| hash.to_lowercase())
    })
}

fn reports_version(exe: &Path, version: &str) -> bool {
    Command::new(exe)
        .arg("--version")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .is_ok_and(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == format!("titl {version}"))
}

fn old_copy_prefix() -> &'static str {
    "titl.old-"
}

pub fn cleanup() {
    let Ok(entries) = fs::read_dir(paths::data_dir()) else { return };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(old_copy_prefix()) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

pub fn apply() -> Result<String, String> {
    if !supported() {
        return Err("automatic helper updates are only available on Windows".into());
    }
    let release = check(true)?.ok_or_else(|| format!("titl {CURRENT} is already the newest version"))?;
    let installed = paths::installed_exe();
    if !installed.is_file() {
        return Err(format!("{} not found: run `titl install` first", installed.display()));
    }
    let tag = format!("v{}", release.version);
    let base = release_url();
    let fresh = installed.with_file_name("titl.new.exe");
    let result = (|| {
        let sums = ureq::get(&format!("{base}/{tag}/SHA256SUMS"))
            .set("User-Agent", "titl")
            .timeout(CHECK_TIMEOUT)
            .call()
            .map_err(|e| format!("cannot download SHA256SUMS: {e}"))?
            .into_string()
            .map_err(|e| e.to_string())?;
        let expected = expected_sha(&sums, ASSET).ok_or_else(|| format!("{ASSET} is not listed in SHA256SUMS"))?;
        download(&format!("{base}/{tag}/{ASSET}"), &fresh)?;
        let actual = sha256_of(&fresh)?;
        if actual != expected {
            return Err(format!("checksum mismatch for {ASSET}: expected {expected}, got {actual}"));
        }
        if !reports_version(&fresh, &release.version) {
            return Err(format!("the downloaded helper does not report version {}", release.version));
        }
        let old = installed.with_file_name(format!("{}{}.exe", old_copy_prefix(), process::id()));
        fs::rename(&installed, &old).map_err(|e| format!("cannot move {} aside: {e}", installed.display()))?;
        if let Err(e) = fs::rename(&fresh, &installed) {
            let _ = fs::rename(&old, &installed);
            return Err(format!("cannot replace {}: {e}", installed.display()));
        }
        Ok(release.version.clone())
    })();
    let _ = fs::remove_file(&fresh);
    result
}

pub fn status_reply() -> Value {
    match check(false) {
        Ok(Some(release)) => json!({
            "status": "update",
            "current": CURRENT,
            "latest": release.version,
            "notes": release.notes,
            "url": release.url,
        }),
        Ok(None) => json!({ "status": "current", "current": CURRENT }),
        Err(e) => json!({ "status": "error", "error": e }),
    }
}

pub fn apply_reply() -> Value {
    match apply() {
        Ok(version) => json!({ "status": "updated", "version": version }),
        Err(e) => json!({ "status": "error", "error": e }),
    }
}

pub fn cli() -> Result<(), String> {
    if !supported() {
        return Err(if cfg!(target_os = "macos") {
            "`titl update` is only available on Windows; on macOS run `brew upgrade rawmind/tap/titl`".into()
        } else {
            "`titl update` is only available on Windows; download the new titl from https://github.com/rawmind/titl/releases/latest".into()
        });
    }
    let Some(release) = check(true)? else {
        println!("titl {CURRENT} is the newest version.");
        return Ok(());
    };
    println!("Updating titl {CURRENT} to {}:", release.version);
    for note in &release.notes {
        println!("  - {note}");
    }
    let version = apply()?;
    println!("Updated to titl {version}. Your browser uses it from the next Start.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions() {
        assert!(newer("0.1.15", "0.1.14"));
        assert!(newer("v0.2.0", "0.1.99"));
        assert!(!newer("0.1.14", "0.1.14"));
        assert!(!newer("0.1.9", "0.1.10"));
        assert!(!newer("latest", "0.1.14"));
    }

    #[test]
    fn summarises_release_notes_fixed_first() {
        let body = "### Added\n- **Easier setup on Windows.** Install with one line.\n  ```powershell\n  irm x | iex\n  ```\n\n### Fixed\n- **Translation works again.** Since 0.1.12 it failed.\n- A [linked](https://example.com) `code` fix.\n\n### Upgrade\n- macOS: `brew upgrade rawmind/tap/titl`\n";
        assert_eq!(
            notes(body),
            [
                "Fixed: Translation works again.",
                "Fixed: A linked code fix.",
                "Added: Easier setup on Windows.",
            ]
        );
    }

    #[test]
    fn shortens_long_notes() {
        let long = format!("### Changed\n- {}\n", "word ".repeat(60));
        let note = &notes(&long)[0];
        assert!(note.chars().count() <= "Changed: ".len() + MAX_NOTE_CHARS);
        assert!(note.ends_with('…'));
    }

    #[test]
    fn finds_the_windows_checksum() {
        let sums = "AAA  titl-linux-x64\nBBB *titl-windows-x64.exe\n";
        assert_eq!(expected_sha(sums, ASSET).as_deref(), Some("bbb"));
        assert_eq!(expected_sha(sums, "missing"), None);
    }

    #[test]
    fn other_systems_never_report_updates() {
        if !supported() {
            assert!(check(false).unwrap().is_none());
            assert!(apply().is_err());
        }
    }
}
