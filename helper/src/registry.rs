#[cfg(windows)]
mod imp {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    pub fn set_default(key: &str, value: &str) -> Result<(), String> {
        let (k, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(key)
            .map_err(|e| format!(r"cannot create HKCU\{key}: {e}"))?;
        k.set_value("", &value).map_err(|e| format!(r"cannot write HKCU\{key}: {e}"))
    }

    pub fn delete(key: &str) {
        let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(key);
    }

    pub fn exists(key: &str) -> bool {
        RegKey::predef(HKEY_CURRENT_USER).open_subkey(key).is_ok()
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn set_default(key: &str, _value: &str) -> Result<(), String> {
        Err(format!(r"HKCU\{key}: the registry only exists on Windows"))
    }

    pub fn delete(_key: &str) {}

    pub fn exists(_key: &str) -> bool {
        false
    }
}

pub use imp::{delete, exists, set_default};
