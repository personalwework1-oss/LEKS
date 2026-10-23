//! End-to-end encryption core for the messenger.
//!
//! Built on [OpenMLS](https://github.com/openmls/openmls), an implementation of
//! the Messaging Layer Security protocol (IETF RFC 9420). Every chat, including
//! a one-to-one chat, is an MLS group. The server only ever sees the opaque
//! byte strings this crate produces: key packages, commits, welcomes and
//! encrypted application messages.
//!
//! This first version keeps state in memory. Persistent storage on the device
//! (SQLite) and the bindings for the mobile apps are added in the next stage.

use std::collections::HashMap;

use openmls::prelude::{tls_codec::*, *};
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;

/// The single cipher suite used by every client: X25519 key exchange,
/// AES-128-GCM encryption, SHA-256 hashing and Ed25519 signatures.
pub const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;

/// Longest identity accepted for a client, in bytes.
pub const MAX_IDENTITY_LEN: usize = 256;

/// Messages are padded to a multiple of this many bytes so their length
/// reveals less about their content.
const PADDING_SIZE: usize = 32;

/// How many messages may arrive out of order, and how far ahead a message
/// may be, before it is rejected.
const OUT_OF_ORDER_TOLERANCE: u32 = 20;
const MAXIMUM_FORWARD_DISTANCE: u32 = 1000;

/// Errors returned by this crate.
#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    /// The input bytes are not what the call expects.
    #[error("invalid input: {0}")]
    InvalidInput(String),
    /// The message belongs to a group this client is not a member of.
    #[error("unknown group")]
    UnknownGroup,
    /// OpenMLS rejected the operation, for example a forged or replayed message.
    #[error("encryption error: {0}")]
    Mls(String),
}

/// Result type of this crate.
pub type CryptoResult<T> = std::result::Result<T, CryptoError>;

fn mls<E: std::fmt::Debug>(error: E) -> CryptoError {
    CryptoError::Mls(format!("{error:?}"))
}

/// What an invitation of a new member produces. Both parts are sent through
/// the server: the commit to everyone already in the group, the welcome to
/// the new member only.
#[derive(Debug, Clone)]
pub struct Invitation {
    pub commit: Vec<u8>,
    pub welcome: Vec<u8>,
}

/// The outcome of receiving a message from the server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Incoming {
    /// A chat message, decrypted.
    Message {
        group_id: Vec<u8>,
        sender: Vec<u8>,
        plaintext: Vec<u8>,
    },
    /// The group changed (a member was added or removed, or keys rotated)
    /// and the new state has been applied.
    GroupUpdated { group_id: Vec<u8> },
    /// A valid message that needs no action, such as this client's own
    /// message echoed back by the server.
    Ignored { group_id: Vec<u8> },
}

/// One device's encryption state: its signing identity and the groups it is in.
pub struct Client {
    provider: OpenMlsRustCrypto,
    signer: SignatureKeyPair,
    credential: CredentialWithKey,
    groups: HashMap<Vec<u8>, MlsGroup>,
}

