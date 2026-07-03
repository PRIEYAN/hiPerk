# hiPerk prover service

A Rust workspace that runs the `prove-merge` RISC Zero zkVM guest program with
a **local** prover — no external marketplace, no separate wallet, no
third-party dependency beyond the RISC Zero toolchain itself. This matches
the fact that the rest of hiPerk (contracts, payouts, x402) is Stellar-only;
proving doesn't need to pull in an unrelated chain or marketplace to work.

It exposes a small HTTP API the Node.js backend calls
(`backend/src/services/riscZeroProver.ts`, `PROVER_MODE=risc0`).

```
prover/
├── methods/
│   ├── guest/src/main.rs   # the zkVM guest program (prove-merge)
│   └── src/lib.rs          # includes the build-generated ELF/ID constants
└── host/src/main.rs        # HTTP server: runs default_prover() locally, decodes results
```

## Status — read before relying on this

This was written without a working Rust toolchain in the authoring
environment, so **none of it has been compiled**. The `risc0-zkvm` local
proving API (`default_prover()`, `ExecutorEnv::builder()`, `Receipt::journal`,
`Journal::decode()`) is stable and was cross-checked against current docs.rs
pages and RISC Zero's own Hello World tutorial (the guest program's plain
`use risc0_zkvm::guest::env;` + `entry!(main)` — no `#![no_std]`/manual
`alloc` plumbing — matches their current example exactly). Confidence here is
meaningfully higher than a marketplace integration would be, but treat this
as a first pass to compile and fix up:

- **DKIM verification is stubbed, not implemented.** The guest program
  (`methods/guest/src/main.rs`) only checks that the email looks structurally
  like a GitHub merge notification (sender, "merged" keyword, repo mention) —
  it does **not** cryptographically verify GitHub's DKIM signature. Anyone
  could hand-craft an email that passes this check. Real DKIM verification
  (parse the `DKIM-Signature` header, verify against GitHub's published
  `github.com._domainkey` public key with the `rsa`/`pkcs1` crates) needs to
  be implemented before this proof is trustworthy for anything beyond a demo.
- **Proving is CPU-bound and can be slow** — local STARK proving for a guest
  program with real crypto (once DKIM verification is added) can take
  seconds to tens of seconds depending on hardware. There's no GPU
  acceleration wired in here; see `risc0-zkvm`'s `cuda`/`metal` features if
  you need it.
- **`bincode::serialize(&receipt)`** for the `receipt_hex` response field
  was confirmed against docs.rs (`Receipt` implements `serde`), but the exact
  wire format wasn't compiled/tested — if you need a specific format for
  downstream storage, verify this on first build.

## Setup

```bash
# 1. Install the RISC Zero toolchain (rzup) and Rust, if not already present:
curl -L https://risczero.com/install | bash
rzup install

# 2. Build and run the host service:
cd prover
cargo run --release --bin host
# Listens on :8080 (override with PROVER_LISTEN_ADDR)

# While iterating, skip real proving for fast unproven receipts:
RISC0_DEV_MODE=1 cargo run --release --bin host
```

Then set `PROVER_MODE=risc0` and `PROVER_SERVICE_URL=http://localhost:8080`
in `backend/.env`.

## HTTP interface

```
POST /prove
{
  "raw_email": "...",             // full raw GitHub merge-notification email
  "repo_url": "github.com/org/repo",
  "contributor_secret": "..."     // random secret generated client-side
}

200 OK
{
  "journal_hex": "...",
  "receipt_hex": "...",  // full bincode-serialized Receipt, re-verifiable
                          // via receipt.verify(PROVE_MERGE_ID)
  "commitment": "...",   // hex, 32 bytes — anonymous membership commitment
  "nullifier": "...",    // hex, 32 bytes — unique per claim
  "repo_id": "..."
}

400 Bad Request
{ "error": "..." }
```
