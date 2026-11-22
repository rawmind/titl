use crate::paths;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub enum Outcome {
    NothingToDo,
    Moved { from: PathBuf, to: PathBuf },
    Kept { dir: PathBuf, reason: String },
}

pub fn legacy_data_dir() -> Outcome {
    let (new, old) = (paths::new_data_dir(), paths::legacy_data_dir());
    move_dir(&old, &new)
}

pub fn move_dir(old: &Path, new: &Path) -> Outcome {
    if new.exists() || !old.is_dir() {
        return Outcome::NothingToDo;
    }
    if let Some(parent) = new.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match fs::rename(old, new) {
        Ok(()) => {
            rewrite_config(&new.join("config.json"), old, new);
            Outcome::Moved { from: old.to_path_buf(), to: new.to_path_buf() }
        }
        Err(e) => Outcome::Kept { dir: old.to_path_buf(), reason: e.to_string() },
    }
}

fn rewrite_config(path: &Path, old: &Path, new: &Path) {
    let Ok(text) = fs::read_to_string(path) else { return };
    let Ok(mut value) = serde_json::from_str::<Value>(&text) else { return };
    let Some(fields) = value.as_object_mut() else { return };
    for field in fields.values_mut() {
        if let Some(moved) = field.as_str().and_then(|s| Path::new(s).strip_prefix(old).ok()).map(|rest| new.join(rest)) {
            *field = Value::String(moved.display().to_string());
        }
    }
    if let Ok(text) = serde_json::to_string_pretty(&value) {
        let _ = fs::write(path, text + "\n");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("ct-migrate-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn moves_the_old_folder_and_points_the_config_at_the_new_one() {
        let root = scratch("move");
        let (old, new) = (root.join("chrome-transcriber"), root.join("titl"));
        fs::create_dir_all(old.join("models")).unwrap();
        fs::write(old.join("models/ggml-small.bin"), "model").unwrap();
        let config = serde_json::json!({
            "server": old.join("whisper/b1/whisper-server").display().to_string(),
            "model": old.join("models/ggml-small.bin").display().to_string(),
            "extension": "/opt/homebrew/opt/titl/share/titl/extension",
            "args": ["-t", "8"],
        });
        fs::write(old.join("config.json"), config.to_string()).unwrap();

        assert!(matches!(move_dir(&old, &new), Outcome::Moved { .. }));
        assert!(!old.exists());
        assert_eq!(fs::read_to_string(new.join("models/ggml-small.bin")).unwrap(), "model");
        let moved: Value = serde_json::from_str(&fs::read_to_string(new.join("config.json")).unwrap()).unwrap();
        assert_eq!(moved["server"], new.join("whisper/b1/whisper-server").display().to_string());
        assert_eq!(moved["model"], new.join("models/ggml-small.bin").display().to_string());
        assert_eq!(moved["extension"], "/opt/homebrew/opt/titl/share/titl/extension");
        assert_eq!(moved["args"], serde_json::json!(["-t", "8"]));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn leaves_things_alone_when_the_new_folder_exists_or_the_old_one_does_not() {
        let root = scratch("skip");
        let (old, new) = (root.join("chrome-transcriber"), root.join("titl"));
        assert!(matches!(move_dir(&old, &new), Outcome::NothingToDo));
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&new).unwrap();
        assert!(matches!(move_dir(&old, &new), Outcome::NothingToDo));
        assert!(old.exists() && new.exists());
        let _ = fs::remove_dir_all(&root);
    }
}