impl Client {
    /// Creates a client with a new signing key for `identity`, for example
    /// an account and device id.
    pub fn new(identity: &[u8]) -> CryptoResult<Self> {
        if identity.is_empty() || identity.len() > MAX_IDENTITY_LEN {
            return Err(CryptoError::InvalidInput(format!(
                "identity must be 1 to {MAX_IDENTITY_LEN} bytes"
            )));
        }
        let provider = OpenMlsRustCrypto::default();
        let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).map_err(mls)?;
        signer.store(provider.storage()).map_err(mls)?;
        let credential = CredentialWithKey {
            credential: BasicCredential::new(identity.to_vec()).into(),
            signature_key: signer.to_public_vec().into(),
        };
        Ok(Self {
            provider,
            signer,
            credential,
            groups: HashMap::new(),
        })
    }

    /// The identity this client was created with.
    pub fn identity(&self) -> &[u8] {
        self.credential.credential.serialized_content()
    }

    /// The public signing key that identifies this client to others.
    pub fn signature_public_key(&self) -> Vec<u8> {
        self.signer.to_public_vec()
    }

    /// Creates a single-use key package. Clients upload a batch of these to
    /// the server so others can add them to chats while they are offline.
    pub fn key_package(&self) -> CryptoResult<Vec<u8>> {
        let bundle = KeyPackage::builder()
            .build(
                CIPHERSUITE,
                &self.provider,
                &self.signer,
                self.credential.clone(),
            )
            .map_err(mls)?;
        MlsMessageOut::from(bundle.key_package().clone())
            .to_bytes()
            .map_err(mls)
    }

    /// Starts a new group with this client as its only member and returns
    /// the group id.
    pub fn create_group(&mut self) -> CryptoResult<Vec<u8>> {
        let config = MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .padding_size(PADDING_SIZE)
            .sender_ratchet_configuration(sender_ratchet())
            .build();
        let group = MlsGroup::new(
            &self.provider,
            &self.signer,
            &config,
            self.credential.clone(),
        )
        .map_err(mls)?;
        let group_id = group.group_id().as_slice().to_vec();
        self.groups.insert(group_id.clone(), group);
        Ok(group_id)
    }

    /// Adds the owner of `key_package` to the group.
    ///
    /// In this version the change is applied locally right away. Once the
    /// server orders commits, it will be applied only after the server
    /// accepts it.
    pub fn add_member(&mut self, group_id: &[u8], key_package: &[u8]) -> CryptoResult<Invitation> {
        let key_package = parse_key_package(&self.provider, key_package)?;
        let group = self
            .groups
            .get_mut(group_id)
            .ok_or(CryptoError::UnknownGroup)?;
        let (commit, welcome, _group_info) = group
            .add_members(
                &self.provider,
                &self.signer,
                core::slice::from_ref(&key_package),
            )
            .map_err(mls)?;
        group.merge_pending_commit(&self.provider).map_err(mls)?;
        Ok(Invitation {
            commit: commit.to_bytes().map_err(mls)?,
            welcome: welcome.to_bytes().map_err(mls)?,
        })
    }

    /// Joins a group from a welcome message and returns the group id.
    pub fn join(&mut self, welcome: &[u8]) -> CryptoResult<Vec<u8>> {
        let message = MlsMessageIn::tls_deserialize_exact(welcome)
            .map_err(|e| CryptoError::InvalidInput(format!("not an MLS message: {e:?}")))?;
        let welcome = match message.extract() {
            MlsMessageBodyIn::Welcome(welcome) => welcome,
            _ => return Err(CryptoError::InvalidInput("not a welcome message".into())),
        };
        let config = MlsGroupJoinConfig::builder()
            .use_ratchet_tree_extension(true)
            .padding_size(PADDING_SIZE)
            .sender_ratchet_configuration(sender_ratchet())
            .build();
        let group = StagedWelcome::new_from_welcome(&self.provider, &config, welcome, None)
            .map_err(mls)?
            .into_group(&self.provider)
            .map_err(mls)?;
        let group_id = group.group_id().as_slice().to_vec();
        self.groups.insert(group_id.clone(), group);
        Ok(group_id)
    }

    /// Encrypts a chat message for everyone in the group.
    pub fn encrypt(&mut self, group_id: &[u8], plaintext: &[u8]) -> CryptoResult<Vec<u8>> {
        let group = self
            .groups
            .get_mut(group_id)
            .ok_or(CryptoError::UnknownGroup)?;
        group
            .create_message(&self.provider, &self.signer, plaintext)
            .map_err(mls)?
            .to_bytes()
            .map_err(mls)
    }

    /// Processes a message received from the server: decrypts chat messages
    /// and applies group changes.
    pub fn receive(&mut self, bytes: &[u8]) -> CryptoResult<Incoming> {
        let message = MlsMessageIn::tls_deserialize_exact(bytes)
            .map_err(|e| CryptoError::InvalidInput(format!("not an MLS message: {e:?}")))?;
        let protocol_message = message
            .try_into_protocol_message()
            .map_err(|_| CryptoError::InvalidInput("not a group message".into()))?;
        let group_id = protocol_message.group_id().as_slice().to_vec();
        let group = self
            .groups
            .get_mut(&group_id)
            .ok_or(CryptoError::UnknownGroup)?;
        let processed = group
            .process_message(&self.provider, protocol_message)
            .map_err(mls)?;
        let sender = processed.credential().serialized_content().to_vec();
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(message) => Ok(Incoming::Message {
                group_id,
                sender,
                plaintext: message.into_bytes(),
            }),
            ProcessedMessageContent::StagedCommitMessage(staged_commit) => {
                group
                    .merge_staged_commit(&self.provider, *staged_commit)
                    .map_err(mls)?;
                Ok(Incoming::GroupUpdated { group_id })
            }
            ProcessedMessageContent::ProposalMessage(proposal) => {
                group
                    .store_pending_proposal(self.provider.storage(), *proposal)
                    .map_err(mls)?;
                Ok(Incoming::GroupUpdated { group_id })
            }
            _ => Ok(Incoming::Ignored { group_id }),
        }
    }

    /// Number of members in the group.
    pub fn member_count(&self, group_id: &[u8]) -> CryptoResult<usize> {
        self.groups
            .get(group_id)
            .map(|group| group.members().count())
            .ok_or(CryptoError::UnknownGroup)
    }

    /// Identities of the group's members.
    pub fn members(&self, group_id: &[u8]) -> CryptoResult<Vec<Vec<u8>>> {
        self.groups
            .get(group_id)
            .map(|group| {
                group
                    .members()
                    .map(|member| member.credential.serialized_content().to_vec())
                    .collect()
            })
            .ok_or(CryptoError::UnknownGroup)
    }
}

fn sender_ratchet() -> SenderRatchetConfiguration {
    SenderRatchetConfiguration::new(OUT_OF_ORDER_TOLERANCE, MAXIMUM_FORWARD_DISTANCE)
}

/// Parses and verifies a key package received from the server: checks its
/// signatures, lifetime and protocol version.
fn parse_key_package(provider: &OpenMlsRustCrypto, bytes: &[u8]) -> CryptoResult<KeyPackage> {
    let message = MlsMessageIn::tls_deserialize_exact(bytes)
        .map_err(|e| CryptoError::InvalidInput(format!("not an MLS message: {e:?}")))?;
    match message.extract() {
        MlsMessageBodyIn::KeyPackage(key_package) => key_package
            .validate(provider.crypto(), ProtocolVersion::Mls10)
            .map_err(mls),
        _ => Err(CryptoError::InvalidInput("not a key package".into())),
    }
}
