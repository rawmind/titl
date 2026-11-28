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

type Stamp = (PathBuf, Option<SystemTime>, u64);
type Guesses = (std::vec::IntoIter<(bool, bool)>, Stamp, Option<Stamp>);

fn stamp(path: &Path) -> Stamp {
    let meta = std::fs::metadata(path).ok();
    (path.to_path_buf(), meta.as_ref().and_then(|m| m.modified().ok()), meta.map_or(0, |m| m.len()))
}

#[derive(Default)]
struct Server {
    child: Option<Child>,
    port: Option<u16>,
    model: Option<PathBuf>,
    vad_failed: Option<Stamp>,
    serbian_failed: Option<Stamp>,
}

struct Started {
    vad: bool,
    serbian: bool,
    server: Stamp,
    model: Option<Stamp>,
    log_offset: u64,
}

#[derive(Debug, PartialEq)]
enum Cause {
    Port,
    Model,
    Vad,
    Unknown,
}

fn vad_line(line: &str) -> bool {
    (line.contains("unknown argument") && line.contains("--vad"))
        || (line.starts_with("whisper_vad") && (line.contains("failed") || line.contains("error")))
        || line.contains("failed to initialize vad")
}

fn exit_cause(output: &str) -> Cause {
    let lower = output.to_lowercase();
    let lines = || lower.lines().map(str::trim).filter(|l| !l.starts_with("==="));
    if lower.contains("couldn't bind") || lower.contains("address already in use") {
        Cause::Port
    } else if lines().any(vad_line) {
        Cause::Vad
    } else if lower.contains("failed to initialize whisper context") || lower.contains("failed to load model") {
        Cause::Model
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

fn gpu_from(macos: bool, logged: Option<bool>, installed: Option<bool>) -> bool {
    macos || logged.or(installed).unwrap_or(false)
}

pub fn on_gpu(config: &Config) -> bool {
    gpu_from(cfg!(target_os = "macos"), diagnostics::logged_gpu(), config.gpu)
}

fn still_failed(failed: Option<&Stamp>, path: &Path) -> bool {
    failed.is_some_and(|f| *f == stamp(path))
}

pub fn model_for(config: &Config, language: &str, serbian_failed: Option<&Stamp>) -> PathBuf {
    let gpu = on_gpu(config);
    let turbo = if gpu { crate::install::find_model(&config.server) } else { None };
    let choice = model::for_language(&config.model, language, &paths::models_dir(), gpu, turbo);
    if choice != config.model && still_failed(serbian_failed, &choice) {
        return config.model.clone();
    }
    choice
}

impl Server {
    fn running(&mut self) -> bool {
        self.child.as_mut().is_some_and(|c| matches!(c.try_wait(), Ok(None)))
    }

    fn start(&mut self, host: &str, requested: Option<u16>, language: &str) -> Value {
        if host != "127.0.0.1" && host != "localhost" {
            return error("Only 127.0.0.1/localhost is allowed");
        }
        let deadline = Instant::now() + START_TIMEOUT;
        if let Some(port) = requested {
            if reachable(port) {
                return ready(port);
            }
            return match self.launch(port, language, deadline) {
                Ok(()) => ready(port),
                Err(f) => error(f.message()),
            };
        }
        let wanted = Config::load().ok().map(|c| model_for(&c, language, self.serbian_failed.as_ref()));
        let same_model = wanted.is_none() || self.model == wanted;
        if let Some(port) = self.port.filter(|_| same_model && self.running()) {
            return match self.wait_ready(port, deadline) {
                Ok(()) => ready(port),
                Err(f) => error(f.message()),
            };
        }
        let mut last = None;
        for _ in 1..=START_ATTEMPTS {
            if Instant::now() >= deadline {
                break;
            }
            let Some(port) = pick_port() else {
                return error("no free port between 10000 and 65535");
            };
            match self.launch(port, language, deadline) {
                Ok(()) => return ready(port),
                Err(Failure::Exited(message)) => last = Some(message),
                Err(f) => return error(f.message()),
            }
        }
        error(last.unwrap_or_else(|| "whisper-server could not start".into()))
    }

    fn remember(&mut self, flags: &(Option<Stamp>, Option<Stamp>)) {
        (self.vad_failed, self.serbian_failed) = flags.clone();
    }

    fn launch(&mut self, port: u16, language: &str, deadline: Instant) -> Result<(), Failure> {
        self.stop();
        let mut known = (self.vad_failed.clone(), self.serbian_failed.clone());
        let mut guesses: Option<Guesses> = None;
        loop {
            let started = match self.spawn(port, language) {
                Ok(started) => started,
                Err(e) => {
                    self.remember(&known);
                    return Err(Failure::Other(e));
                }
            };
            self.port = Some(port);
            let message = match self.wait_ready(port, deadline) {
                Ok(()) => return Ok(()),
                Err(Failure::Exited(message)) => message,
                Err(other) => {
                    self.remember(&known);
                    return Err(other);
                }
            };
            let cause = exit_cause(&log_since(&paths::log_path(), started.log_offset));
            if cause == Cause::Model && started.serbian {
                model::discard_corrupt_serbian(&paths::models_dir());
            }
            match fallback(&cause, &started) {
                Some(Fallback::Vad) => known.0 = Some(started.server.clone()),
                Some(Fallback::Serbian) => known.1 = started.model.clone(),
                None if cause == Cause::Unknown => {
                    let (list, server, model) = guesses.get_or_insert_with(|| {
                        (unexplained_guesses(started.vad, started.serbian).into_iter(), started.server.clone(), started.model.clone())
                    });
                    let Some((vad, serbian)) = list.next() else {
                        self.remember(&known);
                        return Err(Failure::Exited(message));
                    };
                    self.vad_failed = if vad { Some(server.clone()) } else { known.0.clone() };
                    self.serbian_failed = if serbian { model.clone() } else { known.1.clone() };
                    continue;
                }
                None => {
                    self.remember(&known);
                    return Err(Failure::Exited(message));
                }
            }
            self.remember(&known);
        }
    }

    fn spawn(&mut self, port: u16, language: &str) -> Result<Started, String> {
        let config = Config::load()?;
        let model = model_for(&config, language, self.serbian_failed.as_ref());
        let vad_off = still_failed(self.vad_failed.as_ref(), &config.server);
        let vad = model::vad_args(&config.args, config.vad_on() && !vad_off, &paths::models_dir());
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
        let swapped = model != config.model;
        let started = Started {
            vad: !vad.is_empty(),
            serbian: swapped,
            server: stamp(&config.server),
            model: swapped.then(|| stamp(&model)),
            log_offset,
        };
        self.model = Some(model);
        Ok(started)
    }

    fn wait_ready(&mut self, port: u16, deadline: Instant) -> Result<(), Failure> {
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
    let mut server = Server::default();
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
        Started { vad, serbian, server: stamp(Path::new("whisper-server")), model: None, log_offset: 0 }
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
        let mut server = Server::default();
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

    #[test]
    fn a_gpu_is_known_from_the_install_before_any_server_has_run() {
        assert!(gpu_from(false, None, Some(true)));
        assert!(!gpu_from(false, None, None));
        assert!(!gpu_from(false, None, Some(false)));
        assert!(gpu_from(false, Some(true), Some(false)));
        assert!(!gpu_from(false, Some(false), Some(true)));
        assert!(gpu_from(true, Some(false), None));
    }

    #[test]
    fn a_failure_is_forgotten_once_the_file_changes() {
        let path = std::env::temp_dir().join(format!("titl-stamp-{}", std::process::id()));
        std::fs::write(&path, "old").unwrap();
        let failed = stamp(&path);
        assert!(still_failed(Some(&failed), &path));
        std::fs::write(&path, "replaced").unwrap();
        assert!(!still_failed(Some(&failed), &path));
        assert!(!still_failed(None, &path));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn speech_detection_is_blamed_only_for_its_own_errors() {
        let path = "=== model C:\\Users\\vadim\\m.bin\nwhisper_init_from_file: loading model from 'C:\\Users\\vadim\\m.bin'\nerror: failed to load model\n";
        assert_eq!(exit_cause(path), Cause::Model);
        assert_eq!(exit_cause("whisper_vad_init_from_file_with_params: failed to load model\n"), Cause::Vad);
        assert_eq!(exit_cause("error: unknown argument: --vad-model\n"), Cause::Vad);
        assert_eq!(exit_cause("error: unknown argument: --flash\nsomething failed\n"), Cause::Unknown);
    }

    #[test]
    fn a_start_that_is_out_of_time_fails_at_once() {
        let mut server = Server::default();
        let started = Instant::now();
        assert!(matches!(server.wait_ready(1, Instant::now()), Err(Failure::Other(_))));
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
