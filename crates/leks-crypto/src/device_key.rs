//! The key a device signs in to the server with.
//!
//! It is a separate Ed25519 key from the MLS signing key, so that a server
//! sign-in signature can never be mistaken for a chat signature, and the
//! other way round.

use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::RustCrypto;
use openmls_traits::{crypto::OpenMlsCrypto, signatures::Signer, types::SignatureScheme};

use crate::{CryptoError, CryptoResult};

/// Prefix of every sign-in signature; must match `AUTH_CONTEXT` in the protocol package.
pub const AUTH_CONTEXT: &[u8] = b"leks-auth-v1:";

/// Length of the server's challenge, in bytes.
pub const CHALLENGE_LEN: usize = 32;

pub struct DeviceAuthKey {
    key: SignatureKeyPair,
}

impl DeviceAuthKey {
    /// Creates a new random key.
    pub fn generate() -> CryptoResult<Self> {
        let key = SignatureKeyPair::new(SignatureScheme::ED25519)
            .map_err(|e| CryptoError::Mls(format!("{e:?}")))?;
        Ok(Self { key })
    }

    /// Restores a key saved with [`DeviceAuthKey::private_key`] and
    /// [`DeviceAuthKey::public_key`]. Fails if the two halves do not belong together.
    pub fn from_parts(private_key: &[u8], public_key: &[u8]) -> CryptoResult<Self> {
        if private_key.len() != 32 || public_key.len() != 32 {
            return Err(CryptoError::InvalidInput("device keys are 32 bytes".into()));
        }
        let key = Self {
            key: SignatureKeyPair::from_raw(
                SignatureScheme::ED25519,
                private_key.to_vec(),
                public_key.to_vec(),
            ),
        };
        let probe = b"leks-key-check";
        let signature = key
            .key
            .sign(probe)
            .map_err(|e| CryptoError::InvalidInput(format!("unusable private key: {e:?}")))?;
        if !verify(public_key, probe, &signature) {
            return Err(CryptoError::InvalidInput(
                "private and public key do not match".into(),
            ));
        }
        Ok(key)
    }

    /// The 32-byte public key the server stores at registration.
    pub fn public_key(&self) -> Vec<u8> {
        self.key.to_public_vec()
    }

    /// The 32-byte private key, to be kept in the iOS Keychain or Android Keystore.
    pub fn private_key(&self) -> Vec<u8> {
        self.key.private().to_vec()
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
        self.key
            .sign(&message)
            .map_err(|e| CryptoError::Mls(format!("{e:?}")))
    }
}

/// Verifies an Ed25519 signature.
pub fn verify(public_key: &[u8], message: &[u8], signature: &[u8]) -> bool {
    RustCrypto::default()
        .verify_signature(SignatureScheme::ED25519, message, public_key, signature)
        .is_ok()
}
