//! The phone interface (`ffi::call`) over standard input and output: one JSON
//! request per line in, one JSON response per line out. Used by the server's
//! end-to-end tests to run real encryption clients against the real server.

use std::io::{self, BufRead, Write};

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let response = leks_crypto::ffi::call(line.as_bytes());
        stdout.write_all(&response)?;
        stdout.write_all(b"\n")?;
        stdout.flush()?;
    }
    Ok(())
}
