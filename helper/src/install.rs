use crate::config::{self, Config};
use crate::extension;
use crate::model;
use crate::paths::{self, Target};
use crate::whisper_cpp::{self, Build};
use serde_json::json;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Default)]
pub struct Options {
    pub server: Option<PathBuf>,
    pub model: Option<PathBuf>,
    pub download_model: Option<String>,
    pub extension_ids: Vec<String>,
    pub update_server: bool,
    pub cpu_only: bool,
}

pub fn parse(args: &[String]) -> Result<Options, String> {
    let mut opts = Options::default();
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        let mut value = || it.next().cloned().ok_or_else(|| format!("{arg} needs a value"));
        match arg.as_str() {
            "--server" => opts.server = Some(PathBuf::from(value()?)),
            "--model" => opts.model = Some(PathBuf::from(value()?)),
            "--download-model" => opts.download_model = Some(value()?),
            "--update-server" => opts.update_server = true,
            "--cpu" => opts.cpu_only = true,
            "--extension-id" => {
                let id = value()?;
                if !config::valid_extension_id(&id) {
                    return Err(format!("not a Chrome extension ID: {id}"));
                }
                opts.extension_ids.push(id);
            }
            other => return Err(format!("unknown option: {other}")),
        }
    }
    Ok(opts)
}

fn absolute(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|e| format!("{}: {e}", path.display()))
}

fn stable(path: &Path) -> Result<PathBuf, String> {
    std::path::absolute(path).map_err(|e| format!("{}: {e}", path.display()))
}

fn whisper_roots() -> Vec<PathBuf> {
    let home = paths::home();
    vec![home.join("projects/whisper.cpp"), home.join("whisper.cpp"), home.join("src/whisper.cpp")]
}

pub fn find_server(explicit: Option<&Path>) -> Result<PathBuf, String> {
    if let Some(path) = explicit {
        return if path.is_file() { stable(path) } else { Err(format!("not a file: {}", path.display())) };
    }
    let name = paths::exe_name("whisper-server");
    let mut candidates: Vec<PathBuf> = env::var_os("PATH")
        .map(|p| env::split_paths(&p).map(|dir| dir.join(&name)).collect())
        .unwrap_or_default();
    for root in whisper_roots() {
        candidates.push(root.join("build/bin").join(&name));
        candidates.push(root.join("build/bin/Release").join(&name));
    }
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        candidates.push(Path::new(dir).join(&name));
    }
    candidates.extend(whisper_cpp::downloaded_server());
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .map(|p| stable(&p))
        .unwrap_or_else(|| {
            Err("whisper-server not found. Install whisper.cpp (`brew install whisper.cpp`, or build \
                 https://github.com/ggml-org/whisper.cpp) or pass --server PATH"
                .into())
        })
}

pub fn find_model(server: &Path) -> Option<PathBuf> {
    let mut dirs = vec![paths::models_dir()];
    if let Some(root) = server.parent().and_then(Path::parent).and_then(Path::parent) {
        dirs.push(root.join("models"));
    }
    dirs.extend(whisper_roots().into_iter().map(|r| r.join("models")));
    model::PREFERRED_MODELS
        .iter()
        .flat_map(|name| dirs.iter().map(move |d| d.join(model::file_name(name))))
        .find(|p| p.is_file())
}

pub fn homebrew_opt_path(exe: &Path) -> Option<PathBuf> {
    let text = exe.to_str()?;
    let name = exe.file_name()?.to_str()?;
    paths::FORMULA_NAMES.iter().find_map(|formula| {
        let at = text.find(&format!("/Cellar/{formula}/"))?;
        Some(PathBuf::from(format!("{}/opt/{formula}/bin/{name}", &text[..at])))
    })
}

fn install_self() -> Result<PathBuf, String> {
    let current = env::current_exe().map_err(|e| e.to_string())?;
    if let Some(opt) = absolute(&current).ok().and_then(|p| homebrew_opt_path(&p)) {
        if opt.is_file() {
            return Ok(opt);
        }
    }
    let target = paths::installed_exe();
    if absolute(&current).ok() == absolute(&target).ok() {
        return Ok(target);
    }
    let tmp = target.with_extension("new");
    fs::copy(&current, &tmp).map_err(|e| format!("cannot copy helper to {}: {e}", tmp.display()))?;
    fs::rename(&tmp, &target).map_err(|e| {
        format!("cannot replace {}: {e} (quit Chrome and try again)", target.display())
    })?;
    let _ = fs::remove_file(paths::legacy_installed_exe());
    Ok(target)
}

