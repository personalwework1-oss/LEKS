use std::fs;

use leks_crypto::file_crypto::{decrypt_file, encrypt_file, FileError, KEY_LEN};

/// Sizes around the 64 KiB chunk boundary, plus empty and multi-chunk files.
const SIZES: &[usize] = &[0, 1, 1000, 65_535, 65_536, 65_537, 131_072, 300_001];

fn sample(len: usize) -> Vec<u8> {
    (0..len).map(|i| (i * 31 + 7) as u8).collect()
}

#[test]
fn round_trips_files_of_every_shape() {
    let dir = tempfile::tempdir().unwrap();
    for &len in SIZES {
        let plain = dir.path().join(format!("plain-{len}"));
        let sealed = dir.path().join(format!("sealed-{len}"));
        let opened = dir.path().join(format!("opened-{len}"));
        fs::write(&plain, sample(len)).unwrap();

        let encrypted = encrypt_file(&plain, &sealed).unwrap();
        assert_eq!(encrypted.size, fs::metadata(&sealed).unwrap().len());
        // Header (13 bytes) plus a 16-byte tag per chunk.
        let chunks = len.div_ceil(65_536).max(1) as u64;
        assert_eq!(encrypted.size, 13 + len as u64 + 16 * chunks, "size {len}");

        decrypt_file(&sealed, &opened, &encrypted.key).unwrap();
        assert_eq!(fs::read(&opened).unwrap(), sample(len), "size {len}");
    }
}

#[test]
fn every_file_gets_its_own_key_and_hides_its_content() {
    let dir = tempfile::tempdir().unwrap();
    let plain = dir.path().join("plain");
    let text = "Секретный документ ".repeat(500);
    fs::write(&plain, &text).unwrap();
    let a = encrypt_file(&plain, &dir.path().join("a")).unwrap();
    let b = encrypt_file(&plain, &dir.path().join("b")).unwrap();
    assert_ne!(a.key, b.key);
    let sealed = fs::read(dir.path().join("a")).unwrap();
    assert_ne!(sealed, fs::read(dir.path().join("b")).unwrap());
    assert!(!String::from_utf8_lossy(&sealed).contains("Секретный"));
}

#[test]
fn rejects_wrong_keys_and_any_tampering_without_leaving_output() {
    let dir = tempfile::tempdir().unwrap();
    let plain = dir.path().join("plain");
    let sealed = dir.path().join("sealed");
    let opened = dir.path().join("opened");
    fs::write(&plain, sample(200_000)).unwrap();
    let encrypted = encrypt_file(&plain, &sealed).unwrap();
    let good = fs::read(&sealed).unwrap();

    let wrong = [7u8; KEY_LEN];
    assert!(matches!(
        decrypt_file(&sealed, &opened, &wrong),
        Err(FileError::Rejected)
    ));
    assert!(matches!(
        decrypt_file(&sealed, &opened, &[1, 2, 3]),
        Err(FileError::BadKey)
    ));

    let mut cases: Vec<Vec<u8>> = Vec::new();
    let mut flipped = good.clone();
    flipped[100_000] ^= 1;
    cases.push(flipped);
    // Cut off after the first chunk: the "last chunk" mark is missing.
    cases.push(good[..13 + 65_536 + 16].to_vec());
    // Last chunk dropped.
    cases.push(good[..good.len() - 1].to_vec());
    // Chunks swapped.
    let mut swapped = good[..13].to_vec();
    swapped.extend_from_slice(&good[13 + 65_552..13 + 2 * 65_552]);
    swapped.extend_from_slice(&good[13..13 + 65_552]);
    swapped.extend_from_slice(&good[13 + 2 * 65_552..]);
    cases.push(swapped);
    cases.push(b"not a file".to_vec());

    for (i, bytes) in cases.iter().enumerate() {
        let bad = dir.path().join(format!("bad-{i}"));
        fs::write(&bad, bytes).unwrap();
        assert!(
            matches!(
                decrypt_file(&bad, &opened, &encrypted.key),
                Err(FileError::Rejected)
            ),
            "case {i}"
        );
        assert!(!opened.exists(), "case {i} left output behind");
        assert!(!opened.with_extension("part").exists());
    }
}

#[test]
fn works_through_the_app_interface() {
    let dir = tempfile::tempdir().unwrap();
    let plain = dir.path().join("photo.jpg");
    fs::write(&plain, sample(70_000)).unwrap();
    let call = |request: serde_json::Value| -> serde_json::Value {
        serde_json::from_slice(&leks_crypto::ffi::call(request.to_string().as_bytes())).unwrap()
    };
    // No `open` needed: files use no state.
    let sealed = dir.path().join("photo.enc");
    let answer =
        call(serde_json::json!({ "op": "encrypt_file", "input": plain, "output": sealed }));
    let key = answer["ok"]["key"].as_str().unwrap().to_string();
    assert_eq!(
        answer["ok"]["size"].as_u64().unwrap(),
        fs::metadata(&sealed).unwrap().len()
    );

    let opened = dir.path().join("photo.out");
    let answer = call(
        serde_json::json!({ "op": "decrypt_file", "input": sealed, "output": opened, "key": key }),
    );
    assert!(answer.get("ok").is_some(), "{answer}");
    assert_eq!(fs::read(&opened).unwrap(), sample(70_000));

    let answer = call(
        serde_json::json!({ "op": "decrypt_file", "input": plain, "output": opened, "key": key }),
    );
    assert_eq!(answer["error"]["code"], "rejected");
}
