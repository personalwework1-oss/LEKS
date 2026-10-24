#pragma once
#include <stddef.h>
#include <stdint.h>

// The Rust encryption core (crates/leks-crypto/src/ffi.rs).
// Takes a JSON request; returns a JSON response that must be released with leks_free.
uint8_t *leks_call(const uint8_t *input, size_t len, size_t *out_len);
void leks_free(uint8_t *ptr, size_t len);