pub fn manifest(exe: &Path, ids: &[String]) -> serde_json::Value {
    json!({
        "name": paths::HOST_NAME,
        "description": "Starts whisper-server for Chrome Transcriber",
        "path": exe,
        "type": "stdio",
        "allowed_origins": ids.iter().map(|id| format!("chrome-extension://{id}/")).collect::<Vec<_>>(),
    })
}

fn reg(args: &[&str]) -> Result<(), String> {
    let status = Command::new("reg").args(args).status().map_err(|e| format!("reg: {e}"))?;
    if status.success() { Ok(()) } else { Err(format!("reg {} failed", args.join(" "))) }
}

fn register(exe: &Path, ids: &[String]) -> Result<Vec<&'static str>, String> {
    let text = serde_json::to_string_pretty(&manifest(exe, ids)).map_err(|e| e.to_string())? + "\n";
    let mut registered = Vec::new();
    for browser in paths::browsers() {
        match browser.target {
            Target::Dir(dir) => {
                if !dir.is_dir() {
                    continue;
                }
                let hosts = dir.join("NativeMessagingHosts");
                fs::create_dir_all(&hosts).map_err(|e| format!("{}: {e}", hosts.display()))?;
                let file = hosts.join(paths::manifest_file_name());
                fs::write(&file, &text).map_err(|e| format!("{}: {e}", file.display()))?;
            }
            Target::Registry(key) => {
                let file = paths::data_dir().join(paths::manifest_file_name());
                fs::write(&file, &text).map_err(|e| format!("{}: {e}", file.display()))?;
                reg(&["add", &key, "/ve", "/t", "REG_SZ", "/d", &file.to_string_lossy(), "/f"])?;
            }
        }
        registered.push(browser.name);
    }
    Ok(registered)
}

fn resolve_server(opts: &Options) -> Result<(PathBuf, Option<Build>), String> {
    let download = || whisper_cpp::download(opts.cpu_only).map(|i| (i.server, Some(i.build)));
    if opts.update_server {
        return download();
    }
    match find_server(opts.server.as_deref()) {
        Ok(server) => Ok((server, None)),
        Err(_) if opts.server.is_none() && whisper_cpp::supported() => {
            println!("whisper-server not found; downloading a prebuilt whisper.cpp.");
            download()
        }
        Err(e) => Err(e),
    }
}

pub fn default_model(macos: bool, build: Option<Build>, nvidia: bool) -> &'static str {
    let gpu = macos || build == Some(Build::Cuda) || (build.is_none() && nvidia);
    if gpu { model::DEFAULT_MODEL } else { model::CPU_MODEL }
}

pub fn install(opts: Options) -> Result<(), String> {
    let (server, build) = resolve_server(&opts)?;
    let model = match (opts.model, opts.download_model) {
        (Some(path), _) => stable(&path)?,
        (None, Some(name)) => model::download(&name)?,
        (None, None) => match find_model(&server) {
            Some(path) => path,
            None => {
                let nvidia = build.is_none() && !cfg!(target_os = "macos") && whisper_cpp::nvidia_present();
                let name = default_model(cfg!(target_os = "macos"), build, nvidia);
                println!("No Whisper model found; downloading {name}.");
                model::download(name)?
            }
        },
    };

    let data = paths::data_dir();
    fs::create_dir_all(&data).map_err(|e| format!("cannot create {}: {e}", data.display()))?;
    let previous = Config::load().ok();
    let args = previous.as_ref().map(|c| c.args.clone()).unwrap_or_default();
    let mut extra_ids = previous.map(|c| c.extension_ids).unwrap_or_default();
    for id in opts.extension_ids {
        if !extra_ids.contains(&id) {
            extra_ids.push(id);
        }
    }
    let ids = config::extension_ids(&extra_ids);
    let extension_dir = env::current_exe()
        .ok()
        .and_then(|e| absolute(&e).ok())
        .and_then(|e| extension::find_dir(&e));
    Config {
        server: server.clone(),
        model: model.clone(),
        args,
        extension: extension_dir.clone(),
        extension_ids: extra_ids,
    }
    .save()?;
    let exe = install_self()?;
    let registered = register(&exe, &ids)?;

    println!("whisper-server: {}", server.display());
    println!("model:          {}", model.display());
    println!("helper:         {}", exe.display());
    if registered.is_empty() {
        println!("No Chromium-based browser profile found; start Chrome once, then run install again.");
    } else {
        println!("Registered with {}.", registered.join(", "));
    }
    println!("Extra server flags go in \"args\" in {}", paths::config_path().display());
    println!();
    print_extension_steps(extension_dir.as_deref(), &ids);
    Ok(())
}

