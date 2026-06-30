# Implementation Plan: hiPerk (backend + blockchain)

This document is the build-ready companion to `plan.md`. Where plan.md explains
architecture and rationale, this file specifies exact contract interfaces, API
routes, data models, and a step-by-step build order, so Claude Code (or any dev)
can implement without re-deriving design decisions.

Scope note: this implementation targets a **hackathon MVP**, using the Option A
hybrid architecture from plan.md Section 6 (proof verification handled by a
trusted backend relayer, on-chain logic kept minimal). Mock/simulated pieces are
explicitly marked `MOCK` below — replace with real integrations only if time
allows (see Section 9, Stretch goals).

---

## 1. Build order (do this in sequence)

1. `blockchain/` — Gatekeeper contract (Section 3)
2. `blockchain/` — Perk/Module contract (Section 4)
3. Deploy both to Soroban **testnet**, note contract IDs
4. `backend/` — Stellar client service wrapping both contracts (Section 6.3)
5. `backend/` — Relayer/fee-bump service (Section 6.4)
6. `backend/` — Proof service, **MOCK first** (Section 6.1)
7. `backend/` — x402 payment service, **MOCK first** (Section 6.2)
8. `backend/` — API routes wiring it all together (Section 7)
9. Connect frontend to these routes
10. (Stretch) Swap mocked proof/payment services for real RISC Zero + Boundless + x402

---

## 2. Data model (shared concepts — used by both contracts and backend)

| Field | Type | Meaning |
|---|---|---|
| `repo_id` | string/Symbol | Unique identifier for a GitHub repo (e.g. `"stellar/js-stellar-sdk"`) |
| `module_id` | string/Symbol | Unique identifier for a funded module (admin-created); one module maps to one Perk contract instance or one entry in a shared Perk contract's storage |
| `commitment` | bytes32 | Anonymous membership credential derived from the contributor's proof — never linked to a real identity |
| `nullifier` | bytes32 | Unique-per-claim value that prevents the same merged PR / claim from being paid twice |
| `claim_id` | string | Backend-generated ID for tracking a claim through its lifecycle (`pending` → `approved`/`rejected` → `paid`) |
| `payout_address` | Stellar `Address`/G... key | Where the reward is sent — supplied by contributor, not linked to GitHub identity |
| `amount` | i128 | Reward amount (in stroops or token base units) |

---

## 3. Gatekeeper Contract — `blockchain/contracts/gatekeeper/src/lib.rs`

### Purpose
Registers anonymous membership commitments per repo group, after the backend
has verified a proof off-chain (Option A hybrid model).

### Storage
```rust
// Persistent storage key: repo_id (Symbol)
// Value: RepoGroup { members: Map<BytesN<32>, bool> }
```

### Functions

```rust
/// Restricted to the trusted relayer address (set at init).
/// Registers a new anonymous member commitment under a repo group.
pub fn register_member(env: Env, caller: Address, repo_id: Symbol, commitment: BytesN<32>);

/// Read-only. Used by the Perk contract (or backend) to confirm
/// a commitment belongs to a repo's contributor group.
pub fn is_member(env: Env, repo_id: Symbol, commitment: BytesN<32>) -> bool;

/// One-time setup: sets the trusted relayer address allowed to call register_member.
pub fn initialize(env: Env, admin: Address, relayer: Address);

/// Admin-only: rotate the trusted relayer address if needed.
pub fn set_relayer(env: Env, admin: Address, new_relayer: Address);
```

### Auth rules
- `initialize`: callable once; require `admin.require_auth()`.
- `register_member`: require `caller.require_auth()` AND `caller == stored relayer address`. Reject otherwise.
- `set_relayer`: require `admin.require_auth()`.

### Errors to handle
- Already-initialized (prevent re-init).
- Caller is not the registered relayer (unauthorized register attempt).
- Repo group doesn't exist yet on `is_member` lookup → return `false`, don't panic.

### Tests to write (`tests/test.rs`)
- Initialize, register a member, confirm `is_member` returns true.
- Reject `register_member` from a non-relayer address.
- `is_member` returns false for unknown repo_id or unknown commitment.
- Relayer rotation works and old relayer can no longer register members.

---

## 4. Perk/Module Contract — `blockchain/contracts/perk/src/lib.rs`

### Purpose
Holds a funded reward pool per module, validates anonymous claims against the
Gatekeeper contract, prevents double-claiming via nullifiers, and pays out.

### Storage
```rust
// Persistent storage key: module_id (Symbol)
// Value: ModulePool {
//   repo_id: Symbol,
//   funder: Address,
//   token: Address,          // SAC (Stellar Asset Contract) address, e.g. USDC
//   balance: i128,
//   approval_mode: Symbol,   // "manual" | "automatic"
//   used_nullifiers: Map<BytesN<32>, bool>,
// }
```

### Functions

