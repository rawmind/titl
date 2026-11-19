use crate::paths;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;

pub const DEFAULT_MODEL: &str = "large-v3-turbo-q5_0";
pub const PREFERRED_MODELS: &[&str] = &["large-v3-turbo", "large-v3-turbo-q8_0", "large-v3-turbo-q5_0"];

pub fn file_name(name: &str) -> String {
    format!("ggml-{name}.bin")
}

pub fn url(name: &str) -> String {
    format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}", file_name(name))
}

pub fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_')
}

pub fn download(name: &str) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err(format!("invalid model name: {name}"));
    }
    let dir = paths::models_dir();
    let dest = dir.join(file_name(name));
    if dest.is_file() {
        println!("Model already downloaded: {}", dest.display());
        return Ok(dest);
    }
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;

    let url = url(name);
    println!("Downloading {url}");
    let response = ureq::get(&url).call().map_err(|e| match e {
        ureq::Error::Status(404, _) => format!("no such model: {name} (see https://huggingface.co/ggerganov/whisper.cpp)"),
        other => format!("download failed: {other}"),
    })?;
    let total: Option<u64> = response.header("Content-Length").and_then(|v| v.parse().ok());

    let part = dir.join(format!("{}.part", file_name(name)));
    let mut file = File::create(&part).map_err(|e| format!("cannot write {}: {e}", part.display()))?;
    let mut reader = response.into_reader();
    let mut buf = vec![0u8; 1 << 20];
    let mut written: u64 = 0;
    let mut last_percent = None;
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("download interrupted: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| format!("cannot write {}: {e}", part.display()))?;
        written += n as u64;
        if let Some(total) = total {
            let percent = written * 100 / total.max(1);
            if last_percent != Some(percent) {
                last_percent = Some(percent);
                eprint!("\r  {percent:3}%  {} / {} MB", written >> 20, total >> 20);
            }
        }
    }
    eprintln!();
    if let Some(total) = total {
        if written != total {
            return Err(format!("download incomplete: {written} of {total} bytes"));
        }
    }
    file.sync_all().map_err(|e| e.to_string())?;
    fs::rename(&part, &dest).map_err(|e| format!("cannot move model into place: {e}"))?;
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_hugging_face_url() {
        assert_eq!(
            url("large-v3-turbo-q5_0"),
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin"
        );
    }

    #[test]
    fn rejects_path_like_names() {
        assert!(valid_name("large-v3-turbo"));
        assert!(!valid_name("../etc/passwd"));
        assert!(!valid_name(""));
    }
}
