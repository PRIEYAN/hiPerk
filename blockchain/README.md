# hiPerk — Soroban contracts

Two Rust/Soroban contracts implementing the Option A hybrid model from `plan.md`:

- **`gatekeeper`** — registers anonymous membership commitments per repo group.
  Only the trusted relayer (the backend) may register; `is_member` is the
  public read used by the perk contract.
- **`perk`** — one funded reward pool per module. Validates anonymous claims
  against the gatekeeper (cross-contract `is_member`), prevents double-claims
  via per-module nullifiers, and pays out from the pool using the Stellar
  token (SAC) interface.

## Build & test

Requires the Rust toolchain and the
[`stellar` CLI](https://developers.stellar.org/docs/tools/cli). Recent Soroban
toolchains build to the `wasm32v1-none` target (older ones used
`wasm32-unknown-unknown`); `stellar contract build` installs whichever it needs.

```bash
cargo test            # runs unit tests for both contracts
stellar contract build  # produces target/wasm32v1-none/release/*.wasm
```

## Deploy to testnet

```bash
stellar keys generate admin   --network testnet --fund
stellar keys generate relayer --network testnet --fund
./scripts/deploy.sh           # prints contract IDs to copy into backend/.env
```

See `scripts/invoke.sh` for manual contract invocation examples.

## Auth model

| Function | Caller | Check |
|---|---|---|
| `gatekeeper.initialize` | admin | once-only |
| `gatekeeper.register_member` | relayer | `caller == relayer` |
| `gatekeeper.set_relayer` | admin | `admin == config.admin` |
| `perk.initialize` | admin | once-only |
| `perk.create_module` | admin | `admin == config.admin` |
| `perk.fund_module` | funder | `funder.require_auth()` |
| `perk.claim` | relayer | `caller == relayer` + membership + nullifier + balance |
