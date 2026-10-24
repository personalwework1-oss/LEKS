//! Stage 0 acceptance: an encrypted message travels between two clients, and
//! the protections a messenger relies on hold.

use leks_crypto::{Client, CryptoError, Incoming};

/// Alice creates a chat and invites Bob, as two separate devices would.
fn alice_and_bob() -> (Client, Client, Vec<u8>) {
    let mut alice = Client::new(b"alice").unwrap();
    let mut bob = Client::new(b"bob").unwrap();

    let group_id = alice.create_group().unwrap();
    let bob_key_package = bob.key_package().unwrap();
    let invitation = alice.add_member(&group_id, &bob_key_package).unwrap();
    let joined = bob.join(&invitation.welcome).unwrap();
    assert_eq!(joined, group_id);

    (alice, bob, group_id)
}

#[test]
fn alice_and_bob_exchange_messages() {
    let (mut alice, mut bob, group_id) = alice_and_bob();

    let ciphertext = alice.encrypt(&group_id, "Привет, Боб!".as_bytes()).unwrap();
    assert_eq!(
        bob.receive(&ciphertext).unwrap(),
        Incoming::Message {
            group_id: group_id.clone(),
            sender: b"alice".to_vec(),
            plaintext: "Привет, Боб!".as_bytes().to_vec(),
        }
    );

    let reply = bob.encrypt(&group_id, b"Hi Alice").unwrap();
    assert_eq!(
        alice.receive(&reply).unwrap(),
        Incoming::Message {
            group_id: group_id.clone(),
            sender: b"bob".to_vec(),
            plaintext: b"Hi Alice".to_vec(),
        }
    );

    assert_eq!(alice.member_count(&group_id).unwrap(), 2);
    assert_eq!(
        bob.members(&group_id).unwrap(),
        vec![b"alice".to_vec(), b"bob".to_vec()]
    );
}

#[test]
fn many_messages_in_both_directions() {
    let (mut alice, mut bob, group_id) = alice_and_bob();
    for i in 0..100 {
        let text = format!("message {i}");
        let (from, to) = if i % 3 == 0 {
            (&mut bob, &mut alice)
        } else {
            (&mut alice, &mut bob)
        };
        let ciphertext = from.encrypt(&group_id, text.as_bytes()).unwrap();
        match to.receive(&ciphertext).unwrap() {
            Incoming::Message { plaintext, .. } => assert_eq!(plaintext, text.as_bytes()),
            other => panic!("expected a message, got {other:?}"),
        }
    }
}

#[test]
fn ciphertext_does_not_contain_plaintext() {
    let (mut alice, _bob, group_id) = alice_and_bob();
    let secret = b"the server must never see this sentence";
    let ciphertext = alice.encrypt(&group_id, secret).unwrap();
    assert!(!ciphertext
        .windows(8)
        .any(|window| secret.windows(8).any(|part| part == window)));
}

#[test]
fn tampered_message_is_rejected() {
    let (mut alice, mut bob, group_id) = alice_and_bob();
    let mut ciphertext = alice.encrypt(&group_id, b"pay 10 euro").unwrap();
    let last = ciphertext.len() - 1;
    ciphertext[last] ^= 0x01;
    assert!(bob.receive(&ciphertext).is_err());
}

#[test]
fn replayed_message_is_rejected() {
    let (mut alice, mut bob, group_id) = alice_and_bob();
    let ciphertext = alice.encrypt(&group_id, b"once").unwrap();
    assert!(matches!(
        bob.receive(&ciphertext),
        Ok(Incoming::Message { .. })
    ));
    assert!(bob.receive(&ciphertext).is_err());
}

#[test]
fn outsider_cannot_read_the_chat() {
    let (mut alice, _bob, group_id) = alice_and_bob();
    let mut eve = Client::new(b"eve").unwrap();
    let ciphertext = alice.encrypt(&group_id, b"private").unwrap();
    assert!(matches!(
        eve.receive(&ciphertext),
        Err(CryptoError::UnknownGroup)
    ));
}

#[test]
fn third_member_joins_and_everyone_reads_each_other() {
    let (mut alice, mut bob, group_id) = alice_and_bob();
    let mut carol = Client::new(b"carol").unwrap();

    let invitation = alice
        .add_member(&group_id, &carol.key_package().unwrap())
        .unwrap();
    assert_eq!(
        bob.receive(&invitation.commit).unwrap(),
        Incoming::GroupUpdated {
            group_id: group_id.clone()
        }
    );
    carol.join(&invitation.welcome).unwrap();

    let ciphertext = carol.encrypt(&group_id, b"hello from carol").unwrap();
    for reader in [&mut alice, &mut bob] {
        match reader.receive(&ciphertext).unwrap() {
            Incoming::Message {
                sender, plaintext, ..
            } => {
                assert_eq!(sender, b"carol");
                assert_eq!(plaintext, b"hello from carol");
            }
            other => panic!("expected a message, got {other:?}"),
        }
    }
    assert_eq!(bob.member_count(&group_id).unwrap(), 3);
}

#[test]
fn messages_from_before_joining_stay_unreadable() {
    let (mut alice, mut bob, group_id) = alice_and_bob();
    let before = alice
        .encrypt(&group_id, b"sent before carol joined")
        .unwrap();
    assert!(bob.receive(&before).is_ok());

    let mut carol = Client::new(b"carol").unwrap();
    let invitation = alice
        .add_member(&group_id, &carol.key_package().unwrap())
        .unwrap();
    carol.join(&invitation.welcome).unwrap();
    assert!(carol.receive(&before).is_err());
}

#[test]
fn invalid_inputs_are_rejected() {
    assert!(Client::new(b"").is_err());
    assert!(Client::new(&[b'x'; 257]).is_err());

    let mut alice = Client::new(b"alice").unwrap();
    let group_id = alice.create_group().unwrap();
    assert!(alice.add_member(&group_id, b"not a key package").is_err());
    assert!(alice.join(b"not a welcome").is_err());
    assert!(alice.receive(b"garbage").is_err());

    // A key package is not a welcome, and a welcome is not a key package.
    let bob = Client::new(b"bob").unwrap();
    assert!(alice.join(&bob.key_package().unwrap()).is_err());
}

#[test]
fn state_survives_export_and_import() {
    let (mut alice, bob, group_id) = alice_and_bob();
    let saved = bob.export_state();
    drop(bob);
    let mut bob = Client::import_state(&saved).unwrap();
    assert_eq!(bob.identity(), b"bob");
    assert_eq!(bob.group_ids(), vec![group_id.clone()]);

    let ciphertext = alice.encrypt(&group_id, b"after restart").unwrap();
    assert!(matches!(
        bob.receive(&ciphertext).unwrap(),
        Incoming::Message { plaintext, .. } if plaintext == b"after restart"
    ));
    let reply = bob.encrypt(&group_id, b"still here").unwrap();
    assert!(matches!(
        alice.receive(&reply).unwrap(),
        Incoming::Message { .. }
    ));

    // A corrupted state is refused instead of half-loaded.
    let mut broken = bob.export_state();
    broken.truncate(broken.len() - 3);
    assert!(Client::import_state(&broken).is_err());
    assert!(Client::import_state(b"garbage").is_err());
}
