use crate::paths;
use crate::whisper_cpp;
use serde_json::{json, Value};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const DEFAULT_MODEL: &str = "large-v3-turbo-q5_0";
pub const CPU_MODEL: &str = "small";
pub const SERBIAN_MODEL: &str = "small-sr-distill-v3-q8_0";
const SERBIAN_MODEL_LANGUAGES: &[&str] = &["sr", "hr"];
const WHISPER_CPP_MODELS: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
const SERBIAN_MODELS: &str =
    "https://huggingface.co/rawmind/whisper-small-sr-distill-v3/resolve/07561e38857987fd987d8c06541b943d0c9672d4";
const SERBIAN_SHA256: &str = "578f8c9a5bbb4af2bd56e968034ef62292d64387beb9e05db8fd2e065a880b0e";
const SERBIAN_SIZE: u64 = 264_464_624;
pub const VAD_FILE: &str = "ggml-silero-v6.2.0.bin";
const VAD_URL: &str =
    "https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin";
const VAD_SIZE: u64 = 885_098;
const VAD_SHA256: &str = "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const READ_TIMEOUT: Duration = Duration::from_secs(60);
pub const PREFERRED_MODELS: &[&str] = &["large-v3-turbo", "large-v3-turbo-q8_0", "large-v3-turbo-q5_0"];

pub fn file_name(name: &str) -> String {
    format!("ggml-{name}.bin")
}

pub fn url(name: &str) -> String {
    let base = if name == SERBIAN_MODEL { SERBIAN_MODELS } else { WHISPER_CPP_MODELS };
    format!("{base}/{}", file_name(name))
}

pub fn is_small(path: &Path) -> bool {
    path.file_name().is_some_and(|n| n == file_name(CPU_MODEL).as_str())
}

pub fn serbian_in(dir: &Path) -> Option<PathBuf> {
    Some(dir.join(file_name(SERBIAN_MODEL)))
        .filter(|p| fs::metadata(p).is_ok_and(|m| m.is_file() && m.len() == SERBIAN_SIZE))
}

pub fn download_serbian() -> Result<PathBuf, String> {
    let dir = paths::models_dir();
    if let Some(path) = serbian_in(&dir) {
        return Ok(path);
    }
    let dest = dir.join(file_name(SERBIAN_MODEL));
    fetch(&url(SERBIAN_MODEL), &dest, Some(SERBIAN_SHA256))?;
    Ok(dest)
}

pub fn download_serbian_reply() -> Value {
    match download_serbian() {
        Ok(path) => json!({ "status": "downloaded", "path": path.display().to_string() }),
        Err(e) => json!({ "status": "error", "error": e }),
    }
}

pub fn for_language(configured: &Path, language: &str, models_dir: &Path) -> PathBuf {
    if SERBIAN_MODEL_LANGUAGES.contains(&language) && is_small(configured) {
        if let Some(serbian) = serbian_in(models_dir) {
            return serbian;
        }
    }
    configured.to_path_buf()
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
    fetch(VAD_URL, &dest, Some(VAD_SHA256))?;
    Ok(dest)
}

pub fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_')
}

pub fn download(name: &str) -> Result<PathBuf, String> {
    if !valid_name(name) {
        return Err(format!("invalid model name: {name}"));
    }
    if name == SERBIAN_MODEL {
        return download_serbian();
    }
    let dest = paths::models_dir().join(file_name(name));
    if dest.is_file() {
        println!("Model already downloaded: {}", dest.display());
        return Ok(dest);
    }
    fetch(&url(name), &dest, None).map_err(|e| {
        if e.contains("HTTP 404") {
            format!("no such model: {name} (see https://huggingface.co/ggerganov/whisper.cpp)")
        } else {
            e
        }
    })?;
    Ok(dest)
}

pub fn fetch(url: &str, dest: &Path, sha256: Option<&str>) -> Result<(), String> {
    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    }
    eprintln!("Downloading {url}");
    let agent = ureq::AgentBuilder::new().timeout_connect(CONNECT_TIMEOUT).timeout_read(READ_TIMEOUT).build();
    let response = agent.get(url).set("User-Agent", "titl").call().map_err(|e| match e {
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
        let n = reader.read(&mut buf).map_err(|e| {
            let _ = fs::remove_file(&part);
            format!("download interrupted: {e}")
        })?;
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
            let _ = fs::remove_file(&part);
            return Err(format!("download incomplete: {written} of {total} bytes"));
        }
    }
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    if let Some(expected) = sha256 {
        let actual = whisper_cpp::sha256_of(&part)?;
        if !actual.eq_ignore_ascii_case(expected) {
            let _ = fs::remove_file(&part);
            let name = dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            return Err(format!("{name} has an unexpected checksum: {actual}"));
        }
    }
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
    fn serbian_model_comes_from_its_own_pinned_repo() {
        assert_eq!(
            url(SERBIAN_MODEL),
            "https://huggingface.co/rawmind/whisper-small-sr-distill-v3/resolve/07561e38857987fd987d8c06541b943d0c9672d4/ggml-small-sr-distill-v3-q8_0.bin"
        );
        assert_eq!(url(CPU_MODEL), "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin");
    }

    #[test]
    fn serbian_model_is_used_only_for_serbian_and_croatian_with_small() {
        let dir = std::env::temp_dir().join(format!("titl-model-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let small = dir.join(file_name(CPU_MODEL));
        let turbo = dir.join(file_name("large-v3-turbo"));
        for language in SERBIAN_MODEL_LANGUAGES {
            assert_eq!(for_language(&small, language, &dir), small);
        }
        let serbian = dir.join(file_name(SERBIAN_MODEL));
        fs::write(&serbian, "partial").unwrap();
        assert_eq!(for_language(&small, "sr", &dir), small);
        File::create(&serbian).unwrap().set_len(SERBIAN_SIZE).unwrap();
        for language in SERBIAN_MODEL_LANGUAGES {
            assert_eq!(for_language(&small, language, &dir), serbian);
            assert_eq!(for_language(&turbo, language, &dir), turbo);
        }
        for other in ["auto", "bs", "sl", "en", ""] {
            assert_eq!(for_language(&small, other, &dir), small);
        }
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