```rust
/// Admin creates a module: links it to a repo, sets approval mode.
/// Does not require funds yet — funding is a separate call.
pub fn create_module(
    env: Env,
    admin: Address,
    module_id: Symbol,
    repo_id: Symbol,
    token: Address,
    approval_mode: Symbol,
);

/// Funder deposits tokens into a module's pool.
/// Transfers `amount` of `token` from funder to this contract.
pub fn fund_module(env: Env, funder: Address, module_id: Symbol, amount: i128);

/// Core claim function. Caller is the RELAYER (backend), acting on behalf
/// of the contributor after off-chain approval (manual or automatic).
/// Validates membership + nullifier, then pays out to payout_address.
pub fn claim(
    env: Env,
    caller: Address,          // must be trusted relayer
    module_id: Symbol,
    commitment: BytesN<32>,
    nullifier: BytesN<32>,
    payout_address: Address,
    amount: i128,
    gatekeeper_contract: Address,
);

/// Read-only: current pool balance + module config for the admin dashboard.
pub fn get_module(env: Env, module_id: Symbol) -> ModulePool;
```

### Claim function internal logic (write exactly in this order)
1. `caller.require_auth()` — must be the trusted relayer.
2. Load `ModulePool` by `module_id`; error if not found.
3. Cross-contract call to Gatekeeper: `is_member(repo_id, commitment)` — must be `true`, else error `"not a verified member"`.
4. Check `used_nullifiers.get(nullifier)` — must be unset/false, else error `"nullifier already used"`.
5. Check `balance >= amount`, else error `"insufficient pool balance"`.
6. Transfer `amount` of `token` from this contract to `payout_address` (use the Stellar token client interface, `token::Client`).
7. Decrement `balance` by `amount`.
8. Mark `used_nullifiers.set(nullifier, true)`.
9. Persist updated `ModulePool`.

