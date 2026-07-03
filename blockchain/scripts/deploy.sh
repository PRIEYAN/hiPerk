#!/usr/bin/env bash
# Deploy hiPerk Soroban contracts to testnet.
#
# Prereqs:
#   - stellar CLI installed (https://developers.stellar.org/docs/tools/cli)
#   - an identity created & funded on testnet:
#       stellar keys generate admin --network testnet --fund
#       stellar keys generate relayer --network testnet --fund
#
# Usage:
#   cd blockchain && ./scripts/deploy.sh
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
ADMIN_IDENTITY="${ADMIN_IDENTITY:-admin}"
RELAYER_IDENTITY="${RELAYER_IDENTITY:-relayer}"

ADMIN_ADDR=$(stellar keys address "$ADMIN_IDENTITY")
RELAYER_ADDR=$(stellar keys address "$RELAYER_IDENTITY")

echo "Admin:   $ADMIN_ADDR"
echo "Relayer: $RELAYER_ADDR"

echo "==> Building contracts (wasm)"
stellar contract build

WASM_DIR="target/wasm32-unknown-unknown/release"

echo "==> Deploying Gatekeeper"
GATEKEEPER_ID=$(stellar contract deploy \
  --wasm "$WASM_DIR/gatekeeper.wasm" \
  --source "$ADMIN_IDENTITY" --network "$NETWORK")
echo "Gatekeeper: $GATEKEEPER_ID"

echo "==> Initializing Gatekeeper (admin + relayer)"
stellar contract invoke --id "$GATEKEEPER_ID" --source "$ADMIN_IDENTITY" \
  --network "$NETWORK" -- \
  initialize --admin "$ADMIN_ADDR" --relayer "$RELAYER_ADDR"

echo "==> Deploying Perk"
PERK_ID=$(stellar contract deploy \
  --wasm "$WASM_DIR/perk.wasm" \
  --source "$ADMIN_IDENTITY" --network "$NETWORK")
echo "Perk: $PERK_ID"

echo "==> Initializing Perk (admin + relayer + gatekeeper)"
stellar contract invoke --id "$PERK_ID" --source "$ADMIN_IDENTITY" \
  --network "$NETWORK" -- \
  initialize --admin "$ADMIN_ADDR" --relayer "$RELAYER_ADDR" --gatekeeper "$GATEKEEPER_ID"

echo ""
echo "================ COPY INTO backend/.env ================"
echo "GATEKEEPER_CONTRACT_ID=$GATEKEEPER_ID"
echo "PERK_CONTRACT_ID=$PERK_ID"
echo "ADMIN_PUBLIC_KEY=$ADMIN_ADDR"
echo "======================================================="
