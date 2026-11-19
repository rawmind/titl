mod config;
mod extension;
mod host;
mod install;
mod model;
mod paths;

use std::env;
use std::process::ExitCode;

const HELP: &str = "chrome-transcriber-helper: installs and runs whisper-server for Chrome Transcriber

USAGE:
  chrome-transcriber-helper install [--server PATH] [--model PATH | --download-model NAME] [--extension-id ID]
  chrome-transcriber-helper uninstall [--purge]
  chrome-transcriber-helper status

install         Find whisper-server and a model (downloading one if needed), copy this helper
                to a per-user folder and register it with Chrome, Chromium, Edge and Brave.
--server        Path to whisper-server (default: PATH and common whisper.cpp build folders).
--model         Path to a ggml model file.
--download-model
                Download a model by name, e.g. large-v3-turbo, large-v3-turbo-q5_0, small.
--extension-id  Also accept this extension ID (e.g. a Chrome Web Store build). Remembered.
uninstall       Unregister and remove the helper. --purge also deletes downloaded models.
status          Show the configuration and where the helper is registered.

Titl (the Chrome Transcriber extension) needs this helper. Chrome starts this program itself (with the extension's origin as argument) to launch
whisper-server on demand.";

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.first().is_some_and(|a| a.starts_with("chrome-extension://")) {
        host::run();
        return ExitCode::SUCCESS;
    }
    let result = match args.first().map(String::as_str) {
        Some("install") => install::parse(&args[1..]).and_then(install::install),
        Some("uninstall") => install::uninstall(args.iter().any(|a| a == "--purge")),
        Some("status") => install::status(),
        None | Some("help" | "-h" | "--help") => {
            println!("{HELP}");
            Ok(())
        }
        Some(other) => Err(format!("unknown command: {other} (see --help)")),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}
