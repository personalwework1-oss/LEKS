//! The JSON interface the apps use, including saving state to a file and
//! picking up where it left off after the app restarts.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use leks_crypto::{ffi, Client, Incoming};
use serde_json::{json, Value};

fn call(request: Value) -> Value {
    serde_json::from_slice(&ffi::call(&serde_json::to_vec(&request).unwrap())).unwrap()
}

fn ok(request: Value) -> Value {
    let response = call(request.clone());
    response
        .get("ok")
        .cloned()
        .unwrap_or_else(|| panic!("{request} failed: {response}"))
}

fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn unb64(value: &Value) -> Vec<u8> {
    URL_SAFE_NO_PAD.decode(value.as_str().unwrap()).unwrap()
}

/// One test, because the interface keeps one open state per process.
#[test]
fn app_interface_end_to_end() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.bin");
    let path_str = path.to_str().unwrap();

    // Nothing is open yet.
    assert_eq!(
        call(json!({ "op": "create_group" }))["error"]["code"],
        "not_open"
    );
    // Malformed requests are answered, not crashed on.
    assert_eq!(
        call(json!({ "op": "no_such_op" }))["error"]["code"],
        "invalid_request"
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&ffi::call(b"not json")).unwrap()["error"]["code"],
        "invalid_request"
    );

    // The app opens its device state: a new file is created.
    let opened = ok(json!({ "op": "open", "path": path_str, "identity": "alice-acc:alice-dev" }));
    assert_eq!(opened["groups"], json!([]));
    assert!(path.exists());

    // Bob is another device (library API) who published a key package.
    let mut bob = Client::new(b"bob-acc:bob-dev").unwrap();
    let group_id = ok(json!({ "op": "create_group" }))["groupId"].clone();
    let invitation = ok(json!({
        "op": "add_member",
        "groupId": group_id,
        "keyPackage": b64(&bob.key_package().unwrap()),
    }));
    bob.join(&unb64(&invitation["welcome"])).unwrap();

    let members = ok(json!({ "op": "members", "groupId": group_id }))["members"].clone();
    assert_eq!(members, json!(["alice-acc:alice-dev", "bob-acc:bob-dev"]));

    let sent =
        ok(json!({ "op": "encrypt", "groupId": group_id, "plaintext": b64("Привет".as_bytes()) }));
    match bob.receive(&unb64(&sent["ciphertext"])).unwrap() {
        Incoming::Message {
            plaintext, sender, ..
        } => {
            assert_eq!(plaintext, "Привет".as_bytes());
            assert_eq!(sender, b"alice-acc:alice-dev");
        }
        other => panic!("expected a message, got {other:?}"),
    }

    // The app is closed and reopened: everything continues from the file.
    let reopened = ok(json!({ "op": "open", "path": path_str, "identity": "alice-acc:alice-dev" }));
    assert_eq!(reopened["groups"], json!([group_id]));

    let reply = bob.encrypt(&unb64(&group_id), b"hi after restart").unwrap();
    let received = ok(json!({ "op": "receive", "message": b64(&reply) }));
    assert_eq!(received["kind"], "message");
    assert_eq!(received["sender"], "bob-acc:bob-dev");
    assert_eq!(unb64(&received["plaintext"]), b"hi after restart");

    // Key packages made before a restart still let others start chats after it.
    let packages = ok(json!({ "op": "key_packages", "count": 3 }))["keyPackages"].clone();
    assert_eq!(packages.as_array().unwrap().len(), 3);
    ok(json!({ "op": "open", "path": path_str, "identity": "alice-acc:alice-dev" }));
    let carol_group = {
        let mut carol = Client::new(b"carol-acc:carol-dev").unwrap();
        let group = carol.create_group().unwrap();
        let invite = carol.add_member(&group, &unb64(&packages[0])).unwrap();
        let joined = ok(json!({ "op": "join", "welcome": b64(&invite.welcome) }));
        assert_eq!(unb64(&joined["groupId"]), group);
        let message = carol.encrypt(&group, b"from carol").unwrap();
        let got = ok(json!({ "op": "receive", "message": b64(&message) }));
        assert_eq!(unb64(&got["plaintext"]), b"from carol");
        group
    };

    // Another account's state is never opened by mistake.
    let mismatch = call(json!({ "op": "open", "path": path_str, "identity": "someone-else" }));
    assert_eq!(mismatch["error"]["code"], "identity_mismatch");

    // Errors from the encryption layer come back as codes.
    ok(json!({ "op": "open", "path": path_str, "identity": "alice-acc:alice-dev" }));
    assert_eq!(
        call(json!({ "op": "encrypt", "groupId": b64(b"nope"), "plaintext": b64(b"x") }))["error"]
            ["code"],
        "unknown_group"
    );
    assert_eq!(
        call(json!({ "op": "receive", "message": "!!" }))["error"]["code"],
        "invalid_input"
    );
    assert!(ok(json!({ "op": "members", "groupId": b64(&carol_group) }))["members"].is_array());

    // Sign-out removes the state.
    ok(json!({ "op": "reset", "path": path_str }));
    assert!(!path.exists());
    assert_eq!(
        call(json!({ "op": "create_group" }))["error"]["code"],
        "not_open"
    );
}