fn print_extension_steps(dir: Option<&Path>, ids: &[String]) {
    let loaded = extension::loaded(ids);
    if let Some(first) = loaded.iter().find(|l| !l.disabled) {
        println!("The extension is already loaded in {} ({}). You're all set.", first.browser, first.profile);
        return;
    }
    if let Some(l) = loaded.first() {
        println!("The extension is installed in {} ({}) but disabled: turn it on in chrome://extensions.", l.browser, l.profile);
        return;
    }
    println!("Last step: add the extension to Chrome (one time):");
    println!("  1. Open chrome://extensions and turn on Developer mode (top right).");
    println!("  2. Click \"Load unpacked\" and choose this folder:");
    match dir {
        Some(dir) => {
            println!("       {}", dir.display());
            let copied = extension::copy_to_clipboard(&dir.to_string_lossy());
            if cfg!(target_os = "macos") {
                println!(
                    "     In the file dialog, press Cmd+Shift+G and paste the path{}.",
                    if copied { " (it is on your clipboard)" } else { "" }
                );
            } else if copied {
                println!("     The path is on your clipboard.");
            }
            if std::io::IsTerminal::is_terminal(&std::io::stdout()) {
                extension::reveal(dir);
            }
        }
        None => println!("       the folder containing manifest.json from https://github.com/rawmind/titl"),
    }
    println!("Then run `titl status` to check.");
}

pub fn uninstall(purge: bool) -> Result<(), String> {
    for browser in paths::browsers() {
        match browser.target {
            Target::Dir(dir) => {
                let _ = fs::remove_file(dir.join("NativeMessagingHosts").join(paths::manifest_file_name()));
            }
            Target::Registry(key) => {
                let _ = Command::new("reg").args(["delete", &key, "/f"]).output();
            }
        }
    }
    let data = paths::data_dir();
    if purge {
        let _ = fs::remove_dir_all(&data);
        println!("Removed {} including downloaded models.", data.display());
    } else {
        for path in [
            paths::installed_exe(),
            paths::legacy_installed_exe(),
            paths::config_path(),
            data.join(paths::manifest_file_name()),
        ] {
            let _ = fs::remove_file(path);
        }
        println!(
            "Helper removed. Downloaded models and whisper.cpp kept in {} (use --purge to delete).",
            data.display()
        );
    }
    Ok(())
}

