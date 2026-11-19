use crate::paths;
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub struct Loaded {
    pub browser: &'static str,
    pub profile: String,
    pub path: Option<String>,
    pub disabled: bool,
}

fn is_extension_dir(dir: &Path) -> bool {
    dir.join("manifest.json").is_file() && dir.join("src/background.js").is_file()
}

pub fn find_dir(exe: &Path) -> Option<PathBuf> {
    let dir = exe.ancestors().skip(1).take(6).find_map(|a| {
        paths::FORMULA_NAMES
            .iter()
            .map(|f| a.join(format!("share/{f}/extension")))
            .chain(std::iter::once(a.to_path_buf()))
            .find(|c| is_extension_dir(c))
    })?;
    Some(homebrew_stable(&dir).filter(|p| is_extension_dir(p)).unwrap_or(dir))
}

fn homebrew_stable(dir: &Path) -> Option<PathBuf> {
    let text = dir.to_str()?;
    paths::FORMULA_NAMES.iter().find_map(|formula| {
        let at = text.find(&format!("/Cellar/{formula}/"))?;
        Some(PathBuf::from(format!("{}/opt/{formula}/share/{formula}/extension", &text[..at])))
    })
}

pub fn entry(prefs: &Value, ids: &[String]) -> Option<(Option<String>, bool)> {
    let settings = ids.iter().find_map(|id| prefs.pointer(&format!("/extensions/settings/{id}")))?;
    let path = settings.get("path").and_then(Value::as_str).map(String::from);
    let disabled = match settings.get("disable_reasons") {
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Number(n)) => n.as_u64() != Some(0),
        _ => false,
    };
    Some((path, disabled))
}

pub fn loaded(ids: &[String]) -> Vec<Loaded> {
    let mut found = Vec::new();
    for browser in paths::browsers() {
        let Ok(profiles) = fs::read_dir(&browser.user_data) else { continue };
        for profile in profiles.flatten() {
            let name = profile.file_name().to_string_lossy().into_owned();
            if name != "Default" && !name.starts_with("Profile ") {
                continue;
            }
            let hit = ["Secure Preferences", "Preferences"].iter().find_map(|file| {
                let text = fs::read_to_string(profile.path().join(file)).ok()?;
                entry(&serde_json::from_str(&text).ok()?, ids)
            });
            if let Some((path, disabled)) = hit {
                found.push(Loaded { browser: browser.name, profile: name, path, disabled });
            }
        }
    }
    found
}

pub fn copy_to_clipboard(text: &str) -> bool {
    let candidates: &[&[&str]] = if cfg!(target_os = "macos") {
        &[&["pbcopy"]]
    } else if cfg!(windows) {
        &[&["clip"]]
    } else {
        &[&["wl-copy"], &["xclip", "-selection", "clipboard"]]
    };
    candidates.iter().any(|cmd| {
        let Ok(mut child) = Command::new(cmd[0])
            .args(&cmd[1..])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        else {
            return false;
        };
        let wrote = child.stdin.take().is_some_and(|mut s| s.write_all(text.as_bytes()).is_ok());
        child.wait().is_ok_and(|s| s.success()) && wrote
    })
}

pub fn reveal(dir: &Path) {
    let mut command = if cfg!(target_os = "macos") {
        let mut c = Command::new("open");
        c.arg("-R").arg(dir.join("manifest.json"));
        c
    } else if cfg!(windows) {
        let mut c = Command::new("explorer");
        c.arg(dir);
        c
    } else {
        let mut c = Command::new("xdg-open");
        c.arg(dir);
        c
    };
    let _ = command.stdout(Stdio::null()).stderr(Stdio::null()).spawn();
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_extension(dir: &Path) {
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("manifest.json"), "{}").unwrap();
        fs::write(dir.join("src/background.js"), "").unwrap();
    }

    #[test]
    fn finds_extension_next_to_a_source_build() {
        let root = std::env::temp_dir().join(format!("ct-src-{}", std::process::id()));
        make_extension(&root);
        let exe = root.join("helper/target/release/chrome-transcriber-helper");
        assert_eq!(find_dir(&exe), Some(root.clone()));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn finds_extension_in_a_homebrew_keg_and_prefers_the_opt_path() {
        let prefix = std::env::temp_dir().join(format!("ct-brew-{}", std::process::id()));
        let keg = prefix.join("Cellar/chrome-transcriber/0.1.2");
        make_extension(&keg.join("share/chrome-transcriber/extension"));
        let exe = keg.join("bin/chrome-transcriber-helper");
        assert_eq!(find_dir(&exe), Some(keg.join("share/chrome-transcriber/extension")));
        make_extension(&prefix.join("opt/chrome-transcriber/share/chrome-transcriber/extension"));
        assert_eq!(
            find_dir(&exe),
            Some(prefix.join("opt/chrome-transcriber/share/chrome-transcriber/extension"))
        );
        fs::remove_dir_all(&prefix).unwrap();
    }

    #[test]
    fn finds_extension_in_a_titl_homebrew_keg() {
        let prefix = std::env::temp_dir().join(format!("ct-titl-{}", std::process::id()));
        let keg = prefix.join("Cellar/titl/0.1.4");
        make_extension(&keg.join("share/titl/extension"));
        make_extension(&prefix.join("opt/titl/share/titl/extension"));
        let exe = keg.join("bin/chrome-transcriber-helper");
        assert_eq!(find_dir(&exe), Some(prefix.join("opt/titl/share/titl/extension")));
        fs::remove_dir_all(&prefix).unwrap();
    }

    #[test]
    fn reads_extension_entry_from_preferences() {
        let id = paths::UNPACKED_EXTENSION_ID;
        let ids = vec![id.to_string()];
        let prefs = json!({ "extensions": { "settings": { id: { "location": 4, "path": "/x" } } } });
        assert_eq!(entry(&prefs, &ids), Some((Some("/x".into()), false)));
        let disabled = json!({ "extensions": { "settings": { id: { "disable_reasons": [1] } } } });
        assert_eq!(entry(&disabled, &ids), Some((None, true)));
        assert_eq!(entry(&json!({ "extensions": { "settings": {} } }), &ids), None);
        let store = json!({ "extensions": { "settings": { "abcdefghijklmnopabcdefghijklmnop": {} } } });
        assert_eq!(entry(&store, &["abcdefghijklmnopabcdefghijklmnop".to_string()]), Some((None, false)));
    }
}
