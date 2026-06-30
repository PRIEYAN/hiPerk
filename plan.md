# Plan: Anonymous Contributor Rewards on Stellar (working name: StellarPerks)

## 1. One-line pitch
A web application that lets developers anonymously prove they got a pull request merged into a Stellar ecosystem GitHub repo, and automatically triggers compensation (funded by Stellar/SDF or repo sponsors) to be paid out on the Stellar network — without ever revealing who the contributor is.

## 2. What it is (form factor)
**It's a website (web app), not a desktop/CLI tool.** Reasoning:
- Contributors need a low-friction way to connect their email/GitHub PR confirmation and generate a proof. A browser-based flow is the standard pattern for zkEmail-based apps (similar to how zkEmail's own demo apps work).
- Repo admins/maintainers need a dashboard to see verified claims and approve/fund compensation.
- No reason to require a local install — this should work for any contributor, on any machine, ideally even mobile.

So the architecture is: **frontend web app + backend services + Soroban smart contracts on Stellar**, not a single monolithic "tool you run locally."

## 3. High-Level Architecture

```
┌─────────────────────┐
│   Frontend (Web)     │  Contributor portal + Admin dashboard
└──────────┬───────────┘
           │
┌──────────▼───────────┐
│   Backend / API       │  Orchestrates proof requests, talks to
│   (Node/TS service)   │  proving service + Stellar/Soroban RPC
└──────────┬───────────┘
           │
   ┌───────┴────────┐
   ▼                ▼
┌─────────────┐  ┌──────────────────────┐
│ ZK Proving   │  │  Stellar Network      │
│ Service       │  │  (Soroban contracts)  │
│ (zkEmail +    │  │  - Gatekeeper         │
│ Sindri/remote │  │  - Group registry     │
│ prover)       │  │  - Perk/reward pool   │
└─────────────┘  └──────────────────────┘
```

## 4. End-to-end user flow

1. Contributor opens a PR against a Stellar ecosystem repo (e.g. an SDF-listed project).
2. PR gets merged → GitHub sends the standard "your PR was merged" notification email to the contributor.
3. Contributor goes to the web app, uploads/forwards that email (via zkEmail's DKIM-based flow — no email content is exposed).
4. The proving service generates a zero-knowledge proof: *"this person received a genuine, DKIM-signed GitHub email confirming a merged PR into repo X."*
5. Backend submits this proof to the **Gatekeeper contract** on Soroban.
6. Gatekeeper verifies the proof and registers an anonymous membership credential (a commitment) into that repo's contributor group — no wallet identity tied to the real-world person beyond a Stellar address they control.
7. Contributor uses that membership to submit an anonymous claim to a **Perk contract** (signal = the specific perk/repo's compensation pool).
8. Perk contract checks: (a) valid group membership proof, (b) nullifier not already used (prevents double-claiming the same merged PR). If valid, it pays out from the funded pool directly to a Stellar address the contributor provides — no name attached.
9. Admin dashboard shows the repo maintainer/SDF funder an aggregated, anonymous view: "X claims paid out, Y pool remaining" — never *who* claimed.

## 5. Why this needs to be on Stellar specifically (the answer to "who funds it and why")
- **Funder:** Stellar Development Foundation (SDF) or individual ecosystem project teams who want their repos developed and are already running grant/bounty programs.
- **Why they'd use this instead of a normal bounty form:** privacy. Some contributors (employees of competitors, people in restrictive jurisdictions, people who don't want public "I work for crypto" exposure) won't claim public bounties but will claim anonymous ones. This widens the contributor pool for under-resourced repos.
- **Why Stellar's tech is a good fit for the payout leg specifically:** fast, extremely cheap settlement, and SDF already runs stablecoin rails (USDC) — ideal for "pay out small/medium reimbursements at scale, anonymously, instantly."

## 6. Important technical reality check (must address explicitly in the pitch)
Stellar's smart contract platform, **Soroban, is Rust/WASM-based — not Solidity/EVM.** The original zkGitPerks stack (Solidity + Semaphore) does not run natively on Soroban. There are two honest paths:

### Option A — Hybrid (recommended for hackathon timeline)
- Keep zkEmail proof generation + verification logic off-chain or on a separate lightweight verifier service (or use a Solidity verifier deployed via Solang-compiled contracts, which is experimental).
- Once a proof is verified by the backend/verifier, the backend calls a **native Soroban (Rust) contract** that only handles: group membership bookkeeping, nullifier tracking, and the actual reward payout.
- This is realistic to build in a hackathon window and still gives genuine, demoable Stellar/Soroban integration where it matters most (the funding/payout layer).

### Option B — Pure Soroban-native rebuild (stretch goal, higher risk)
- Reimplement group membership + nullifier logic natively in Rust on Soroban (a simple Merkle-tree-based membership set instead of Semaphore).
- More "native" and impressive to Stellar-specific judges, but meaningfully more engineering work and risk.

**Plan: build Option A as the MVP. If time allows, migrate group membership logic into Option B as a stretch goal.**

## 7. Components breakdown

### 7.1 Frontend (Web app)
- Contributor view: connect wallet (Stellar wallet, e.g. Freighter), upload/forward verification email, see claim status, submit claim, receive payout.
- Admin/funder view: see funded pools per repo, total payouts (aggregate only), top up pool balance.
- Stack: React + TypeScript, Stellar Wallet Kit / Freighter integration, Tailwind for styling.

### 7.2 Backend / API service
- Orchestrates: receives email proof requests, calls proving service, submits resulting proof to Soroban contract via Stellar SDK (`stellar-sdk` / `soroban-client`), tracks claim status.
- Stack: Node.js + TypeScript, Stellar SDK.

### 7.3 ZK Proving Service
- zkEmail circuit (existing, reusable) to prove a DKIM-signed GitHub merge-notification email.
- Hosted proving via Sindri (or self-hosted prover) so contributors don't need heavy local compute — works on mobile/low-power devices too.

### 7.4 Gatekeeper Contract (Rust / Soroban)
- Verifies submitted proof data (or trusts a verified attestation from the backend verifier in the Option A hybrid model).
- Registers a membership commitment under a repo-specific group ID.
- Exposes a function for perk contracts to check group membership without revealing which member.

### 7.5 Perk / Reward Contract (Rust / Soroban)
- One deployable contract per perk/repo pool.
- Holds funded balance (e.g. in USDC on Stellar).
- Validates: group membership + unused nullifier → releases payment to provided Stellar address.
- Supports scope config: one-time claim vs. recurring (e.g. monthly cap), set by the funder when deploying/configuring the pool.

## 8. Soroban contract skeleton (Rust)

```rust
#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, BytesN, Env, Map, Symbol};

#[contracttype]
pub struct RepoGroup {
    pub repo_id: Symbol,
    pub members: Map<BytesN<32>, bool>,   // commitment -> registered
}

#[contract]
pub struct GatekeeperContract;

#[contractimpl]
impl GatekeeperContract {
    /// Called after backend has verified the zkEmail proof off-chain
    /// (or via a separate verifier contract). Registers a new
    /// anonymous member commitment for a given repo group.
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
        // (Implementation detail — fill in during build phase)
    }

    pub fn fund_pool(env: Env, funder: Address, amount: i128) {
        // Funder (e.g. SDF wallet) deposits into this perk's pool.
        // Requires funder.require_auth()
    }
}
```

*(This is a structural skeleton to guide implementation — actual cross-contract calls, auth checks, and token-transfer logic need to be filled in using the Soroban token interface during the build phase.)*

## 9. Tech stack summary

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Tailwind, Freighter/Stellar Wallet Kit |
| Backend | Node.js, TypeScript, Stellar SDK / soroban-client |
| Proof generation | zkEmail circuits, Sindri (or self-hosted prover) |
| Smart contracts | Rust, Soroban SDK |
| Asset for payouts | USDC on Stellar (or native XLM) |

## 10. Hackathon-scoped milestones

| Phase | Deliverable |
|---|---|
| 1 | zkEmail proof flow working end-to-end (off-chain, can be reused from existing zkEmail tooling) |
| 2 | Gatekeeper contract deployed on Soroban testnet; backend can register a verified member |
| 3 | One working Perk contract: fund pool, claim payout, nullifier check |
| 4 | Frontend: contributor flow (upload email → see claim status → receive payout) |
| 5 | Frontend: simple admin/funder dashboard (fund pool, view aggregate stats) |
| 6 (stretch) | Migrate membership logic to fully native Soroban (Option B) |
| 7 (stretch) | Recurring/scoped perks (e.g. monthly cap logic) |

## 11. Key risks & mitigations

- **Risk:** Soroban tooling/Solidity bridge (Solang) is experimental → **Mitigation:** don't depend on it; keep ZK verification off-chain/hybrid (Option A).
- **Risk:** No real funder secured for demo → **Mitigation:** simulate with a testnet wallet acting as "SDF," clearly state this is the demo funding model.
- **Risk:** Cross-contract calls (Perk ↔ Gatekeeper) add complexity → **Mitigation:** start with single combined contract for MVP, split into two only if time allows.
- **Risk:** Judges question privacy guarantees if backend sees raw email → **Mitigation:** clearly document that proof generation should happen client-side/locally before any data is sent to the backend, so the backend only ever sees the proof, not the email.

## 12. What to say in the pitch
"We built a way for the Stellar Development Foundation and ecosystem projects to fund developer compensation for merged pull requests — without contributors ever revealing their identity. Verification uses zero-knowledge proofs over GitHub's own merge-notification emails; payout happens instantly and cheaply on Stellar via Soroban smart contracts."
