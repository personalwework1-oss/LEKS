//! Encryption of photos and files.
//!
//! Every file gets its own random 256-bit key. The file is encrypted in
//! 64 KiB chunks with AES-256-GCM in the STREAM construction (each chunk is
//! authenticated, and the last one is marked, so chunks cannot be dropped,
//! reordered or cut off). Only the ciphertext is uploaded; the key travels
//! inside the end-to-end encrypted chat message.
//!
//! Format: `LEKSF1` | 7-byte nonce prefix | chunks of (up to) 64 KiB + 16-byte tag.

use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::Path;

use aes_gcm::aead::generic_array::GenericArray;
use aes_gcm::aead::stream::{DecryptorBE32, EncryptorBE32};
use aes_gcm::aead::KeyInit;
use aes_gcm::Aes256Gcm;
use rand_core::{OsRng, RngCore};

const MAGIC: &[u8; 6] = b"LEKSF1";
const NONCE_PREFIX: usize = 7;
const CHUNK: usize = 64 * 1024;
const TAG: usize = 16;
pub const KEY_LEN: usize = 32;

#[derive(Debug, thiserror::Error)]
pub enum FileError {
    #[error("file: {0}")]
    Io(#[from] io::Error),
    /// Wrong key, damaged or tampered file.
    #[error("the file could not be decrypted")]
    Rejected,
    #[error("the key must be {KEY_LEN} bytes")]
    BadKey,
}

/// What the sender keeps to put in the chat message.
pub struct Encrypted {
    pub key: [u8; KEY_LEN],
    /// Size of the encrypted file in bytes.
    pub size: u64,
}

/// Reads until `buf` is full or the input ends; returns how much was read.
fn read_full(reader: &mut impl Read, buf: &mut [u8]) -> io::Result<usize> {
    let mut filled = 0;
    while filled < buf.len() {
        match reader.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
            Err(e) => return Err(e),
        }
    }
    Ok(filled)
}

/// Writes to `<output>.part` and renames at the end, so a half-written file never appears.
fn with_temp_output<T>(
    output: &Path,
    write: impl FnOnce(&mut BufWriter<File>) -> Result<T, FileError>,
) -> Result<T, FileError> {
    let temp = output.with_extension("part");
    let result = (|| {
        let mut writer = BufWriter::new(File::create(&temp)?);
        let value = write(&mut writer)?;
        let file = writer.into_inner().map_err(|e| e.into_error())?;
        file.sync_all()?;
        Ok(value)
    })();
    match result {
        Ok(value) => {
            fs::rename(&temp, output)?;
            Ok(value)
        }
        Err(e) => {
            let _ = fs::remove_file(&temp);
            Err(e)
        }
    }
}

/// Encrypts `input` into `output` with a new random key.
pub fn encrypt_file(input: &Path, output: &Path) -> Result<Encrypted, FileError> {
    let mut key = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);
    let mut prefix = [0u8; NONCE_PREFIX];
    OsRng.fill_bytes(&mut prefix);

    let mut reader = BufReader::new(File::open(input)?);
    let size = with_temp_output(output, |writer| {
        let cipher = Aes256Gcm::new(GenericArray::from_slice(&key));
        let mut encryptor = EncryptorBE32::from_aead(cipher, GenericArray::from_slice(&prefix));
        writer.write_all(MAGIC)?;
        writer.write_all(&prefix)?;
        let mut size = (MAGIC.len() + NONCE_PREFIX) as u64;

        let mut current = vec![0u8; CHUNK];
        let mut next = vec![0u8; CHUNK];
        let mut current_len = read_full(&mut reader, &mut current)?;
        loop {
            let next_len = if current_len == CHUNK {
                read_full(&mut reader, &mut next)?
            } else {
                0
            };
            if next_len == 0 {
                let sealed = encryptor
                    .encrypt_last(&current[..current_len])
                    .map_err(|_| FileError::Rejected)?;
                writer.write_all(&sealed)?;
                size += sealed.len() as u64;
                return Ok(size);
            }
            let sealed = encryptor
                .encrypt_next(&current[..current_len])
                .map_err(|_| FileError::Rejected)?;
            writer.write_all(&sealed)?;
            size += sealed.len() as u64;
            std::mem::swap(&mut current, &mut next);
            current_len = next_len;
        }
    })?;
    Ok(Encrypted { key, size })
}

