//! The key a device signs in to the server with.
//!
//! It is a separate Ed25519 key from the MLS signing key, so that a server
//! sign-in signature can never be mistaken for a chat signature, and the
//! other way round. Uses ed25519-dalek, the same Ed25519 implementation
//! OpenMLS uses for its own signatures.

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use rand_core::OsRng;

use crate::{CryptoError, CryptoResult};

/// Prefix of every sign-in signature; must match `AUTH_CONTEXT` in the protocol package.
pub const AUTH_CONTEXT: &[u8] = b"leks-auth-v1:";

/// Length of the server's challenge, in bytes.
pub const CHALLENGE_LEN: usize = 32;

/// The private half is wiped from memory when the key is dropped.
pub struct DeviceAuthKey {
    key: SigningKey,
}

impl DeviceAuthKey {
    /// Creates a new random key.
    pub fn generate() -> CryptoResult<Self> {
        Ok(Self {
            key: SigningKey::generate(&mut OsRng),
        })
    }

    /// Restores a key saved with [`DeviceAuthKey::private_key`] and
    /// [`DeviceAuthKey::public_key`]. Fails if the two halves do not belong together.
    pub fn from_parts(private_key: &[u8], public_key: &[u8]) -> CryptoResult<Self> {
        let seed: [u8; 32] = private_key
            .try_into()
            .map_err(|_| CryptoError::InvalidInput("private key must be 32 bytes".into()))?;
        let key = SigningKey::from_bytes(&seed);
        if key.verifying_key().as_bytes().as_slice() != public_key {
            return Err(CryptoError::InvalidInput(
                "private and public key do not match".into(),
            ));
        }
        Ok(Self { key })
    }

    /// The 32-byte public key the server stores at registration.
    pub fn public_key(&self) -> Vec<u8> {
        self.key.verifying_key().to_bytes().to_vec()
    }

    /// The 32-byte private key, to be kept in the iOS Keychain or Android Keystore.
    pub fn private_key(&self) -> Vec<u8> {
        self.key.to_bytes().to_vec()
    }

    /// Signs the server's sign-in challenge. Returns a 64-byte signature.
    pub fn sign_challenge(&self, challenge: &[u8]) -> CryptoResult<Vec<u8>> {
        if challenge.len() != CHALLENGE_LEN {
            return Err(CryptoError::InvalidInput(format!(
                "challenge must be {CHALLENGE_LEN} bytes"
            )));
        }
        let mut message = Vec::with_capacity(AUTH_CONTEXT.len() + challenge.len());
        message.extend_from_slice(AUTH_CONTEXT);
        message.extend_from_slice(challenge);
        Ok(self.key.sign(&message).to_bytes().to_vec())
    }
}

/// Verifies an Ed25519 signature (strict verification, as the server does).
pub fn verify(public_key: &[u8], message: &[u8], signature: &[u8]) -> bool {
    let Ok(public_key) = <[u8; 32]>::try_from(public_key) else {
        return false;
    };
    let Ok(signature) = Signature::from_slice(signature) else {
        return false;
    };
    VerifyingKey::from_bytes(&public_key)
        .and_then(|key| key.verify_strict(message, &signature))
        .is_ok()
}
