use std::env;
use std::path::PathBuf;

pub const HOST_NAME: &str = "com.chrome_transcriber.host";
pub const EXTENSION_ID: &str = "fehpgpahkmanekioejihbpihpbacdjgb";
const APP_DIR: &str = "chrome-transcriber";

pub fn home() -> PathBuf {
    env::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

pub fn data_dir() -> PathBuf {
    if cfg!(target_os = "macos") {
        home().join("Library/Application Support").join(APP_DIR)
    } else if cfg!(windows) {
        env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join("AppData/Local"))
            .join(APP_DIR)
    } else {
        env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home().join(".local/share"))
            .join(APP_DIR)
    }
}

pub fn exe_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

pub fn installed_exe() -> PathBuf {
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
            target: Target::Registry(format!(r"HKCU\{key}\NativeMessagingHosts\{HOST_NAME}")),
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