pub fn status() -> Result<(), String> {
    println!("data dir: {}", paths::data_dir().display());
    match Config::load() {
        Ok(c) => {
            if let Some(dir) = &c.extension {
                println!("extension folder: {}", dir.display());
            }
            println!("server:   {} {}", c.server.display(), if c.server.is_file() { "" } else { "(missing!)" });
            println!("model:    {} {}", c.model.display(), if c.model.is_file() { "" } else { "(missing!)" });
            if !c.args.is_empty() {
                println!("args:     {}", c.args.join(" "));
            }
        }
        Err(e) => println!("{e}"),
    }
    for browser in paths::browsers() {
        let registered = match &browser.target {
            Target::Dir(dir) => dir.join("NativeMessagingHosts").join(paths::manifest_file_name()).is_file(),
            Target::Registry(key) => Command::new("reg")
                .args(["query", key])
                .output()
                .is_ok_and(|o| o.status.success()),
        };
        if registered {
            println!("registered: {}", browser.name);
        }
    }
    let extra = Config::load().map(|c| c.extension_ids).unwrap_or_default();
    let loaded = extension::loaded(&config::extension_ids(&extra));
    if loaded.is_empty() {
        println!("extension: not loaded in any browser (see `titl install` output)");
    }
    for l in loaded {
        println!(
            "extension: {} in {} ({}){}",
            if l.disabled { "disabled" } else { "loaded" },
            l.browser,
            l.profile,
            l.path.map(|p| format!(" from {p}")).unwrap_or_default()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_install_options() {
        let args: Vec<String> = ["--server", "/x/whisper-server", "--download-model", "small"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let opts = parse(&args).unwrap();
        assert_eq!(opts.server, Some(PathBuf::from("/x/whisper-server")));
        assert_eq!(opts.download_model.as_deref(), Some("small"));
        assert!(parse(&["--bogus".to_string()]).is_err());
        assert!(parse(&["--model".to_string()]).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn homebrew_installs_register_the_stable_opt_path() {
        assert_eq!(
            homebrew_opt_path(Path::new("/opt/homebrew/Cellar/chrome-transcriber/0.1.0/bin/chrome-transcriber-helper")),
            Some(PathBuf::from("/opt/homebrew/opt/chrome-transcriber/bin/chrome-transcriber-helper"))
        );
        assert_eq!(
            homebrew_opt_path(Path::new("/opt/homebrew/Cellar/titl/0.1.7/bin/titl")),
            Some(PathBuf::from("/opt/homebrew/opt/titl/bin/titl"))
        );
        assert_eq!(homebrew_opt_path(Path::new("/usr/local/bin/chrome-transcriber-helper")), None);
    }

    #[cfg(unix)]
    #[test]
    fn server_path_keeps_symlinks_so_upgrades_do_not_break_it() {
        let dir = std::env::temp_dir().join(format!("ct-test-{}", std::process::id()));
        let cellar = dir.join("Cellar/whisper.cpp/1.0/bin");
        fs::create_dir_all(&cellar).unwrap();
        fs::write(cellar.join("whisper-server"), "").unwrap();
        fs::create_dir_all(dir.join("bin")).unwrap();
        let link = dir.join("bin/whisper-server");
        std::os::unix::fs::symlink(cellar.join("whisper-server"), &link).unwrap();
        assert_eq!(find_server(Some(&link)).unwrap(), link);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn parses_server_download_flags() {
        let opts = parse(&["--update-server".to_string(), "--cpu".to_string()]).unwrap();
        assert!(opts.update_server && opts.cpu_only);
    }

    #[test]
    fn default_model_depends_on_gpu() {
        assert_eq!(default_model(true, None, false), model::DEFAULT_MODEL);
        assert_eq!(default_model(false, Some(Build::Cuda), false), model::DEFAULT_MODEL);
        assert_eq!(default_model(false, Some(Build::Cpu), true), model::CPU_MODEL);
        assert_eq!(default_model(false, None, true), model::DEFAULT_MODEL);
        assert_eq!(default_model(false, None, false), model::CPU_MODEL);
    }

    #[test]
    fn manifest_allows_only_the_extension() {
        let ids = config::extension_ids(&["abcdefghijklmnopabcdefghijklmnop".to_string()]);
        let m = manifest(Path::new("/opt/helper"), &ids);
        assert_eq!(m["name"], paths::HOST_NAME);
        assert_eq!(m["allowed_origins"][0], format!("chrome-extension://{}/", paths::UNPACKED_EXTENSION_ID));
        assert_eq!(m["allowed_origins"].as_array().unwrap().last().unwrap(), "chrome-extension://abcdefghijklmnopabcdefghijklmnop/");
        assert_eq!(m["allowed_origins"][1], format!("chrome-extension://{}/", paths::STORE_EXTENSION_IDS[0]));
        assert!(config::valid_extension_id(paths::UNPACKED_EXTENSION_ID));
        assert!(paths::STORE_EXTENSION_IDS.iter().all(|id| config::valid_extension_id(id)));
        assert!(!config::valid_extension_id("not-an-id"));
        assert_eq!(m["type"], "stdio");
    }
}
