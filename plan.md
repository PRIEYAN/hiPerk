# Plan: Anonymous Contributor Rewards on Stellar (working name: StellarPerks)

## 1. One-line pitch
A web application that lets developers anonymously prove they got a pull request merged into a Stellar ecosystem GitHub repo, using a RISC Zero zero-knowledge proof, and automatically triggers gas-fee-less compensation (funded by Stellar/SDF or repo sponsors) paid out on the Stellar network — without ever revealing who the contributor is.

## 2. What it is (form factor)
**It's a website (web app), not a desktop/CLI tool.** Reasoning:
- Contributors need a low-friction way to submit proof of a merged PR and generate a ZK proof. A browser-based flow is the standard pattern for this kind of consumer-facing proving app.
- Repo admins/maintainers need a dashboard to see verified claims and fund/approve compensation pools.
- No local install required — works for any contributor, on any machine, ideally even mobile, since proof generation is offloaded to a remote proving network rather than run on the user's device.

So the architecture is: **frontend web app + backend services + RISC Zero proving + Soroban smart contracts on Stellar**, not a single monolithic "tool you run locally."

## 3. High-Level Architecture

```
┌─────────────────────┐
│   Frontend (Web)     │  Contributor portal + Admin dashboard
└──────────┬───────────┘
           │
┌──────────▼────────────┐
│   Backend / API        │  Orchestrates proof requests, talks to
│   (Node/TS service)    │  RISC Zero proving + Stellar/Soroban RPC
└──────────┬────────────┘
           │
   ┌───────┴─────────────────┐
   ▼                         ▼
┌───────────────────────┐  ┌──────────────────────────┐
│ RISC Zero Proving       │  │  Stellar Network          │
│ (zkVM guest program +   │  │  (Soroban contracts)       │
│ Boundless prover market,│  │  - Gatekeeper               │
│ paid per-proof via x402)│  │  - Group registry            │
└───────────────────────┘  │  - Perk/reward pool           │
                             │  - Fee-bump sponsor account   │
                             └──────────────────────────┘
```

## 4. End-to-end user flow

1. Contributor opens a PR against a Stellar ecosystem repo (e.g. an SDF-listed project).
2. PR gets merged → GitHub sends the standard "your PR was merged" notification email/webhook event.
3. Contributor goes to the web app and submits this evidence (the DKIM-signed email, or a GitHub webhook attestation).
4. The backend sends a **proof request to a RISC Zero zkVM guest program**: a Rust program that checks the DKIM signature and PR-merge conditions and outputs a verifiable proof — without exposing the raw email content. This proof generation is outsourced to **Boundless**, RISC Zero's decentralized proving marketplace, rather than run on the contributor's own machine.
5. The proving marketplace charges a small per-proof fee. This fee is metered and settled using **x402** — the open HTTP-native stablecoin payment protocol — so the backend (acting as the paying client) automatically pays for proof generation per request, with no manual invoicing.
6. Backend receives the resulting proof + receipt, and submits it to the **Gatekeeper contract** on Soroban.
7. Gatekeeper verifies the RISC Zero proof and registers an anonymous membership commitment into that repo's contributor group — no wallet identity tied to the real-world person beyond a Stellar address they control.
8. Contributor uses that membership to submit an anonymous claim to a **Perk contract** (signal = the specific perk/repo's compensation pool).
9. Perk contract checks: (a) valid group membership, (b) nullifier not already used (prevents double-claiming the same merged PR). If valid, it pays out from the funded pool directly to a Stellar address the contributor provides.
10. **The contributor pays zero network fees for any of this.** All Stellar/Soroban transactions in this flow are wrapped in a **fee-bump transaction** sponsored by the app's own operational account, so the contributor's wallet never needs to hold XLM just to cover gas — a fully gas-fee-less experience end to end.
11. Admin dashboard shows the repo maintainer/SDF funder an aggregated, anonymous view: "X claims paid out, Y pool remaining" — never *who* claimed.

## 5. Why this needs to be on Stellar specifically (the answer to "who funds it and why")
- **Funder:** Stellar Development Foundation (SDF) or individual ecosystem project teams who want their repos developed and are already running grant/bounty programs.
- **Why they'd use this instead of a normal bounty form:** privacy. Some contributors (employees of competitors, people in restrictive jurisdictions, people who don't want public "I work for crypto" exposure) won't claim public bounties but will claim anonymous ones. This widens the contributor pool for under-resourced repos.
- **Why Stellar's tech is a good fit for the payout leg specifically:** fast, extremely cheap settlement, native fee-sponsorship (fee-bump transactions / sponsored reserves) for a genuinely gas-fee-less claim experience, and SDF already runs stablecoin rails (USDC) — ideal for "pay out small/medium reimbursements at scale, anonymously, instantly, with zero fee friction for the recipient."

