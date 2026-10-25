//! How the iOS and Android apps call the core.
//!
//! One entry point takes a JSON request and returns a JSON response, so the
//! native glue in the apps stays a few lines long. Binary values travel as
//! base64url without padding, like everywhere else in the protocol.
//!
//! The device's state lives in one file in the app's private storage. It is
//! loaded by `open` and rewritten (atomically) after every change, so a crash
//! or a killed app never leaves keys half-saved.
//!
//! Requests: `{"op": "...", ...}`. Responses: `{"ok": {...}}` or
//! `{"error": {"code": "...", "message": "..."}}`.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::file_crypto::{self, FileError};
use crate::{Client, CryptoError, Incoming};

fn file_failure(error: FileError) -> Failure {
    match error {
        FileError::Io(e) => fail("storage", e.to_string()),
        FileError::Rejected => fail("rejected", "the file could not be decrypted"),
        FileError::BadKey => fail("invalid_input", "bad file key"),
    }
}

/// Most key packages created in one call.
const MAX_KEY_PACKAGES_PER_CALL: usize = 100;

struct Open {
    client: Client,
    path: PathBuf,
}

static STATE: Mutex<Option<Open>> = Mutex::new(None);

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Request {
    /// Loads the state file, or creates a new device state if there is none.
    Open {
        path: String,
        identity: String,
    },
    /// Deletes the state file and forgets everything (sign-out).
    Reset {
        path: String,
    },
    KeyPackages {
        count: usize,
    },
    CreateGroup,
    #[serde(rename_all = "camelCase")]
    AddMember {
        group_id: String,
        key_package: String,
    },
    Join {
        welcome: String,
    },
    #[serde(rename_all = "camelCase")]
    Encrypt {
        group_id: String,
        plaintext: String,
    },
    Receive {
        message: String,
    },
    #[serde(rename_all = "camelCase")]
    Members {
        group_id: String,
    },
    /// Identities are "accountId:deviceId" strings, as in `members`.
    #[serde(rename_all = "camelCase")]
    RemoveMembers {
        group_id: String,
        identities: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    GroupState {
        group_id: String,
    },
    #[serde(rename_all = "camelCase")]
    ForgetGroup {
        group_id: String,
    },
    /// Encrypts a photo or file with a new key (see `file_crypto`).
    EncryptFile {
        input: String,
        output: String,
    },
    DecryptFile {
        input: String,
        output: String,
        key: String,
    },
    /// Small values with a given key (the backup key, wrapped by a password-derived key).
    Seal {
        key: String,
        plaintext: String,
    },
    Unseal {
        key: String,
        sealed: String,
    },
    /// A key from a password (scrypt); `salt` names what it is for.
    DeriveKey {
        password: String,
        salt: String,
    },
}

#[derive(Debug)]
struct Failure {
    code: &'static str,
    message: String,
}

impl From<CryptoError> for Failure {
    fn from(error: CryptoError) -> Self {
        let code = match error {
            CryptoError::InvalidInput(_) => "invalid_input",
            CryptoError::UnknownGroup => "unknown_group",
            CryptoError::Mls(_) => "rejected",
        };
        Failure {
            code,
            message: error.to_string(),
        }
    }
}

fn fail(code: &'static str, message: impl Into<String>) -> Failure {
    Failure {
        code,
        message: message.into(),
    }
}

fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn unb64(text: &str) -> Result<Vec<u8>, Failure> {
    URL_SAFE_NO_PAD
        .decode(text)
        .map_err(|_| fail("invalid_input", "not base64url"))
}

/// Handles one JSON request; never panics across the boundary.
pub fn call(request: &[u8]) -> Vec<u8> {
    let response = match std::panic::catch_unwind(|| handle(request)) {
        Ok(Ok(value)) => json!({ "ok": value }),
        Ok(Err(failure)) => {
            json!({ "error": { "code": failure.code, "message": failure.message } })
        }
        Err(_) => json!({ "error": { "code": "internal", "message": "unexpected failure" } }),
    };
    serde_json::to_vec(&response)
        .unwrap_or_else(|_| br#"{"error":{"code":"internal","message":"encoding"}}"#.to_vec())
}

fn handle(request: &[u8]) -> Result<Value, Failure> {
    let request: Request =
        serde_json::from_slice(request).map_err(|e| fail("invalid_request", e.to_string()))?;

    // Files need no keys from the state, so they do not hold the lock (a big
    // video must not stop messages from being decrypted meanwhile).
    match request {
        Request::EncryptFile { input, output } => {
            let encrypted = file_crypto::encrypt_file(Path::new(&input), Path::new(&output))
                .map_err(file_failure)?;
            return Ok(json!({ "key": b64(&encrypted.key), "size": encrypted.size }));
        }
        Request::DecryptFile { input, output, key } => {
            file_crypto::decrypt_file(Path::new(&input), Path::new(&output), &unb64(&key)?)
                .map_err(file_failure)?;
            return Ok(json!({}));
        }
        Request::Seal { key, plaintext } => {
            let sealed =
                file_crypto::seal(&unb64(&key)?, &unb64(&plaintext)?).map_err(file_failure)?;
            return Ok(json!({ "sealed": b64(&sealed) }));
        }
        Request::Unseal { key, sealed } => {
            let plaintext =
                file_crypto::open(&unb64(&key)?, &unb64(&sealed)?).map_err(file_failure)?;
            return Ok(json!({ "plaintext": b64(&plaintext) }));
        }
        Request::DeriveKey { password, salt } => {
            if password.is_empty() || salt.is_empty() {
                return Err(fail("invalid_input", "empty password or salt"));
            }
            let key = file_crypto::derive_key(password.as_bytes(), salt.as_bytes())
                .map_err(file_failure)?;
            return Ok(json!({ "key": b64(&key) }));
        }
        _ => {}
    }

    let mut guard = STATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    match request {
        Request::Open { path, identity } => {
            let path = PathBuf::from(path);
            let client = match fs::read(&path) {
                Ok(bytes) => {
                    let client = Client::import_state(&bytes)?;
                    if client.identity() != identity.as_bytes() {
                        return Err(fail(
                            "identity_mismatch",
                            "the saved state belongs to another account or device",
                        ));
                    }
                    client
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    let client = Client::new(identity.as_bytes())?;
                    save(&path, &client)?;
                    client
                }
                Err(e) => return Err(fail("storage", e.to_string())),
            };
            let groups: Vec<String> = client.group_ids().iter().map(|id| b64(id)).collect();
            *guard = Some(Open { client, path });
            Ok(json!({ "identity": identity, "groups": groups }))
        }
        Request::Reset { path } => {
            *guard = None;
            match fs::remove_file(&path) {
                Ok(()) => Ok(json!({})),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
                Err(e) => Err(fail("storage", e.to_string())),
            }
        }
        other => {
            let open = guard
                .as_mut()
                .ok_or_else(|| fail("not_open", "call open first"))?;
            let (value, changed) = handle_open(&mut open.client, other)?;
            if changed {
                save(&open.path, &open.client)?;
            }
            Ok(value)
        }
    }
}

/// Requests that need an open state. Returns the answer and whether the state changed.
fn handle_open(client: &mut Client, request: Request) -> Result<(Value, bool), Failure> {
    Ok(match request {
        Request::KeyPackages { count } => {
            if count == 0 || count > MAX_KEY_PACKAGES_PER_CALL {
                return Err(fail("invalid_input", "count must be 1 to 100"));
            }
            let packages = (0..count)
                .map(|_| client.key_package().map(|kp| b64(&kp)))
                .collect::<Result<Vec<_>, _>>()?;
            (json!({ "keyPackages": packages }), true)
        }
        Request::CreateGroup => (json!({ "groupId": b64(&client.create_group()?) }), true),
        Request::AddMember {
            group_id,
            key_package,
        } => {
            let invitation = client.add_member(&unb64(&group_id)?, &unb64(&key_package)?)?;
            (
                json!({ "commit": b64(&invitation.commit), "welcome": b64(&invitation.welcome) }),
                true,
            )
        }
        Request::Join { welcome } => (
            json!({ "groupId": b64(&client.join(&unb64(&welcome)?)?) }),
            true,
        ),
        Request::Encrypt {
            group_id,
            plaintext,
        } => {
            let ciphertext = client.encrypt(&unb64(&group_id)?, &unb64(&plaintext)?)?;
            (json!({ "ciphertext": b64(&ciphertext) }), true)
        }
        Request::Receive { message } => {
            let value = match client.receive(&unb64(&message)?)? {
                Incoming::Message {
                    group_id,
                    sender,
                    plaintext,
                } => json!({
                    "kind": "message",
                    "groupId": b64(&group_id),
                    "sender": String::from_utf8_lossy(&sender),
                    "plaintext": b64(&plaintext),
                }),
                Incoming::GroupUpdated { group_id } => {
                    json!({ "kind": "group_updated", "groupId": b64(&group_id) })
                }
                Incoming::Ignored { group_id } => {
                    json!({ "kind": "ignored", "groupId": b64(&group_id) })
                }
            };
            (value, true)
        }
        Request::Members { group_id } => {
            let members: Vec<String> = client
                .members(&unb64(&group_id)?)?
                .iter()
                .map(|m| String::from_utf8_lossy(m).into_owned())
                .collect();
            (json!({ "members": members }), false)
        }
        Request::RemoveMembers {
            group_id,
            identities,
        } => {
            let identities: Vec<Vec<u8>> = identities.into_iter().map(String::into_bytes).collect();
            let commit = client.remove_members(&unb64(&group_id)?, &identities)?;
            (json!({ "commit": b64(&commit) }), true)
        }
        Request::GroupState { group_id } => {
            let group_id = unb64(&group_id)?;
            let members: Vec<String> = client
                .members(&group_id)?
                .iter()
                .map(|m| String::from_utf8_lossy(m).into_owned())
                .collect();
            (
                json!({ "active": client.is_active(&group_id)?, "members": members }),
                false,
            )
        }
        Request::ForgetGroup { group_id } => {
            client.forget_group(&unb64(&group_id)?)?;
            (json!({}), true)
        }
        Request::Open { .. }
        | Request::Reset { .. }
        | Request::EncryptFile { .. }
        | Request::DecryptFile { .. }
        | Request::Seal { .. }
        | Request::Unseal { .. }
        | Request::DeriveKey { .. } => unreachable!("handled before"),
    })
}

/// Writes the state next to its final place, flushes it to disk, then renames it over the old file.
fn save(path: &Path, client: &Client) -> Result<(), Failure> {
    let storage = |e: std::io::Error| fail("storage", e.to_string());
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(storage)?;
    }
    let tmp = path.with_extension("tmp");
    let mut file = fs::File::create(&tmp).map_err(storage)?;
    file.write_all(&client.export_state()).map_err(storage)?;
    file.sync_all().map_err(storage)?;
    drop(file);
    fs::rename(&tmp, path).map_err(storage)
}

// ---------------------------------------------------------------------------
// C entry points for iOS (Swift) — the caller frees results with leks_free.

/// # Safety
/// `input` must point to `len` readable bytes; `out_len` must be writable.
#[no_mangle]
pub unsafe extern "C" fn leks_call(input: *const u8, len: usize, out_len: *mut usize) -> *mut u8 {
    let request = if input.is_null() {
        &[][..]
    } else {
        std::slice::from_raw_parts(input, len)
    };
    let response = call(request).into_boxed_slice();
    *out_len = response.len();
    Box::into_raw(response) as *mut u8
}

/// # Safety
/// `ptr` and `len` must come from one `leks_call` result, freed once.
#[no_mangle]
pub unsafe extern "C" fn leks_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
    }
}

// ---------------------------------------------------------------------------
// JNI entry point for Android (Kotlin: expo.modules.lekscrypto.LeksCryptoNative.call)

#[cfg(target_os = "android")]
mod android {
    use jni::objects::{JByteArray, JClass};
    use jni::EnvUnowned;

    #[no_mangle]
    pub extern "system" fn Java_expo_modules_lekscrypto_LeksCryptoNative_call<'caller>(
        mut unowned_env: EnvUnowned<'caller>,
        _class: JClass<'caller>,
        input: JByteArray<'caller>,
    ) -> JByteArray<'caller> {
        unowned_env
            .with_env(|env| -> Result<_, jni::errors::Error> {
                let request = env.convert_byte_array(&input)?;
                env.byte_array_from_slice(&super::call(&request))
            })
            .resolve::<jni::errors::ThrowRuntimeExAndDefault>()
    }
}
