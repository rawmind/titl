use std::env;
use std::path::PathBuf;

pub const HOST_NAME: &str = "com.chrome_transcriber.host";
pub const UNPACKED_EXTENSION_ID: &str = "fehpgpahkmanekioejihbpihpbacdjgb";
pub const STORE_EXTENSION_IDS: &[&str] = &["bpapgchpopccpbgbkfldmdmfmddgoeme"];
pub const FORMULA_NAMES: &[&str] = &["titl", "chrome-transcriber"];
const APP_DIR: &str = "titl";
const LEGACY_APP_DIR: &str = "chrome-transcriber";

pub fn home() -> PathBuf {
    env::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn data_root() -> PathBuf {
    if cfg!(target_os = "macos") {
        home().join("Library/Application Support")
    } else if cfg!(windows) {
        env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|| home().join("AppData/Local"))
    } else {
        env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".local/share"))
    }
}

pub fn new_data_dir() -> PathBuf {
    data_root().join(APP_DIR)
}

pub fn legacy_data_dir() -> PathBuf {
    data_root().join(LEGACY_APP_DIR)
}

pub fn choose_data_dir(new: PathBuf, legacy: PathBuf) -> PathBuf {
    if !new.exists() && legacy.is_dir() { legacy } else { new }
}

pub fn data_dir() -> PathBuf {
    choose_data_dir(new_data_dir(), legacy_data_dir())
}

pub fn exe_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

pub fn installed_exe() -> PathBuf {
    data_dir().join(exe_name("titl"))
}

pub fn legacy_installed_exe() -> PathBuf {
    data_dir().join(exe_name("chrome-transcriber-helper"))
}

pub fn config_path() -> PathBuf {
    data_dir().join("config.json")
}

pub fn log_path() -> PathBuf {
    data_dir().join("server.log")
}

pub fn models_dir() -> PathBuf {
    data_dir().join("models")
}

pub fn whisper_dir() -> PathBuf {
    data_dir().join("whisper")
}

pub fn manifest_file_name() -> String {
    format!("{HOST_NAME}.json")
}

pub enum Target {
    Dir(PathBuf),
    Registry(String),
}

pub struct Browser {
    pub name: &'static str,
    pub target: Target,
    pub user_data: PathBuf,
}

pub fn browsers() -> Vec<Browser> {
    if cfg!(windows) {
        let local = env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join("AppData/Local"));
        [
            ("Chrome", r"Software\Google\Chrome", r"Google\Chrome"),
            ("Chromium", r"Software\Chromium", "Chromium"),
            ("Edge", r"Software\Microsoft\Edge", r"Microsoft\Edge"),
            ("Brave", r"Software\BraveSoftware\Brave-Browser", r"BraveSoftware\Brave-Browser"),
        ]
        .into_iter()
        .map(|(name, key, dir)| Browser {
            name,
            target: Target::Registry(format!(r"{key}\NativeMessagingHosts\{HOST_NAME}")),
            user_data: local.join(dir).join("User Data"),
        })
        .collect()
    } else {
        let (root, list): (PathBuf, &[(&str, &str)]) = if cfg!(target_os = "macos") {
            (
                home().join("Library/Application Support"),
                &[
                    ("Chrome", "Google/Chrome"),
                    ("Chrome Beta", "Google/Chrome Beta"),
                    ("Chrome Canary", "Google/Chrome Canary"),
                    ("Chromium", "Chromium"),
                    ("Edge", "Microsoft Edge"),
                    ("Brave", "BraveSoftware/Brave-Browser"),
                ],
            )
        } else {
            (
                env::var_os("XDG_CONFIG_HOME")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| home().join(".config")),
                &[
                    ("Chrome", "google-chrome"),
                    ("Chrome Beta", "google-chrome-beta"),
                    ("Chromium", "chromium"),
                    ("Edge", "microsoft-edge"),
                    ("Brave", "BraveSoftware/Brave-Browser"),
                ],
            )
        };
        list.iter()
            .map(|(name, dir)| Browser {
                name,
                target: Target::Dir(root.join(dir)),
                user_data: root.join(dir),
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_the_old_folder_only_until_the_new_one_exists() {
        let root = env::temp_dir().join(format!("ct-paths-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (new, old) = (root.join("titl"), root.join("chrome-transcriber"));
        assert_eq!(choose_data_dir(new.clone(), old.clone()), new);
        std::fs::create_dir_all(&old).unwrap();
        assert_eq!(choose_data_dir(new.clone(), old.clone()), old);
        std::fs::create_dir_all(&new).unwrap();
        assert_eq!(choose_data_dir(new.clone(), old.clone()), new);
        let _ = std::fs::remove_dir_all(&root);
    }
}
