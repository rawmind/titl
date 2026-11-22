use crate::config::Config;
use crate::paths;
use serde_json::{json, Value};
use std::fs;

const START_MARKER: &str = "=== starting ";
const BACKEND_PREFIX: &str = "whisper_backend_init_gpu: ";
const THREADS_PREFIX: &str = "system_info: n_threads = ";

#[derive(Debug, PartialEq)]
pub struct ServerRun {
    pub backend: Option<String>,
    pub threads: Option<String>,
}

pub fn last_run(log: &str) -> Option<ServerRun> {
    let start = log.rfind(START_MARKER)?;
    let run = &log[start..];
    let backend = run.lines().filter_map(|l| l.strip_prefix(BACKEND_PREFIX)).find_map(|rest| {
        let rest = rest.trim();
        if rest == "no GPU found" {
            Some("CPU".to_string())
        } else {
            rest.strip_prefix("using ").and_then(|r| r.strip_suffix(" backend")).map(|name| format!("GPU ({name})"))
        }
    });
    let threads = run
        .lines()
        .find_map(|l| l.strip_prefix(THREADS_PREFIX))
        .and_then(|rest| rest.split('|').next())
        .map(|t| t.trim().to_string());
    Some(ServerRun { backend, threads })
}

pub fn server_run() -> Option<ServerRun> {
    last_run(&fs::read_to_string(paths::log_path()).ok()?)
}

pub fn info_reply() -> Value {
    let run = server_run();
    let mut reply = json!({
        "status": "info",
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "log": paths::log_path().display().to_string(),
        "backend": run.as_ref().and_then(|r| r.backend.clone()),
        "threads": run.as_ref().and_then(|r| r.threads.clone()),
    });
    match Config::load() {
        Ok(c) => {
            reply["server"] = json!(c.server.display().to_string());
            reply["model"] = json!(c.model.display().to_string());
            reply["args"] = json!(c.args);
        }
        Err(e) => reply["config_error"] = json!(e),
    }
    reply
}

#[cfg(test)]
mod tests {
    use super::*;

    const CPU_RUN: &str = "=== starting C:\\whisper\\whisper-server.exe on port 13756\n\
        whisper_backend_init_gpu: device 0: CPU (type: 0)\n\
        whisper_backend_init_gpu: no GPU found\n\
        system_info: n_threads = 4 / 4 | WHISPER : COREML = 0 | CPU : AVX2 = 1 |\n";

    #[test]
    fn reads_cpu_and_threads_from_the_latest_run() {
        let log = format!("=== starting old on port 1\nwhisper_backend_init_gpu: using CUDA0 backend\n{CPU_RUN}");
        assert_eq!(
            last_run(&log),
            Some(ServerRun { backend: Some("CPU".into()), threads: Some("4 / 4".into()) })
        );
    }

    #[test]
    fn reads_the_gpu_name() {
        let log = "=== starting /opt/whisper-server on port 2\nwhisper_backend_init_gpu: using MTL0 backend\nsystem_info: n_threads = 4 / 14 | x\n";
        assert_eq!(
            last_run(log),
            Some(ServerRun { backend: Some("GPU (MTL0)".into()), threads: Some("4 / 14".into()) })
        );
    }

    #[test]
    fn a_run_without_details_yet_reports_nothing() {
        assert_eq!(last_run("=== starting x on port 3\n"), Some(ServerRun { backend: None, threads: None }));
        assert_eq!(last_run(""), None);
    }
}
