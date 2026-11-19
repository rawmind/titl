use crate::config::Config;
use crate::paths;
use serde_json::{json, Value};
use std::fs::OpenOptions;
use std::io::{self, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const START_TIMEOUT: Duration = Duration::from_secs(110);
const MAX_MESSAGE: usize = 1 << 20;

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

struct Server {
    child: Option<Child>,
}

impl Server {
    fn start(&mut self, host: &str, port: u16) -> Value {
        if host != "127.0.0.1" && host != "localhost" {
            return error("Only 127.0.0.1/localhost is allowed");
        }
        if reachable(port) {
            return json!({ "status": "ready" });
        }
        let running = self.child.as_mut().is_some_and(|c| matches!(c.try_wait(), Ok(None)));
        if !running {
            if let Err(e) = self.spawn(port) {
                return error(e);
            }
        }
        self.wait_ready(port)
    }

    fn spawn(&mut self, port: u16) -> Result<(), String> {
        let config = Config::load()?;
        let log_path = paths::log_path();
        let mut log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|e| format!("cannot open {}: {e}", log_path.display()))?;
        let _ = writeln!(log, "\n=== starting {} on port {port}", config.server.display());
        let log_err = log.try_clone().map_err(|e| e.to_string())?;

        let mut command = Command::new(&config.server);
        command
            .arg("-m")
            .arg(&config.model)
            .args(["--host", "127.0.0.1", "--port", &port.to_string()])
            .args(&config.args)
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
        Ok(())
    }

    fn wait_ready(&mut self, port: u16) -> Value {
        let deadline = Instant::now() + START_TIMEOUT;
        let log = paths::log_path();
        while Instant::now() < deadline {
            if let Some(child) = self.child.as_mut() {
                if let Ok(Some(status)) = child.try_wait() {
                    self.child = None;
                    return error(format!("whisper-server exited ({status}); see {}", log.display()));
                }
            }
            if reachable(port) {
                return json!({ "status": "ready" });
            }
            thread::sleep(Duration::from_millis(500));
        }
        self.stop();
        error(format!(
            "whisper-server did not start in {} s; see {}",
            START_TIMEOUT.as_secs(),
            log.display()
        ))
    }

    fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub fn run() {
    let mut stdin = io::stdin().lock();
    let mut stdout = io::stdout().lock();
    let mut server = Server { child: None };
    while let Ok(Some(message)) = read_message(&mut stdin) {
        let reply = match message.get("cmd").and_then(Value::as_str) {
            Some("start") => {
                let host = message.get("host").and_then(Value::as_str).unwrap_or("127.0.0.1");
                let port = message.get("port").and_then(Value::as_u64).unwrap_or(8080);
                match u16::try_from(port) {
                    Ok(port) => server.start(host, port),
                    Err(_) => error("invalid port"),
                }
            }
            Some("stop") => {
                server.stop();
                json!({ "status": "stopped" })
            }
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
        let mut server = Server { child: None };
        assert_eq!(server.start("example.com", 8080)["status"], "error");
    }
}
