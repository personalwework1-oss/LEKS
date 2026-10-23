//! The device sign-in key must produce exactly the signatures the server
//! verifies. The vector in fixtures/auth-vector.json is checked here and in
//! the server's tests.

use leks_crypto::{verify_ed25519, DeviceAuthKey, AUTH_CONTEXT};

const VECTOR: &str = include_str!("../../../fixtures/auth-vector.json");

/// Reads `"name": "hex"` from the fixture without pulling in a JSON parser.
fn field(name: &str) -> Vec<u8> {
    let key = format!("\"{name}\": \"");
    let start = VECTOR.find(&key).expect("field present") + key.len();
    let end = start + VECTOR[start..].find('"').expect("closing quote");
    let hex = &VECTOR[start..end];
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
        .collect()
}

#[test]
fn signature_matches_the_shared_vector() {
    let key = DeviceAuthKey::from_parts(&field("seedHex"), &field("publicKeyHex")).unwrap();
    let signature = key.sign_challenge(&field("challengeHex")).unwrap();
    assert_eq!(signature, field("signatureHex"));
}

#[test]
fn generated_keys_sign_verifiable_challenges() {
    let key = DeviceAuthKey::generate().unwrap();
    assert_eq!(key.public_key().len(), 32);
    assert_eq!(key.private_key().len(), 32);

    let challenge = [7u8; 32];
    let signature = key.sign_challenge(&challenge).unwrap();
    assert_eq!(signature.len(), 64);

    let mut message = AUTH_CONTEXT.to_vec();
    message.extend_from_slice(&challenge);
    assert!(verify_ed25519(&key.public_key(), &message, &signature));
    assert!(!verify_ed25519(&key.public_key(), &challenge, &signature));
}

#[test]
fn keys_survive_a_save_and_restore() {
    let key = DeviceAuthKey::generate().unwrap();
    let restored = DeviceAuthKey::from_parts(&key.private_key(), &key.public_key()).unwrap();
    let challenge = [1u8; 32];
    assert_eq!(
        key.sign_challenge(&challenge).unwrap(),
        restored.sign_challenge(&challenge).unwrap()
    );
}

#[test]
fn mismatched_or_malformed_keys_are_rejected() {
    let a = DeviceAuthKey::generate().unwrap();
    let b = DeviceAuthKey::generate().unwrap();
    assert!(DeviceAuthKey::from_parts(&a.private_key(), &b.public_key()).is_err());
    assert!(DeviceAuthKey::from_parts(&[1u8; 31], &a.public_key()).is_err());
    assert!(a.sign_challenge(&[0u8; 16]).is_err());
}
