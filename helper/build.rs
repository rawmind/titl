#[cfg(windows)]
fn main() {
    println!("cargo:rerun-if-changed=windows/titl.manifest");
    println!("cargo:rerun-if-changed=windows/titl.ico");
    let mut res = winresource::WindowsResource::new();
    res.set("ProductName", "Titl")
        .set("FileDescription", "Titl helper: runs whisper.cpp for the Titl browser extension")
        .set("CompanyName", "Andrei Kovrov")
        .set("LegalCopyright", "Copyright (c) 2026 Andrei Kovrov. MIT License.")
        .set("OriginalFilename", "titl.exe")
        .set("InternalName", "titl")
        .set("Comments", "https://github.com/rawmind/titl")
        .set_icon("windows/titl.ico")
        .set_manifest_file("windows/titl.manifest");
    res.compile().expect("cannot embed Windows resources");
}

#[cfg(not(windows))]
fn main() {}
