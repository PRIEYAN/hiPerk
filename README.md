<p align="center">
  <img src="assets/banner.png" alt="hiPerk" width="100%" />
</p>

<h1 align="center">hiPerk</h1>

<p align="center">
  <b>Anonymous, gas-free contributor rewards on Stellar — powered by RISC Zero zero-knowledge proofs and x402 pay-per-proof metering.</b>
</p>

<p align="center">
  <a href="#-what-it-is">What it is</a> ·
  <a href="#-how-it-works">How it works</a> ·
  <a href="#-the-zk-part-in-detail">The ZK part</a> ·
  <a href="#-x402-pay-per-proof">x402</a> ·
  <a href="#-quickstart">Quickstart</a> ·
  <a href="#-repo-layout">Layout</a>
</p>

---

## 💡 What it is

**hiPerk lets a developer prove they landed a merged pull request in a Stellar-ecosystem GitHub repo — and get paid for it — without ever revealing who they are.**

Open-source maintainers and funders (e.g. the Stellar Development Foundation, or individual project teams) fund a reward pool per repo. A contributor who gets a PR merged submits *proof of the merge* — not their identity — and the pool pays out USDC to any Stellar address they choose. The contributor never doxxes themselves, never pays a network fee, and never touches an on-chain wallet full of gas.

Three pieces make that possible, and each maps to a real technology in this repo:

| Requirement | How hiPerk solves it | Tech |
|---|---|---|
| Prove "my PR merged" **without revealing who I am** | A zero-knowledge proof over a GitHub merge-notification email; only a commitment + nullifier leave the prover | **RISC Zero zkVM** |
| Pay for that proof compute **without invoices or accounts** | The backend pays the prover per request over HTTP, settled in USDC | **x402** |
| Pay out the reward **anonymously, instantly, gas-free** | Soroban contracts hold the pool and pay out; every tx is fee-bump sponsored | **Stellar / Soroban** |

---

## 🎯 The real-world use case

Under-resourced open-source repos struggle to attract contributors. Public bounty programs help — but they exclude a large slice of talented developers who **cannot or will not claim publicly**:

- engineers at competing companies,
- contributors in restrictive jurisdictions,
- people who simply don't want a permanent public record of "I work on crypto."

A normal bounty form forces you to reveal a GitHub identity and a wallet linked to your name. hiPerk removes that. You prove *the work happened* (a merge into the sponsored repo) while proving *nothing about who did it*. The funder gets an aggregate, anonymous view — "X claims paid, Y pool remaining" — and never learns *who* claimed.

> **Concrete flow:** SDF funds a pool for `stellar/js-stellar-sdk`. A developer at a rival exchange lands a bugfix PR there. GitHub emails them "your PR was merged." They paste that email into hiPerk, a ZK proof is generated, and USDC lands in a fresh Stellar address they control — with zero fees, and no link back to their employer or identity.

---

## ⚙️ How it works

```
┌──────────────────────┐
│  Frontend (web app)   │  Contributor portal + maintainer dashboard  (TanStack Start / React)
└───────────┬──────────┘
            │  REST
┌───────────▼──────────────────────────────────────────────┐
│  Backend / API  (Node + TypeScript, Express)               │
│  ─ orchestrates the whole claim pipeline                   │
│  ─ pays the prover over x402                               │
│  ─ signs + fee-bump-sponsors every Soroban transaction     │
└───────┬───────────────────────────┬───────────────────────┘
        │  POST /prove (x402-metered)│  Soroban RPC (fee-bumped)
        ▼                            ▼
┌────────────────────────┐   ┌───────────────────────────────┐
│  Prover host (Rust)     │   │  Stellar testnet (Soroban)     │
│  ─ RISC Zero zkVM        │   │  ─ Gatekeeper  (membership)     │
│  ─ prove-merge guest     │   │  ─ Perk        (pool + payout)  │
│  ─ local proving         │   │  ─ USDC SAC     (the token)     │
└────────────────────────┘   └───────────────────────────────┘
```

### End-to-end claim pipeline

