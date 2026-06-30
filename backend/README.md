# hiPerk — backend

Orchestration API (Node + TypeScript + Express). Implements the Option A hybrid
flow: receives proof requests, runs the RISC Zero prover (mock), meters the
prover fee via x402 (mock), and submits fee-bump-sponsored Soroban transactions
to the Gatekeeper + Perk contracts.

## Run

```bash
npm install
cp .env.example .env     # optional — runs in MOCK chain mode without it
npm run dev              # tsx watch
# or
npm run start
```

`GET /health` reports the active modes. With no contract IDs / relayer key set,
the server runs in **MOCK chain mode** (no real on-chain submission) so the full
flow is demoable offline. Set `GATEKEEPER_CONTRACT_ID`, `PERK_CONTRACT_ID`, and
`RELAYER_SECRET_KEY` (and `CHAIN_MODE=live` or leave `auto`) to go live against
testnet.

## Smoke test

```bash
npm run start            # in one terminal
npm run smoke            # in another — runs create→fund→claim→approve→dup-guard
```

## API

| Method | Route | Body | Returns |
|---|---|---|---|
| `GET` | `/health` | — | mode flags |
| `POST` | `/modules` | `{ repoId, rewardToken?, approvalMode? }` | `{ moduleId, module }` |
| `GET` | `/modules` | — | `[{ moduleId, repoId, balance, ... }]` |
| `GET` | `/modules/:id` | — | module detail (on-chain when live) |
| `POST` | `/modules/:id/fund` | `{ amount }` | `{ txHash, balance }` |
| `POST` | `/claims` | `{ moduleId, evidenceText, payoutAddress? }` | `{ claimId, status }` |
| `GET` | `/claims/:id` | — | anonymous claim view |
| `GET` | `/claims?moduleId=&status=` | — | review queue (anonymous) |
| `POST` | `/claims/:id/approve` | `{ payoutAddress?, amount? }` | `{ status, txHash }` |
| `POST` | `/claims/:id/reject` | `{ reason? }` | `{ status }` |

## Privacy

No route, log, or record stores a GitHub identity/email next to a
`claimId`/`commitment`. Claims carry only the anonymous `commitment` +
`nullifier` derived from the proof (implementation.md §7).

## Services

- `riscZeroProver.ts` — **mock** proof generation (deterministic commitment +
  nullifier from evidence). Swap for Boundless later; signature is stable.
- `x402Payment.ts` — **mock** per-proof stablecoin metering.
- `stellarClient.ts` — **real** Soroban invocations (Gatekeeper + Perk),
  simulated when chain is not configured.
- `feeBumpRelayer.ts` — **real** fee-bump sponsorship: all contributor-facing
  txns routed through the relayer so contributors pay $0 in network fees.
