#!/usr/bin/env bash
# Example manual contract invocations for debugging without the backend.
# Fill in the contract IDs from deploy.sh output and edit the example values.
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
ADMIN_IDENTITY="${ADMIN_IDENTITY:-admin}"
RELAYER_IDENTITY="${RELAYER_IDENTITY:-relayer}"
GATEKEEPER_ID="${GATEKEEPER_CONTRACT_ID:?set GATEKEEPER_CONTRACT_ID}"
PERK_ID="${PERK_CONTRACT_ID:?set PERK_CONTRACT_ID}"
TOKEN_ID="${TOKEN_ID:?set TOKEN_ID (e.g. testnet USDC SAC address)}"

RELAYER_ADDR=$(stellar keys address "$RELAYER_IDENTITY")
ADMIN_ADDR=$(stellar keys address "$ADMIN_IDENTITY")

# A 32-byte commitment / nullifier are passed as 64-hex-char strings.
COMMITMENT="0101010101010101010101010101010101010101010101010101010101010101"
NULLIFIER="0202020202020202020202020202020202020202020202020202020202020202"
REPO="stellar_sdk"
MODULE="mod_demo"
PAYOUT="$ADMIN_ADDR"   # demo payout target

echo "== register_member (relayer) =="
stellar contract invoke --id "$GATEKEEPER_ID" --source "$RELAYER_IDENTITY" --network "$NETWORK" -- \
  register_member --caller "$RELAYER_ADDR" --repo_id "$REPO" --commitment "$COMMITMENT"

echo "== is_member =="
stellar contract invoke --id "$GATEKEEPER_ID" --source "$RELAYER_IDENTITY" --network "$NETWORK" -- \
  is_member --repo_id "$REPO" --commitment "$COMMITMENT"

echo "== create_module (admin) =="
stellar contract invoke --id "$PERK_ID" --source "$ADMIN_IDENTITY" --network "$NETWORK" -- \
  create_module --admin "$ADMIN_ADDR" --module_id "$MODULE" --repo_id "$REPO" \
  --token "$TOKEN_ID" --approval_mode manual

echo "== fund_module (admin, 1000 base units) =="
stellar contract invoke --id "$PERK_ID" --source "$ADMIN_IDENTITY" --network "$NETWORK" -- \
  fund_module --funder "$ADMIN_ADDR" --module_id "$MODULE" --amount 1000

echo "== claim (relayer) =="
stellar contract invoke --id "$PERK_ID" --source "$RELAYER_IDENTITY" --network "$NETWORK" -- \
  claim --caller "$RELAYER_ADDR" --module_id "$MODULE" --commitment "$COMMITMENT" \
  --nullifier "$NULLIFIER" --payout_address "$PAYOUT" --amount 400

echo "== get_module =="
stellar contract invoke --id "$PERK_ID" --source "$ADMIN_IDENTITY" --network "$NETWORK" -- \
  get_module --module_id "$MODULE"