### Auth rules
- `create_module`: `admin.require_auth()`.
- `fund_module`: `funder.require_auth()`.
- `claim`: `caller.require_auth()` AND caller must equal the trusted relayer address (store this similarly to Gatekeeper's relayer pattern, or read it from the Gatekeeper contract via cross-contract call to avoid duplicating config).

### Tests to write
- Create module, fund it, confirm balance.
- Claim with valid membership + unused nullifier → balance decreases, payout received.
- Claim with same nullifier twice → second call fails.
- Claim with a commitment that isn't a Gatekeeper member → fails.
- Claim exceeding pool balance → fails.
- Claim from non-relayer caller → fails (auth rejected).

---

## 5. Deployment scripts — `blockchain/scripts/`

### `deploy.sh` (outline — fill in actual CLI flags per current Soroban CLI version)
```bash
#!/bin/bash
# 1. Build both contracts
stellar contract build

# 2. Deploy Gatekeeper, capture contract ID
GATEKEEPER_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/gatekeeper.wasm \
  --source <ADMIN_IDENTITY> --network testnet)

# 3. Initialize Gatekeeper with admin + relayer addresses
stellar contract invoke --id $GATEKEEPER_ID --source <ADMIN_IDENTITY> \
  --network testnet -- initialize --admin <ADMIN_ADDR> --relayer <RELAYER_ADDR>

# 4. Deploy Perk contract, capture contract ID
PERK_ID=$(stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/perk.wasm \
  --source <ADMIN_IDENTITY> --network testnet)

# 5. Print both IDs — copy into backend/.env
echo "GATEKEEPER_CONTRACT_ID=$GATEKEEPER_ID"
echo "PERK_CONTRACT_ID=$PERK_ID"
```

### `invoke.sh`
Keep a few example `stellar contract invoke` commands here for manual testing of
`register_member`, `create_module`, `fund_module`, and `claim` — useful for
debugging without going through the backend.

---

## 6. Backend services — `backend/src/services/`

### 6.1 `riscZeroProver.ts` — **build as MOCK first**
```ts
// Interface to implement now (mocked):
async function generateProof(input: {
  evidenceText: string;   // raw pasted PR-merge evidence (MVP: no real DKIM parsing)
  repoId: string;
}): Promise<{ proofId: string; commitment: string; journal: object }>

// MOCK implementation: 
//   - wait 2-3s (simulate proving time)
//   - return a deterministic fake commitment (hash of evidenceText + repoId)
//   - return a fake proofId (uuid)
// 
// STRETCH (real): replace internals with an actual RISC Zero guest program
// call via Boundless SDK/API. Keep the function signature identical so
// nothing else in the backend needs to change when you swap it in.
```

### 6.2 `x402Payment.ts` — **build as MOCK first**
```ts
// Interface to implement now (mocked):
async function payForProof(proofRequestId: string, amountUsdc: number): Promise<{ paid: boolean; receiptId: string }>

// MOCK implementation: log the "payment," return { paid: true, receiptId: uuid }.
//
// STRETCH (real): integrate an x402-compatible HTTP client that attaches
// a payment header/transaction to the proving request, per x402 spec.
```

### 6.3 `stellarClient.ts` — real, build this for real (not mocked)
```ts
// Wraps @stellar/stellar-sdk calls to both contracts.

async function registerMember(repoId: string, commitment: string): Promise<{ txHash: string }>
// Builds + signs (with relayer key) + submits a register_member invocation
// to the Gatekeeper contract. Wrapped in a fee-bump transaction (see 6.4).

async function claimReward(params: {
  moduleId: string;
  commitment: string;
  nullifier: string;
  payoutAddress: string;
  amount: string;
}): Promise<{ txHash: string }>
// Same pattern: builds + submits the claim() call to the Perk contract,
// fee-bumped by the relayer.

async function getModule(moduleId: string): Promise<ModulePoolView>
// Read-only call, no transaction needed (simulate/read via RPC).
```

### 6.4 `feeBumpRelayer.ts` — real, build this for real
```ts
// Holds the relayer's Stellar keypair (from backend/.env, never exposed to frontend).

async function sponsorAndSubmit(innerTx: Transaction): Promise<{ txHash: string }>
// Wraps `innerTx` in a FeeBumpTransaction signed by the relayer account,
// submits it to the Stellar network, returns the result hash.
// This is the single function that gives contributors a $0-fee experience —
// route ALL contributor-triggered on-chain actions through this.
```

---

## 7. Backend API routes — `backend/src/routes/`

| Method | Route | Body | Returns | Notes |
|---|---|---|---|---|
| `POST` | `/modules` | `{ repoId, rewardToken, approvalMode }` | `{ moduleId }` | Admin creates a module. Calls `stellarClient.createModule` (you'll add this wrapper alongside 6.3). |
| `POST` | `/modules/:moduleId/fund` | `{ amount }` | `{ txHash }` | Admin funds the module pool. |
| `GET` | `/modules` | — | `[{ moduleId, repoId, balance, approvalMode }]` | List modules — powers Dashboard + Browse pages. |
| `POST` | `/claims` | `{ moduleId, evidenceText }` | `{ claimId, status: "pending" }` | Developer submits proof request. Internally: call `riscZeroProver.generateProof` → `x402Payment.payForProof` → `stellarClient.registerMember` → store claim record with status `pending`. |
| `GET` | `/claims/:claimId` | — | `{ claimId, moduleId, amount, status }` | Developer polls claim status. Never returns identity info. |
| `GET` | `/claims?moduleId=&status=pending` | — | `[{ claimId, moduleId, amount }]` | Moderator's review queue — anonymous, no identity fields. |
| `POST` | `/claims/:claimId/approve` | `{ payoutAddress, amount }` | `{ status: "paid", txHash }` | Moderator approves → calls `stellarClient.claimReward` via `feeBumpRelayer` → updates claim status to `paid`. |
| `POST` | `/claims/:claimId/reject` | `{ reason? }` | `{ status: "rejected" }` | Moderator rejects. |

### Claim record shape (`backend/src/models/claim.ts`)
```ts
interface Claim {
  claimId: string;
  moduleId: string;
  commitment: string;     // never expose any field that maps this back to a person
  nullifier: string;
  amount: string;
  status: "pending" | "approved" | "rejected" | "paid";
  createdAt: string;
  txHash?: string;
}
```

**Privacy rule to enforce in code review:** no route, log line, or DB record should ever store the contributor's GitHub username/email alongside a `claimId` or `commitment`. If you need fraud-prevention metadata later, keep it in a separate, access-restricted store — never returned by any API response.

---

## 8. Environment variables — `backend/.env`

```
STELLAR_NETWORK=testnet
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
GATEKEEPER_CONTRACT_ID=
PERK_CONTRACT_ID=
RELAYER_SECRET_KEY=          # relayer's signing key — sponsors all fee-bump txns
ADMIN_PUBLIC_KEY=
PROVER_MODE=mock             # "mock" | "boundless" (stretch)
X402_MODE=mock               # "mock" | "live" (stretch)
PORT=4000
```

---

## 9. Stretch goals (only after MVP flow works end-to-end)

1. Swap `riscZeroProver.ts` mock for a real RISC Zero guest program + Boundless API call.
2. Swap `x402Payment.ts` mock for real x402 settlement to the prover.
3. Add "automatic" approval mode: when a module's `approvalMode === "automatic"`, skip the moderator review step and call `/claims/:claimId/approve` automatically right after proof registration.
4. Move nullifier/membership verification fully on-chain (verify RISC Zero proof inside a Soroban contract directly) instead of trusting the backend relayer — this is "Option B" from plan.md Section 6.

---

## 10. What NOT to build for the hackathon (explicitly out of scope)
- Real DKIM/email parsing — evidence submission is a free-text field for the MVP.
- Multi-token support — hardcode one token (e.g. testnet USDC) for the MVP.
- User auth beyond Freighter wallet connection — no separate login system.
- Admin permission hierarchies beyond a single admin/relayer pair per deployment.