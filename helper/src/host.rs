use crate::config::Config;
use crate::diagnostics;
use crate::model;
use crate::paths;
use crate::update;
use serde_json::{json, Value};
use std::fs::OpenOptions;
use std::io::{self, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const START_TIMEOUT: Duration = Duration::from_secs(110);
const MAX_MESSAGE: usize = 1 << 20;
const PORT_RANGE: (u16, u16) = (10_000, 65_535);
const START_ATTEMPTS: usize = 3;

pub fn read_message(reader: &mut impl Read) -> io::Result<Option<Value>> {
    let mut len = [0u8; 4];
    match reader.read_exact(&mut len) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_le_bytes(len) as usize;
    if len > MAX_MESSAGE {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "message too large"));
    }
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf)?;
    serde_json::from_slice(&buf).map(Some).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

pub fn write_message(writer: &mut impl Write, value: &Value) -> io::Result<()> {
    let data = serde_json::to_vec(value)?;
    writer.write_all(&(data.len() as u32).to_le_bytes())?;
    writer.write_all(&data)?;
    writer.flush()
}

fn reachable(port: u16) -> bool {
    TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_secs(1)).is_ok()
}

fn error(message: impl Into<String>) -> Value {
    json!({ "status": "error", "error": message.into() })
}

fn ready(port: u16) -> Value {
    json!({ "status": "ready", "port": port })
}

pub fn pick_port() -> Option<u16> {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(1);
    let mut x = nanos ^ (u64::from(std::process::id()) << 32) | 1;
    let span = u64::from(PORT_RANGE.1 - PORT_RANGE.0) + 1;
    for _ in 0..500 {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        let port = PORT_RANGE.0 + (x % span) as u16;
        if TcpListener::bind(("127.0.0.1", port)).is_ok() && !reachable(port) {
            return Some(port);
        }
    }
    None
}

enum Failure {
    Exited(String),
    Other(String),
}

impl Failure {
    fn message(self) -> String {
        match self {
            Failure::Exited(m) | Failure::Other(m) => m,
        }
    }
}

struct Server {
    child: Option<Child>,
    port: Option<u16>,
    model: Option<PathBuf>,
    vad_failed: bool,
    serbian_failed: bool,
}

struct Started {
    vad: bool,
    serbian: bool,
    log_offset: u64,
}

#[derive(Debug, PartialEq)]
enum Cause {
    Port,
    Model,
    Vad,
    Unknown,
}

fn exit_cause(output: &str) -> Cause {
    let lower = output.to_lowercase();
    if lower.contains("couldn't bind") || lower.contains("address already in use") {
        Cause::Port
    } else if lower.contains("failed to initialize whisper context") || lower.contains("failed to load model") {
        Cause::Model
    } else if lower.contains("vad") && (lower.contains("unknown argument") || lower.contains("failed")) {
        Cause::Vad
    } else {
        Cause::Unknown
    }
}

fn fallback(cause: &Cause, started: &Started) -> Option<Fallback> {
    match cause {
        Cause::Port => None,
        Cause::Model if started.serbian => Some(Fallback::Serbian),
        Cause::Vad if started.vad => Some(Fallback::Vad),
        _ => None,
    }
}

fn unexplained_guesses(vad: bool, serbian: bool) -> Vec<(bool, bool)> {
    let mut guesses = Vec::new();
    if serbian {
        guesses.push((false, true));
    }
    if vad {
        guesses.push((true, false));
    }
    if vad && serbian {
        guesses.push((true, true));
    }
    guesses
}

#[derive(Debug, PartialEq)]
enum Fallback {
    Vad,
    Serbian,
}

fn log_since(path: &Path, offset: u64) -> String {
    let Ok(mut file) = std::fs::File::open(path) else {
        return String::new();
    };
    use std::io::Seek;
    if file.seek(io::SeekFrom::Start(offset)).is_err() {
        return String::new();
    }
    let mut bytes = Vec::new();
    let _ = file.take(1 << 20).read_to_end(&mut bytes);
    String::from_utf8_lossy(&bytes).into_owned()
}

pub fn on_gpu() -> bool {
    cfg!(target_os = "macos") || diagnostics::server_run().and_then(|r| r.backend).is_some_and(|b| b.starts_with("GPU"))
}

pub fn model_for(config: &Config, language: &str, serbian_failed: bool) -> PathBuf {
    if serbian_failed {
        return config.model.clone();
    }
    let gpu = on_gpu();
    let turbo = if gpu { crate::install::find_model(&config.server) } else { None };
    model::for_language(&config.model, language, &paths::models_dir(), gpu, turbo)
}

impl Server {
    fn running(&mut self) -> bool {
        self.child.as_mut().is_some_and(|c| matches!(c.try_wait(), Ok(None)))
    }