## 6. Important technical reality check (must address explicitly in the pitch)

### 6.1 Soroban is Rust/WASM, not Solidity/EVM
Stellar's smart contract platform, **Soroban**, is Rust/WASM-based — not Solidity/EVM. The original zkGitPerks stack (Solidity + Semaphore) does not run natively on Soroban. There are two honest paths:

- **Option A — Hybrid (recommended for hackathon timeline):** Keep proof generation (RISC Zero) and verification logic off-chain or on a lightweight verifier service. Once a proof is verified, the backend calls a **native Soroban (Rust) contract** that only handles: group membership bookkeeping, nullifier tracking, and the actual reward payout.
- **Option B — Pure Soroban-native rebuild (stretch goal):** Implement RISC Zero proof verification natively inside a Soroban contract (Rust-native, which is actually a *better* fit than Solidity-based verifiers, since both Soroban and RISC Zero's guest programs are Rust).

**Plan: build Option A as the MVP.** Notably, RISC Zero is a *better long-term fit for Stellar than Solidity-based Semaphore was* — both Soroban contracts and RISC Zero zkVM guest programs are written in Rust, so there's a real, demoable path to Option B as a stretch goal, unlike the original Solidity/Semaphore stack.

### 6.2 RISC Zero already has Stellar precedent
This isn't a stretch combination — Nethermind has already deployed RISC Zero verifiers for a Stellar zk-bridge integration, enabling cross-chain proofs between Stellar's low-cost payment network and Ethereum's security guarantees. This is a strong point for the pitch: **verifying RISC Zero proofs in a Stellar-compatible context is precedented infrastructure, not a hackathon-only experiment.**

### 6.3 What RISC Zero actually buys us over the original zkEmail-only approach
- RISC Zero is a **general-purpose zkVM**: instead of writing a narrow zkEmail circuit just for DKIM verification, we write a normal Rust guest program that checks DKIM signatures *and* any additional PR-merge logic (e.g., parsing a GitHub webhook payload), and it outputs a STARK proof (which can be compressed to Groth16 for cheap on-chain verification).
- This makes the system easier to extend later — e.g., proving other kinds of contribution evidence (issue triage, code review counts) without writing a new custom circuit each time, since it's just more Rust code in the guest program.
- Proof generation can be outsourced to **Boundless** (RISC Zero's decentralized prover marketplace) instead of requiring contributors to run heavy proving computation locally — good for the "works on any machine, even mobile" requirement from Section 2.

## 7. Components breakdown

### 7.1 Frontend (Web app)
- Contributor view: connect wallet (Stellar wallet, e.g. Freighter), submit PR-merge evidence, see claim status, submit claim, receive gas-fee-less payout.
- Admin/funder view: see funded pools per repo, total payouts (aggregate only), top up pool balance.
- Stack: React + TypeScript, Stellar Wallet Kit / Freighter integration, Tailwind for styling.

### 7.2 Backend / API service
- Orchestrates: receives proof requests, calls the RISC Zero/Boundless proving network (paying per-proof via x402), submits resulting proof to the Soroban contract via Stellar SDK, tracks claim status, and wraps all contributor-facing transactions in fee-bump sponsorship.
- Stack: Node.js + TypeScript, Stellar SDK / soroban-client.

### 7.3 RISC Zero Proving Layer
- A Rust guest program (zkVM "method") that verifies DKIM signatures on the merge-notification email/webhook and encodes the relevant PR-merge claim, without revealing the underlying email content in the public proof output.
- Proof generation is outsourced to **Boundless**, RISC Zero's decentralized proving marketplace, rather than requiring local compute — this keeps the contributor experience lightweight (works from any device).
- **Payment for proving:** each proof request is metered as a small, instant stablecoin payment to the prover market, settled via **x402** (HTTP 402-native payment protocol) — the backend's "client" role pays the facilitator automatically per proof, with no manual billing relationship needed.

### 7.4 Gatekeeper Contract (Rust / Soroban)
- Verifies the RISC Zero proof's public output (or trusts a verified attestation from the backend verifier, in the Option A hybrid model).
- Registers a membership commitment under a repo-specific group ID.
- Exposes a function for perk contracts to check group membership without revealing which member.

### 7.5 Perk / Reward Contract (Rust / Soroban)
- One deployable contract per perk/repo pool.
- Holds funded balance (e.g. in USDC on Stellar).
- Validates: group membership + unused nullifier → releases payment to provided Stellar address.
- Supports scope config: one-time claim vs. recurring (e.g. monthly cap), set by the funder when deploying/configuring the pool.
- All claim transactions are submitted as **fee-bump transactions**, sponsored by the app's operational Stellar account, so contributors pay zero network fees to claim their reward.

## 8. Soroban contract skeleton (Rust)

```rust
#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, Map, Symbol};

#[contracttype]
pub struct RepoGroup {
    pub repo_id: Symbol,
    pub members: Map<BytesN<32>, bool>,   // commitment -> registered
}

#[contract]
pub struct GatekeeperContract;

#[contractimpl]
impl GatekeeperContract {
    /// Called after the backend has verified the RISC Zero proof
    /// (checking the zkVM receipt's image ID + journal output).
    /// Registers a new anonymous member commitment for a repo group.
    pub fn register_member(env: Env, repo_id: Symbol, commitment: BytesN<32>) {
        // TODO: restrict caller to trusted verifier/relayer address
        let mut group: RepoGroup = env
            .storage()
            .persistent()
            .get(&repo_id)
            .unwrap_or(RepoGroup { repo_id: repo_id.clone(), members: Map::new(&env) });

        group.members.set(commitment, true);
        env.storage().persistent().set(&repo_id, &group);
    }

    /// Used by perk contracts to confirm a commitment belongs
    /// to a given repo's contributor group.
    pub fn is_member(env: Env, repo_id: Symbol, commitment: BytesN<32>) -> bool {
        let group: Option<RepoGroup> = env.storage().persistent().get(&repo_id);
        match group {
            Some(g) => g.members.get(commitment).unwrap_or(false),
            None => false,
        }
    }
}

#[contract]
pub struct PerkContract;

#[contractimpl]
impl PerkContract {
    /// Claim a payout. Caller supplies their membership commitment,
    /// a nullifier (unique per claim), and the payout address.
    /// Submitted as part of a fee-bump transaction sponsored by the
    /// app's relayer account, so the contributor pays no network fee.
    pub fn claim(
        env: Env,
        repo_id: Symbol,
        commitment: BytesN<32>,
        nullifier: BytesN<32>,
        payout_address: Address,
        amount: i128,
    ) {
        // 1. Check membership via gatekeeper contract (cross-contract call)
        // 2. Check nullifier hasn't been used before (storage lookup)
        // 3. Check pool has sufficient balance
        // 4. Transfer `amount` of pooled asset to payout_address
        // 5. Mark nullifier as spent
        // (Implementation detail — fill in using Soroban token interface during build phase)
    }

    pub fn fund_pool(env: Env, funder: Address, amount: i128) {
        // Funder (e.g. SDF wallet) deposits into this perk's pool.
        // Requires funder.require_auth()
    }
}
```

*(This is a structural skeleton to guide implementation — actual cross-contract calls, RISC Zero receipt verification, auth checks, and token-transfer logic need to be filled in during the build phase.)*

## 9. Project directory structure

```
hiPerk/
├── frontend/
│   └── (React + TypeScript web app — see Section 7.1)
│
├── backend/
│   ├── src/
│   │   ├── routes/                  # API endpoints (submit proof, claim status, module CRUD, etc.)
│   │   ├── services/
│   │   │   ├── riscZeroProver.ts    # talks to Boundless / local RISC Zero prover
│   │   │   ├── x402Payment.ts       # handles per-proof micropayments to the prover market
│   │   │   ├── stellarClient.ts     # builds/submits Soroban transactions via stellar-sdk
│   │   │   └── feeBumpRelayer.ts    # sponsors gasless (fee-bump) transactions for contributors
│   │   ├── models/                  # claim/module data structures
│   │   └── index.ts                 # server entrypoint
│   ├── package.json
│   └── .env                         # relayer secret key, network config, prover endpoint, etc.
│
└── blockchain/
    ├── contracts/
    │   ├── gatekeeper/
    │   │   ├── src/lib.rs           # Gatekeeper contract logic
    │   │   ├── Cargo.toml
    │   │   └── tests/test.rs
    │   └── perk/                    # ("module" contract)
    │       ├── src/lib.rs           # Perk/Module claim + payout logic
    │       ├── Cargo.toml
    │       └── tests/test.rs
    ├── Cargo.toml                   # workspace root
    ├── target/                      # build output (gitignored)
    ├── scripts/
    │   ├── deploy.sh                # Soroban CLI deploy commands
    │   └── invoke.sh                # example contract invocation commands
    └── .soroban/                    # local CLI identity/config (gitignored)
```

**Why three top-level folders:** the `frontend` only renders UI and talks to the `backend` over HTTP — it never touches RISC Zero, x402, or Soroban directly. The `backend` is the orchestrator: it generates/relays proofs, pays the prover market via x402, and is the only component authorized to submit fee-bump-sponsored transactions to the contracts in `blockchain/`. This separation keeps contributor-facing wallet operations minimal (just Freighter connect + receiving payouts) while all the complex, sensitive operations stay server-side.

## 10. Gas-fee-less UX — implementation notes
- Stellar transaction fees are already extremely low, but to make the experience genuinely **zero-fee for the contributor**, wrap every contributor-submitted transaction (proof registration, perk claim) in a **fee-bump transaction**, where the app's own relayer/operational account pays the fee.
- Optionally use **sponsored reserves** so contributors don't even need an existing funded Stellar account to receive payouts — the app can sponsor the minimum balance requirement for a new account.
- Net effect: a contributor can go from "merged PR" to "received payout" without ever holding XLM or paying a single network fee.

## 11. Tech stack summary

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Tailwind, Freighter/Stellar Wallet Kit |
| Backend | Node.js, TypeScript, Stellar SDK / soroban-client |
| Proof generation | RISC Zero zkVM (Rust guest program), Boundless decentralized prover market |
| Proof-market payments | x402 (HTTP-native stablecoin micropayments, pay-per-proof) |
| Smart contracts | Rust, Soroban SDK |
| Fee model | Fee-bump transactions + sponsored reserves (gas-fee-less for contributors) |
| Asset for payouts | USDC on Stellar (or native XLM) |

## 12. Hackathon-scoped milestones

| Phase | Deliverable |
|---|---|
| 1 | RISC Zero guest program working: proves DKIM-valid merge evidence, outputs a verifiable journal without leaking email content |
| 2 | Proof generation wired to Boundless (or a local prover as fallback if Boundless integration is too slow to set up in time); x402 payment for proof requests stubbed/simulated if needed |
| 3 | Gatekeeper contract deployed on Soroban testnet; backend can register a verified member |
| 4 | One working Perk contract: fund pool, claim payout, nullifier check, wrapped in a fee-bump transaction |
| 5 | Frontend: contributor flow (submit evidence → see claim status → receive gas-fee-less payout) |
| 6 | Frontend: simple admin/funder dashboard (fund pool, view aggregate stats) |
| 7 (stretch) | Migrate proof verification fully on-chain/native to Soroban (Option B) |
| 8 (stretch) | Recurring/scoped perks (e.g. monthly cap logic) |

## 13. Key risks & mitigations
- **Risk:** Boundless/RISC Zero proving network integration adds setup time → **Mitigation:** have a local RISC Zero prover (dev mode) as a fallback so the demo doesn't depend on a live marketplace connection.
- **Update:** x402 *is* natively supported on Stellar via `@x402/stellar` (Soroban token transfers, Built-on-Stellar-compatible facilitators) — implemented as a real payment gate on `POST /claims` (backend/src/services/x402Payment.ts).
- **Update:** proving uses a **local** RISC Zero prover (`backend/prover/`, `default_prover()`), not an outsourced marketplace. Bonsai (RISC Zero's original hosted prover) is deprecated, and its replacement Boundless is an EVM-based on-chain marketplace — pulling that in would mean depending on a second chain/wallet for an otherwise Stellar-only app, for no real benefit at this scale. Local proving is slower per-proof but keeps the whole stack Stellar-only and dependency-free.
- **Risk:** No real funder secured for demo → **Mitigation:** simulate with a testnet wallet acting as "SDF," clearly state this is the demo funding model.
- **Risk:** Cross-contract calls (Perk ↔ Gatekeeper) add complexity → **Mitigation:** start with a single combined contract for MVP, split into two only if time allows.
- **Risk:** Judges question privacy guarantees if backend sees raw email → **Mitigation:** clearly document that proof generation should happen with the email processed only inside the zkVM guest program's proving step, with the public proof output never containing the raw email content.

## 14. What to say in the pitch
"We built a way for the Stellar Development Foundation and ecosystem projects to fund developer compensation for merged pull requests — without contributors ever revealing their identity. Verification uses a RISC Zero zero-knowledge proof over GitHub's own merge-notification evidence, proof generation is outsourced to RISC Zero's Boundless marketplace and metered with x402 stablecoin micropayments, and payout happens instantly, anonymously, and with zero network fees for the contributor on Stellar via Soroban smart contracts."