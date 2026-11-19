use crate::paths;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

pub struct Config {
    pub server: PathBuf,
    pub model: PathBuf,
    pub args: Vec<String>,
}

impl Config {
    pub fn load() -> Result<Self, String> {
        let path = paths::config_path();
        let text = fs::read_to_string(&path)
            .map_err(|_| format!("not installed: run `chrome-transcriber-helper install` ({} missing)", path.display()))?;
        let value: Value = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
        let field = |name: &str| {
            value
                .get(name)
                .and_then(Value::as_str)
                .map(PathBuf::from)
                .ok_or_else(|| format!("{}: missing \"{name}\"", path.display()))
        };
        Ok(Config {
            server: field("server")?,
            model: field("model")?,
            args: value
                .get("args")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default(),
        })
    }

    pub fn save(&self) -> Result<(), String> {
        let path = paths::config_path();
        let value = json!({ "server": self.server, "model": self.model, "args": self.args });
        let text = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
        fs::write(&path, text + "\n").map_err(|e| format!("cannot write {}: {e}", path.display()))
    }
}
