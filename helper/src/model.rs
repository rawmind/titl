use crate::paths;
use crate::whisper_cpp;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub const DEFAULT_MODEL: &str = "large-v3-turbo-q5_0";
pub const CPU_MODEL: &str = "small";
pub const VAD_FILE: &str = "ggml-silero-v6.2.0.bin";
const VAD_URL: &str =
    "https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin";
const VAD_SIZE: u64 = 885_098;
const VAD_SHA256: &str = "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987";
pub const PREFERRED_MODELS: &[&str] = &["large-v3-turbo", "large-v3-turbo-q8_0", "large-v3-turbo-q5_0"];

pub fn file_name(name: &str) -> String {
    format!("ggml-{name}.bin")
}

pub fn url(name: &str) -> String {
    format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}", file_name(name))
}

pub fn vad_in(dir: &Path) -> Option<PathBuf> {
    Some(dir.join(VAD_FILE)).filter(|p| fs::metadata(p).is_ok_and(|m| m.is_file() && m.len() == VAD_SIZE))
}

pub fn vad_args(configured: &[String], enabled: bool, dir: &Path) -> Vec<String> {
    let chosen_by_user = configured.iter().any(|a| matches!(a.as_str(), "--vad" | "-vm" | "--vad-model"));
    match vad_in(dir) {
        Some(path) if enabled && !chosen_by_user => {
            vec!["--vad".into(), "--vad-model".into(), path.to_string_lossy().into_owned()]
        }
        _ => Vec::new(),
    }
}

pub fn download_vad() -> Result<PathBuf, String> {
    let dir = paths::models_dir();
    if let Some(path) = vad_in(&dir) {
        return Ok(path);
    }
    let dest = dir.join(VAD_FILE);
    fetch(VAD_URL, &dest)?;
    let sha = whisper_cpp::sha256_of(&dest)?;
    if sha != VAD_SHA256 {
        let _ = fs::remove_file(&dest);
        return Err(format!("{VAD_FILE} has an unexpected checksum: {sha}"));
    }
    Ok(dest)
}

pub fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_')
}

pub fn download(name: &str) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err(format!("invalid model name: {name}"));
    }
    let dest = paths::models_dir().join(file_name(name));
    if dest.is_file() {
        println!("Model already downloaded: {}", dest.display());
        return Ok(dest);
    }
    fetch(&url(name), &dest).map_err(|e| {
        if e.contains("HTTP 404") {
            format!("no such model: {name} (see https://huggingface.co/ggerganov/whisper.cpp)")
        } else {
            e
        }
    })?;
    Ok(dest)
}

pub fn fetch(url: &str, dest: &Path) -> Result<(), String> {
    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    }
    println!("Downloading {url}");
    let response = ureq::get(url).set("User-Agent", "titl").call().map_err(|e| match e {
        ureq::Error::Status(code, _) => format!("download failed: HTTP {code} for {url}"),
        other => format!("download failed: {other}"),
    })?;
    let total: Option<u64> = response.header("Content-Length").and_then(|v| v.parse().ok());

    let part = dest.with_extension("part");
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
    fs::rename(&part, dest).map_err(|e| format!("cannot move {} into place: {e}", dest.display()))
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
    fn speech_detection_needs_an_intact_model_and_can_be_turned_off() {
        let dir = std::env::temp_dir().join(format!("titl-vad-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert!(vad_args(&[], true, &dir).is_empty());
        fs::write(dir.join(VAD_FILE), "partial").unwrap();
        assert!(vad_args(&[], true, &dir).is_empty());
        fs::write(dir.join(VAD_FILE), vec![0; VAD_SIZE as usize]).unwrap();
        let path = dir.join(VAD_FILE).to_string_lossy().into_owned();
        assert_eq!(vad_args(&[], true, &dir), ["--vad", "--vad-model", path.as_str()]);
        assert!(vad_args(&[], false, &dir).is_empty());
        assert!(vad_args(&["--vad-model".into(), "/mine.bin".into()], true, &dir).is_empty());
        assert!(!vad_args(&["-t".into(), "8".into()], true, &dir).is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_path_like_names() {
        assert!(valid_name("large-v3-turbo"));
        assert!(!valid_name("../etc/passwd"));
        assert!(!valid_name(""));
    }
}
