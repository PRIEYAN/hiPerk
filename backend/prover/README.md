# hiPerk prover service

A Rust workspace that runs the `prove-merge` RISC Zero zkVM guest program and
outsources actual proof generation to the [Boundless](https://boundless.xyz)
decentralized proving market, exposing a small HTTP API the Node.js backend
calls (`backend/src/services/riscZeroProver.ts`, `PROVER_MODE=boundless`).

```
prover/
├── methods/
│   ├── guest/src/main.rs   # the zkVM guest program (prove-merge)
│   └── src/lib.rs          # includes the build-generated ELF/ID constants
└── host/src/main.rs        # HTTP server: submits proofs to Boundless, decodes results
```

## Status — read before relying on this

This was written without a working Rust toolchain in the authoring
environment, so **none of it has been compiled**. It's built carefully against
real, verified crate APIs (`risc0-zkvm` 3.x, `boundless-market` 2.0.1), but
treat it as a first pass to compile and fix up, not a finished artifact:

- **Bonsai is deprecated.** RISC Zero's docs now point to Boundless, a
  decentralized on-chain proving marketplace, as the replacement. That's what
  this service targets — but it means proving now requires an
  Ethereum-compatible wallet + RPC (for the Boundless market), not just an API
  key like Bonsai used.
- **Boundless's own docs site (`docs.beboundless.xyz`) had an expired TLS
  certificate** at the time this was written, so the exact request/offer
  pricing API (`OfferParams`, min/max price, timeout) could not be confirmed
  against canonical examples. `host/src/main.rs` uses `client.submit(request)`
  with default pricing — if requests aren't picked up by provers, you'll need
  to set explicit offer params; check current Boundless docs for the
  `request_builder` API once the site is reachable.
- **DKIM verification is stubbed, not implemented.** The guest program
  (`methods/guest/src/main.rs`) only checks that the email looks structurally
  like a GitHub merge notification (sender, "merged" keyword, repo mention) —
  it does **not** cryptographically verify GitHub's DKIM signature. Anyone
  could hand-craft an email that passes this check. Real DKIM verification
  (parse the `DKIM-Signature` header, verify against GitHub's published
  `github.com._domainkey` public key with the `rsa`/`pkcs1` crates) needs to
  be implemented before this proof is trustworthy for anything beyond a demo.
- **`FulfillmentDataImageIdAndJournal` field access** (`data.imageId`,
  `data.journal`) and the `risc0_zkvm::serde` (postcard) encoding used for the
  guest journal/input were both cross-checked against docs.rs, but not
  against a compiler. Small type mismatches (e.g. `Bytes` vs `Vec<u8>`) are
  the most likely first build errors.

## Setup

```bash
# 1. Install the RISC Zero toolchain (rzup) and Rust, if not already present:
curl -L https://risczero.com/install | bash
rzup install

# 2. Fund an Ethereum-compatible wallet for the Boundless market and set:
export BOUNDLESS_RPC_URL=<an EVM RPC endpoint on Boundless's supported chain>
export BOUNDLESS_PRIVATE_KEY=<funded wallet private key>

# 3. Build and run the host service:
cd prover
cargo run --release --bin host
# Listens on :8080 (override with PROVER_LISTEN_ADDR)
```

Then set `PROVER_MODE=boundless` and `PROVER_SERVICE_URL=http://localhost:8080`
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
  "seal_hex": "...",
  "commitment": "...",   // hex, 32 bytes — anonymous membership commitment
  "nullifier": "...",    // hex, 32 bytes — unique per claim
  "repo_id": "..."
}

400 Bad Request
{ "error": "..." }
```
