use crate::paths;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub enum Outcome {
    NothingToDo,
    BothExist { old: PathBuf, new: PathBuf },
    Moved { from: PathBuf, to: PathBuf },
    Kept { dir: PathBuf, reason: String },
}

pub fn legacy_data_dir() -> Outcome {
    let (new, old) = (paths::new_data_dir(), paths::legacy_data_dir());
    move_dir(&old, &new)
}

pub fn move_dir(old: &Path, new: &Path) -> Outcome {
    if !old.is_dir() {
        return Outcome::NothingToDo;
    }
    if new.exists() {
        return Outcome::BothExist { old: old.to_path_buf(), new: new.to_path_buf() };
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

pub fn remap(path: &Path, from: &Path, to: &Path) -> PathBuf {
    path.strip_prefix(from).map(|rest| to.join(rest)).unwrap_or_else(|_| path.to_path_buf())
}

fn rewrite_value(value: &mut Value, old: &Path, new: &Path) {
    match value {
        Value::String(text) if Path::new(text.as_str()).starts_with(old) => {
            *text = remap(Path::new(text.as_str()), old, new).display().to_string();
        }
        Value::Array(items) => items.iter_mut().for_each(|item| rewrite_value(item, old, new)),
        _ => {}
    }
}

fn rewrite_config(path: &Path, old: &Path, new: &Path) {
    let Ok(text) = fs::read_to_string(path) else { return };
    let Ok(mut value) = serde_json::from_str::<Value>(&text) else { return };
    let Some(fields) = value.as_object_mut() else { return };
    fields.values_mut().for_each(|field| rewrite_value(field, old, new));
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
            "args": ["-t", "8", "--vad-model", old.join("models/vad.bin").display().to_string()],
        });
        fs::write(old.join("config.json"), config.to_string()).unwrap();

        assert!(matches!(move_dir(&old, &new), Outcome::Moved { .. }));
        assert!(!old.exists());
        assert_eq!(fs::read_to_string(new.join("models/ggml-small.bin")).unwrap(), "model");
        let moved: Value = serde_json::from_str(&fs::read_to_string(new.join("config.json")).unwrap()).unwrap();
        assert_eq!(moved["server"], new.join("whisper/b1/whisper-server").display().to_string());
        assert_eq!(moved["model"], new.join("models/ggml-small.bin").display().to_string());
        assert_eq!(moved["extension"], "/opt/homebrew/opt/titl/share/titl/extension");
        assert_eq!(moved["args"], serde_json::json!(["-t", "8", "--vad-model", new.join("models/vad.bin").display().to_string()]));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn leaves_things_alone_when_the_new_folder_exists_or_the_old_one_does_not() {
        let root = scratch("skip");
        let (old, new) = (root.join("chrome-transcriber"), root.join("titl"));
        assert!(matches!(move_dir(&old, &new), Outcome::NothingToDo));
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&new).unwrap();
        assert!(matches!(move_dir(&old, &new), Outcome::BothExist { .. }));
        assert!(old.exists() && new.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn remaps_only_paths_inside_the_moved_folder() {
        let (old, new) = (Path::new("/data/chrome-transcriber"), Path::new("/data/titl"));
        assert_eq!(remap(&old.join("titl"), old, new), new.join("titl"));
        assert_eq!(remap(Path::new("/opt/homebrew/bin/titl"), old, new), PathBuf::from("/opt/homebrew/bin/titl"));
        assert_eq!(remap(Path::new("/data/chrome-transcriber-old/titl"), old, new), PathBuf::from("/data/chrome-transcriber-old/titl"));
    }
}
