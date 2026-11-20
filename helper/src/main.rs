mod config;
mod extension;
mod host;
mod install;
mod model;
mod paths;
mod whisper_cpp;

use std::env;
use std::io::{self, Write};
use std::process::ExitCode;

const HELP: &str = "titl: installs and runs whisper-server for the Titl Chrome extension

USAGE:
  titl install [--server PATH | --update-server [--cpu]] [--model PATH | --download-model NAME] [--extension-id ID]
  titl uninstall [--purge]
  titl status
  titl --version

install         Find whisper-server and a model (downloading one if needed), copy this helper
                to a per-user folder and register it with Chrome, Chromium, Edge and Brave.
--server        Path to whisper-server (default: PATH and common whisper.cpp build folders).
                On Windows and Linux, if none is found, a prebuilt whisper.cpp is downloaded
                (CUDA build with an NVIDIA GPU, otherwise CPU).
--update-server Download the newest prebuilt whisper.cpp even if one is installed.
--cpu           Use the CPU build even if an NVIDIA GPU is present.
--model         Path to a ggml model file. Default: large-v3-turbo with a GPU, small without.
--download-model
                Download a model by name, e.g. large-v3-turbo, large-v3-turbo-q5_0, small.
--extension-id  Also accept this extension ID (e.g. a Chrome Web Store build). Remembered.
uninstall       Unregister and remove the helper. --purge also deletes downloaded models.
status          Show the configuration and where the helper is registered.

The Titl extension needs this helper. Chrome starts this program itself (with the extension's origin as argument) to launch
whisper-server on demand.";

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.first().is_some_and(|a| a.starts_with("chrome-extension://")) {
        host::run();
        return ExitCode::SUCCESS;
    }
    let double_clicked = args.is_empty() && started_from_explorer();
    let result = match args.first().map(String::as_str) {
        None if double_clicked => {
            println!("Setting up Titl's helper...");
            println!();
            install::parse(&[]).and_then(install::install)
        }
        Some("install") => install::parse(&args[1..]).and_then(install::install),
        Some("uninstall") => install::uninstall(args.iter().any(|a| a == "--purge")),
        Some("status") => install::status(),
        Some("--version" | "-V" | "version") => {
            println!("titl {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        None | Some("help" | "-h" | "--help") => {
            println!("{HELP}");
            Ok(())
        }
        Some(other) => Err(format!("unknown command: {other} (see --help)")),
    };
    let code = match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    };
    if double_clicked {
        print!("\nPress Enter to close this window.");
        let _ = io::stdout().flush();
        let _ = io::stdin().read_line(&mut String::new());
    }
    code
}

#[cfg(windows)]
fn started_from_explorer() -> bool {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetConsoleProcessList(list: *mut u32, count: u32) -> u32;
    }
    let mut list = [0u32; 2];
    unsafe { GetConsoleProcessList(list.as_mut_ptr(), list.len() as u32) == 1 }
}

#[cfg(not(windows))]
fn started_from_explorer() -> bool {
    false
}
