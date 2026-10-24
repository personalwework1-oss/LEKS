package expo.modules.lekscrypto

/** The Rust encryption core (crates/leks-crypto), built as libleks_crypto.so. */
object LeksCryptoNative {
  init {
    System.loadLibrary("leks_crypto")
  }

  /** Takes a JSON request, returns a JSON response. See crates/leks-crypto/src/ffi.rs. */
  @JvmStatic
  external fun call(request: ByteArray): ByteArray
}