1. **PR merges.** GitHub sends the contributor the standard "your pull request was merged" email.
2. **Submit evidence.** The contributor pastes that raw email (+ their repo URL + a client-side random secret) into the web app.
3. **Pay for the proof (x402).** Before the claim endpoint does any work, the request passes an [x402](#-x402-pay-per-proof) payment gate — a tiny USDC micropayment on Stellar, settled over plain HTTP. No account, no invoice.
4. **Generate the ZK proof (RISC Zero).** The backend calls the Rust **prover host**, which runs the `prove-merge` zkVM guest program. The guest verifies the email is a genuine GitHub merge notification for that repo and emits a public *journal* — a `commitment` and a `nullifier` — while the raw email and the contributor's secret **never leave the proof boundary**.
5. **Register anonymous membership (Gatekeeper).** The backend submits the `commitment` to the **Gatekeeper** Soroban contract, which records "this anonymous commitment belongs to this repo's contributor group." No identity, no wallet linkage.
6. **Claim the reward (Perk).** On approval, the backend calls the **Perk** contract's `claim`, which:
   - cross-checks membership with the Gatekeeper (`is_member`),
   - rejects a reused `nullifier` (so the same merged PR can't be paid twice),
   - transfers USDC from the funded pool to the contributor's Stellar address.
7. **Zero fees for the contributor.** Every Soroban transaction is wrapped in a **fee-bump transaction** paid by the app's relayer account, so the contributor's address never needs XLM for gas.
8. **Anonymous dashboard.** The maintainer sees aggregate claim/pool stats — never *who* claimed.

> **Trust model (hackathon MVP — "Option A hybrid"):** proof *verification* and orchestration run in a trusted backend relayer; the on-chain contracts stay minimal (membership bookkeeping, nullifier tracking, payout). Because both Soroban contracts **and** RISC Zero guests are written in Rust, there is a credible path to moving proof verification fully on-chain later (Option B) — see [plan.md](plan.md) §6.

---

## 🔐 The ZK part, in detail

This is the heart of hiPerk, so it's worth being precise about *what is proven*, *what stays secret*, and *how double-claiming is prevented*.

### The zkVM guest program

The proof is produced by a **RISC Zero zkVM guest program** — a small Rust program (`prove-merge`) that runs inside the zkVM. Whatever it reads as *private input* is never revealed; whatever it *commits to the journal* is the public, verifiable output.

- **File:** [`backend/prover/methods/guest/src/main.rs`](backend/prover/methods/guest/src/main.rs)
- **Private input (never revealed):**
  - `raw_email` — the full raw GitHub merge-notification email, headers and all
  - `repo_url` — the repo the PR was merged into
  - `contributor_secret` — a random secret generated client-side
- **Public output (the *journal* — safe to reveal):**
  - `repo_id` — normalized repo identifier
  - `commitment = sha256("commitment:" + repo_id + ":" + secret)` — the anonymous membership credential
  - `nullifier  = sha256("nullifier:"  + repo_id + ":" + secret)` — a unique-per-claim tag
  - `pr_merged: true`

### What the proof actually asserts

Inside the guest, `verify_merge_notification()` checks the email is a real GitHub PR-merge notification for the claimed repo. The zkVM then produces a **receipt** — a cryptographic attestation that *this exact program ran on some input and produced this journal*. The host re-verifies it against the program's image ID:

```rust
receipt.verify(PROVE_MERGE_ID)?;   // proves: the prove-merge program really ran and produced this journal
```

So a verifier learns **"a merged PR into `repo_id` exists, attested by an email that passed the check"** — and learns **nothing** about the email contents, the contributor's GitHub handle, or their secret.

### Why a commitment *and* a nullifier?

This split is the classic anonymity-plus-uniqueness pattern:

- **`commitment`** proves membership ("I am *a* verified contributor to this repo") without revealing *which* one. It's what gets registered in the Gatekeeper.
- **`nullifier`** is deterministically derived from the same secret, so the *same* underlying claim always yields the *same* nullifier. The Perk contract marks a nullifier as spent on payout, so **the same merged PR can never be paid twice** — even though the contract never learns who the contributor is.

Both are 32-byte SHA-256 outputs, carried on-chain as `BytesN<32>`.

### Local proving — no external marketplace

hiPerk runs proving **locally** via RISC Zero's `default_prover()` on the prover host ([`backend/prover/host/src/main.rs`](backend/prover/host/src/main.rs)) — **no third-party proving marketplace and no second chain**. This is deliberate: the rest of hiPerk (contracts, payouts, x402) is Stellar-only, so proving shouldn't drag in an unrelated network. The host exposes one endpoint:

```
POST /prove  { raw_email, repo_url, contributor_secret }
      → 200  { journal_hex, receipt_hex, commitment, nullifier, repo_id }
```

The Node backend calls it when `PROVER_MODE=risc0` ([`backend/src/services/riscZeroProver.ts`](backend/src/services/riscZeroProver.ts)). In `PROVER_MODE=mock` (default) it derives the same commitment/nullifier shape deterministically off-chain, so the whole flow — including the double-claim guard — runs offline for demos.

> ⚠️ **Honest status:** DKIM signature verification in the guest is currently **stubbed** — it checks the email's *structure* (sender, "merged" keyword, repo mention) but does **not yet** cryptographically verify GitHub's DKIM signature. Wire in real DKIM verification (parse the `DKIM-Signature` header, verify against GitHub's published public key with the `rsa`/`pkcs1` crates) before treating proofs as trustworthy beyond a demo. See [`backend/prover/README.md`](backend/prover/README.md).

---

## 💸 x402: pay-per-proof

**[x402](https://www.x402.org/)** is an open, HTTP-native payment protocol — it revives the dormant HTTP `402 Payment Required` status code so a server can demand a stablecoin micropayment *inline* on a request, with no accounts, API keys, or invoices.

hiPerk uses it as the **payment gate on `POST /claims`**. Generating a ZK proof costs real compute; x402 meters that cost per request:

- On an unpaid request, the endpoint replies `402 Payment Required` with the price and the receiving Stellar address.
- The client attaches a settled USDC micropayment; a **facilitator** verifies and settles it on Stellar.
- Only then does the request reach the proof pipeline.

This backend **never holds contributor funds** — it only declares a price and a `payTo` address, and delegates verification/settlement to an x402 facilitator via `@x402/core`'s `HTTPFacilitatorClient`, using the Stellar *exact* payment scheme (`@x402/stellar`). See [`backend/src/services/x402Payment.ts`](backend/src/services/x402Payment.ts).

Payment is gated behind config, so the whole app still runs end-to-end for demos when no facilitator is configured:

```
X402_MODE=live  +  a valid http(s) X402_FACILITATOR_URL  +  X402_PAY_TO  →  real payment enforced
anything else                                                             →  mock (pass-through)
```

---

## 🌟 Why Stellar for the payout leg

- **Genuinely gas-free for the recipient.** Native **fee-bump transactions** let the app's relayer sponsor every fee, so a contributor's address never needs XLM to receive a reward.
- **Cheap, instant settlement** — ideal for paying out many small/medium reimbursements at scale.
- **USDC rails already exist** on Stellar, so payouts are in a stable, useful asset.
- **Rust all the way down.** Soroban contracts and RISC Zero guests are both Rust — a natural fit, and a real path toward on-chain proof verification later.

---

## 🚀 Quickstart

> **Prerequisites:** Node 18+, and (for real proving) the Rust + RISC Zero toolchain. Proving is typically built/run on a separate machine with that toolchain.

```bash
# 1. Backend
cd backend
cp .env.example .env          # fill in contract IDs, relayer key, token, modes
npm install
npm run dev                   # http://localhost:4000

# 2. Prover host (on the Rust/RISC Zero machine) — only for PROVER_MODE=risc0
cd backend/prover
cargo run --release --bin host   # http://localhost:8080

# 3. Frontend
cd frontend
npm install
npm run dev
```

### Modes at a glance

| Env var | Values | Meaning |
|---|---|---|
| `CHAIN_MODE` | `auto` \| `mock` \| `live` | Whether to submit real Soroban transactions |
| `PROVER_MODE` | `mock` \| `risc0` | Deterministic mock proof vs. real local RISC Zero proving |
| `X402_MODE` | `mock` \| `live` | Whether to enforce the x402 payment gate on `/claims` |

Everything defaults to a fully-offline **mock** path, so you can run the entire pipeline without a chain, a prover, or a facilitator. Flip each mode to `live`/`risc0` independently as you wire up real infrastructure.

### Readiness check

```bash
./test-live.sh   # verifies .env, funded accounts, USDC trustline, prover + backend reachability, then runs the smoke test
```

---

## 🗂 Repo layout

```
hiPerk/
├── frontend/                 # TanStack Start + React web app (contributor portal + dashboard)
│   └── src/routes/           # onboarding, submit-proof, my-claims, review, dashboard, claim.$id
├── backend/                  # Node + TypeScript orchestration API (Express)
│   ├── src/
│   │   ├── routes/           # /modules, /claims
│   │   ├── services/         # stellarClient, feeBumpRelayer, riscZeroProver, x402Payment
│   │   └── config.ts         # mode flags (chain / prover / x402)
│   ├── scripts/smoke.ts      # end-to-end smoke test
│   └── prover/               # Rust RISC Zero prover (local proving, no marketplace)
│       ├── methods/guest/    # the prove-merge zkVM guest program  ← the ZK logic
│       └── host/             # HTTP server exposing POST /prove
├── blockchain/
│   └── contracts/
│       ├── gatekeeper/       # anonymous membership registry (Soroban / Rust)
│       └── perk/             # funded reward pool + nullifier-guarded payout
├── plan.md                   # architecture + rationale
├── implementation.md         # build-ready interfaces & data model
└── test-live.sh              # live-testnet readiness checklist + smoke test
```

---

## 📚 Further reading

- [`plan.md`](plan.md) — full architecture, trust model, and the "why Stellar" rationale
- [`implementation.md`](implementation.md) — exact contract interfaces, API routes, and data model
- [`backend/prover/README.md`](backend/prover/README.md) — prover setup and the DKIM-verification caveat