    fn start(&mut self, host: &str, requested: Option<u16>, language: &str) -> Value {
        if host != "127.0.0.1" && host != "localhost" {
            return error("Only 127.0.0.1/localhost is allowed");
        }
        if let Some(port) = requested {
            if reachable(port) {
                return ready(port);
            }
            return match self.launch(port, language) {
                Ok(()) => ready(port),
                Err(f) => error(f.message()),
            };
        }
        let wanted = Config::load().ok().map(|c| model_for(&c, language, self.serbian_failed));
        let same_model = wanted.is_none() || self.model == wanted;
        if let Some(port) = self.port.filter(|_| same_model && self.running()) {
            return match self.wait_ready(port) {
                Ok(()) => ready(port),
                Err(f) => error(f.message()),
            };
        }
        for attempt in 1..=START_ATTEMPTS {
            let Some(port) = pick_port() else {
                return error("no free port between 10000 and 65535");
            };
            match self.launch(port, language) {
                Ok(()) => return ready(port),
                Err(Failure::Exited(_)) if attempt < START_ATTEMPTS => continue,
                Err(f) => return error(f.message()),
            }
        }
        error("whisper-server could not start")
    }

    fn launch(&mut self, port: u16, language: &str) -> Result<(), Failure> {
        self.stop();
        let mut known = (self.vad_failed, self.serbian_failed);
        let mut guesses: Option<std::vec::IntoIter<(bool, bool)>> = None;
        loop {
            let started = self.spawn(port, language).map_err(Failure::Other)?;
            self.port = Some(port);
            let message = match self.wait_ready(port) {
                Err(Failure::Exited(message)) => message,
                result => return result,
            };
            let cause = exit_cause(&log_since(&paths::log_path(), started.log_offset));
            if cause == Cause::Model && started.serbian {
                model::discard_corrupt_serbian(&paths::models_dir());
            }
            match fallback(&cause, &started) {
                Some(Fallback::Vad) => known.0 = true,
                Some(Fallback::Serbian) => known.1 = true,
                None if cause == Cause::Unknown => {
                    let next = guesses.get_or_insert_with(|| unexplained_guesses(started.vad, started.serbian).into_iter()).next();
                    let Some((vad, serbian)) = next else {
                        (self.vad_failed, self.serbian_failed) = known;
                        return Err(Failure::Exited(message));
                    };
                    (self.vad_failed, self.serbian_failed) = (known.0 || vad, known.1 || serbian);
                    continue;
                }
                None => {
                    (self.vad_failed, self.serbian_failed) = known;
                    return Err(Failure::Exited(message));
                }
            }
            (self.vad_failed, self.serbian_failed) = known;
        }
    }

    fn spawn(&mut self, port: u16, language: &str) -> Result<Started, String> {
        let config = Config::load()?;
        let model = model_for(&config, language, self.serbian_failed);
        let vad = model::vad_args(&config.args, config.vad_on() && !self.vad_failed, &paths::models_dir());
        let log_path = paths::log_path();
        let mut log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|e| format!("cannot open {}: {e}", log_path.display()))?;
        let _ = writeln!(log, "\n=== starting {} on port {port}", config.server.display());
        let _ = writeln!(log, "=== model {}", model.display());
        let log_offset = log.metadata().map(|m| m.len()).unwrap_or(0);
        let log_err = log.try_clone().map_err(|e| e.to_string())?;

        let mut command = Command::new(&config.server);
        command
            .arg("-m")
            .arg(&model)
            .args(["--host", "127.0.0.1", "--port", &port.to_string()])
            .args(&config.args)
            .args(&vad)
            .stdin(Stdio::null())
            .stdout(log)
            .stderr(log_err);
        if let Some(dir) = config.server.parent() {
            command.current_dir(dir);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        let child = command
            .spawn()
            .map_err(|e| format!("cannot start {}: {e}", config.server.display()))?;
        self.child = Some(child);
        let started = Started { vad: !vad.is_empty(), serbian: model != config.model, log_offset };
        self.model = Some(model);
        Ok(started)
    }

    fn wait_ready(&mut self, port: u16) -> Result<(), Failure> {
        let deadline = Instant::now() + START_TIMEOUT;
        let log = paths::log_path();
        while Instant::now() < deadline {
            if let Some(child) = self.child.as_mut() {
                if let Ok(Some(status)) = child.try_wait() {
                    self.child = None;
                    self.port = None;
                    return Err(Failure::Exited(format!("whisper-server exited ({status}); see {}", log.display())));
                }
            }
            if reachable(port) {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(500));
        }
        self.stop();
        Err(Failure::Other(format!(
            "whisper-server did not start in {} s; see {}",
            START_TIMEOUT.as_secs(),
            log.display()
        )))
    }

    fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.port = None;
        self.model = None;
    }
}

pub fn run() {
    let mut stdin = io::stdin().lock();
    let mut stdout = io::stdout().lock();
    let mut server = Server { child: None, port: None, model: None, vad_failed: false, serbian_failed: false };
    update::cleanup();
    while let Ok(Some(message)) = read_message(&mut stdin) {
        let reply = match message.get("cmd").and_then(Value::as_str) {
            Some("start") => {
                let host = message.get("host").and_then(Value::as_str).unwrap_or("127.0.0.1");
                let language = message.get("language").and_then(Value::as_str).unwrap_or("");
                match message.get("port").and_then(Value::as_u64).filter(|p| *p != 0) {
                    None => server.start(host, None, language),
                    Some(port) => match u16::try_from(port) {
                        Ok(port) => server.start(host, Some(port), language),
                        Err(_) => error("invalid port"),
                    },
                }
            }
            Some("stop") => {
                server.stop();
                json!({ "status": "stopped" })
            }
            Some("info") => diagnostics::info_reply(),
            Some("checkUpdate") => update::status_reply(),
            Some("update") => update::apply_reply(),
            Some("downloadSerbianModel") => model::download_serbian_reply(),
            _ => error("unknown command"),
        };
        if write_message(&mut stdout, &reply).is_err() {
            break;
        }
    }
    server.stop();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn started(vad: bool, serbian: bool) -> Started {
        Started { vad, serbian, log_offset: 0 }
    }

    #[test]
    fn a_port_clash_disables_nothing() {
        let cause = exit_cause("\ncouldn't bind to server socket: hostname=127.0.0.1 port=50000\n");
        assert_eq!(cause, Cause::Port);
        assert_eq!(fallback(&cause, &started(true, true)), None);
    }

    #[test]
    fn a_model_that_fails_to_load_drops_only_the_serbian_model() {
        let cause = exit_cause("whisper_init_from_file_with_params_no_state: failed to load model\nerror: failed to initialize whisper context\n");
        assert_eq!(cause, Cause::Model);
        assert_eq!(fallback(&cause, &started(true, true)), Some(Fallback::Serbian));
        assert_eq!(fallback(&cause, &started(true, false)), None);
    }

    #[test]
    fn rejected_speech_detection_flags_turn_only_speech_detection_off() {
        let cause = exit_cause("error: unknown argument: --vad\n");
        assert_eq!(cause, Cause::Vad);
        assert_eq!(fallback(&cause, &started(true, true)), Some(Fallback::Vad));
    }

    #[test]
    fn an_unexplained_exit_tries_one_suspect_at_a_time_before_both() {
        assert_eq!(fallback(&Cause::Unknown, &started(true, true)), None);
        assert_eq!(unexplained_guesses(true, true), [(false, true), (true, false), (true, true)]);
        assert_eq!(unexplained_guesses(true, false), [(true, false)]);
        assert_eq!(unexplained_guesses(false, true), [(false, true)]);
        assert!(unexplained_guesses(false, false).is_empty());
    }

    #[test]
    fn only_the_output_of_this_start_is_read() {
        let path = std::env::temp_dir().join(format!("titl-log-{}", std::process::id()));
        std::fs::write(&path, "couldn't bind\nfailed to load model\n").unwrap();
        assert_eq!(exit_cause(&log_since(&path, 14)), Cause::Model);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn message_round_trip() {
        let mut buf = Vec::new();
        write_message(&mut buf, &json!({ "cmd": "start", "port": 8080 })).unwrap();
        assert_eq!(&buf[..4], &(buf.len() as u32 - 4).to_le_bytes());
        let read = read_message(&mut buf.as_slice()).unwrap().unwrap();
        assert_eq!(read["port"], 8080);
    }

    #[test]
    fn eof_ends_session() {
        assert!(read_message(&mut [].as_slice()).unwrap().is_none());
    }

    #[test]
    fn rejects_oversized_message() {
        let header = (MAX_MESSAGE as u32 + 1).to_le_bytes();
        assert!(read_message(&mut header.as_slice()).is_err());
    }

    #[test]
    fn refuses_non_local_hosts() {
        let mut server = Server { child: None, port: None, model: None, vad_failed: false, serbian_failed: false };
        assert_eq!(server.start("example.com", None, "sr")["status"], "error");
    }

    #[test]
    fn picks_free_ports_above_10000() {
        for _ in 0..20 {
            let port = pick_port().expect("a free port");
            assert!(port >= 10_000);
            assert!(TcpListener::bind(("127.0.0.1", port)).is_ok());
        }
    }
}