/// Decrypts `input` into `output`; nothing is written unless the whole file checks out.
pub fn decrypt_file(input: &Path, output: &Path, key: &[u8]) -> Result<(), FileError> {
    if key.len() != KEY_LEN {
        return Err(FileError::BadKey);
    }
    let mut reader = BufReader::new(File::open(input)?);
    let mut header = [0u8; MAGIC.len() + NONCE_PREFIX];
    if read_full(&mut reader, &mut header)? != header.len() || &header[..MAGIC.len()] != MAGIC {
        return Err(FileError::Rejected);
    }
    with_temp_output(output, |writer| {
        let cipher = Aes256Gcm::new(GenericArray::from_slice(key));
        let mut decryptor =
            DecryptorBE32::from_aead(cipher, GenericArray::from_slice(&header[MAGIC.len()..]));
        let mut current = vec![0u8; CHUNK + TAG];
        let mut next = vec![0u8; CHUNK + TAG];
        let mut current_len = read_full(&mut reader, &mut current)?;
        loop {
            let next_len = if current_len == CHUNK + TAG {
                read_full(&mut reader, &mut next)?
            } else {
                0
            };
            if next_len == 0 {
                let plain = decryptor
                    .decrypt_last(&current[..current_len])
                    .map_err(|_| FileError::Rejected)?;
                writer.write_all(&plain)?;
                return Ok(());
            }
            let plain = decryptor
                .decrypt_next(&current[..current_len])
                .map_err(|_| FileError::Rejected)?;
            writer.write_all(&plain)?;
            std::mem::swap(&mut current, &mut next);
            current_len = next_len;
        }
    })
}

/// Encrypts a small value (such as a key) with a given 256-bit key: nonce | ciphertext+tag.
pub fn seal(key: &[u8], plaintext: &[u8]) -> Result<Vec<u8>, FileError> {
    use aes_gcm::aead::Aead;
    if key.len() != KEY_LEN {
        return Err(FileError::BadKey);
    }
    let cipher = Aes256Gcm::new(GenericArray::from_slice(key));
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let sealed = cipher
        .encrypt(GenericArray::from_slice(&nonce), plaintext)
        .map_err(|_| FileError::Rejected)?;
    let mut out = nonce.to_vec();
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// Opens what [`seal`] produced; fails on a wrong key or any change.
pub fn open(key: &[u8], sealed: &[u8]) -> Result<Vec<u8>, FileError> {
    use aes_gcm::aead::Aead;
    if key.len() != KEY_LEN {
        return Err(FileError::BadKey);
    }
    if sealed.len() < 12 + TAG {
        return Err(FileError::Rejected);
    }
    let cipher = Aes256Gcm::new(GenericArray::from_slice(key));
    cipher
        .decrypt(GenericArray::from_slice(&sealed[..12]), &sealed[12..])
        .map_err(|_| FileError::Rejected)
}

/// scrypt cost: 2^15 rounds, 32 MiB of memory — a fraction of a second on a
/// phone, but slow and costly for anyone guessing passwords offline.
const SCRYPT_LOG_N: u8 = 15;

/// A 32-byte key from a password. The salt says what the key is for (signing
/// in, the backup), so one never reveals the other.
pub fn derive_key(password: &[u8], salt: &[u8]) -> Result<[u8; 32], FileError> {
    let params = scrypt::Params::new(SCRYPT_LOG_N, 8, 1, 32).map_err(|_| FileError::BadKey)?;
    let mut key = [0u8; 32];
    scrypt::scrypt(password, salt, &params, &mut key).map_err(|_| FileError::BadKey)?;
    Ok(key)
}
