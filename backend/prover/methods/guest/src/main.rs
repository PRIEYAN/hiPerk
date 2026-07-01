#![no_main]
#![no_std]

extern crate alloc;

use alloc::format;
use alloc::string::String;

use risc0_zkvm::guest::env;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

risc0_zkvm::guest::entry!(main);

/// Private input, passed in by the host — never appears in the journal.
#[derive(Deserialize)]
struct GuestInput {
    /// Full raw GitHub merge-notification email, headers included.
    raw_email: String,
    /// Repo URL as pasted by the contributor, e.g. "github.com/stellar/js-stellar-sdk".
    repo_url: String,
    /// Random secret generated client-side; only its hashes ever leave the guest.
    contributor_secret: String,
}

/// Public journal output — safe to reveal, never traces back to a GitHub identity.
#[derive(Serialize)]
struct GuestOutput {
    repo_id: String,
    commitment: [u8; 32],
    nullifier: [u8; 32],
    pr_merged: bool,
}

fn main() {
    let input: GuestInput = env::read();

    verify_merge_notification(&input.raw_email, &input.repo_url)
        .expect("merge notification verification failed");

    let repo_id = sanitize_repo_id(&input.repo_url);
    let commitment = sha256(&format!("commitment:{}:{}", repo_id, input.contributor_secret));
    let nullifier = sha256(&format!("nullifier:{}:{}", repo_id, input.contributor_secret));

    env::commit(&GuestOutput {
        repo_id,
        commitment,
        nullifier,
        pr_merged: true,
    });
}

/// Verifies the DKIM signature on the raw email and checks it is a genuine
/// GitHub PR-merge notification for `repo_url`.
///
/// NOTE: DKIM verification against GitHub's published `._domainkey` public
/// key is not implemented here — embedding and rotating that key is a build-
/// time concern (see prover/README.md). This currently checks only the
/// structural shape of the notification; wire in real DKIM verification
/// (parse `DKIM-Signature` header, verify with the `rsa`/`pkcs1` crates
/// against GitHub's public key) before treating proofs as trustworthy.
fn verify_merge_notification(raw_email: &str, repo_url: &str) -> Result<(), &'static str> {
    let lower = to_ascii_lowercase(raw_email);
    let repo_lower = to_ascii_lowercase(repo_url);

    if !lower.contains("notifications@github.com") {
        return Err("not from notifications@github.com");
    }
    if !lower.contains("merged") {
        return Err("email does not indicate a merge");
    }
    if !lower.contains(&repo_lower) {
        return Err("email does not reference the given repo");
    }
    Ok(())
}

fn sanitize_repo_id(repo_url: &str) -> String {
    let mut out = String::new();
    for c in repo_url.chars() {
        if c.is_ascii_alphanumeric() || c == '/' || c == '-' || c == '_' {
            out.push(c.to_ascii_lowercase());
        }
    }
    out
}

fn to_ascii_lowercase(s: &str) -> String {
    s.chars().map(|c| c.to_ascii_lowercase()).collect()
}

fn sha256(s: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    hasher.finalize().into()
}
