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

# RPC URL the backend must point at. Defaults to the public testnet RPC; override
# with SOROBAN_RPC_URL for a custom/self-hosted node. MUST be the same network as
# NETWORK above, or the backend will get XDR "bad union" errors at runtime.
if [ "$NETWORK" = "public" ]; then
  SOROBAN_RPC_URL="${SOROBAN_RPC_URL:-https://mainnet.sorobanrpc.com}"
else
  SOROBAN_RPC_URL="${SOROBAN_RPC_URL:-https://soroban-testnet.stellar.org}"
fi

ADMIN_ADDR=$(stellar keys address "$ADMIN_IDENTITY")
RELAYER_ADDR=$(stellar keys address "$RELAYER_IDENTITY")
# Relayer SECRET seed (S...) — the backend signs + fee-bumps with this. Pulled
# from the local stellar keystore so the printed .env is copy-paste ready.
# `|| true` so a keystore that won't reveal the seed doesn't abort the deploy.
RELAYER_SECRET=$(stellar keys show "$RELAYER_IDENTITY" 2>/dev/null || true)

echo "Admin:   $ADMIN_ADDR"
echo "Relayer: $RELAYER_ADDR"
echo "Network: $NETWORK  (RPC: $SOROBAN_RPC_URL)"

echo "==> Building contracts (wasm)"
stellar contract build

# Resolve the release wasm dir. Newer Soroban toolchains build to the
# `wasm32v1-none` target; older ones use `wasm32-unknown-unknown`. Prefer the
# new target, fall back to the old, so the script works on either.
if [ -f "target/wasm32v1-none/release/gatekeeper.wasm" ]; then
  WASM_DIR="target/wasm32v1-none/release"
elif [ -f "target/wasm32-unknown-unknown/release/gatekeeper.wasm" ]; then
  WASM_DIR="target/wasm32-unknown-unknown/release"
else
  echo "❌ could not find built gatekeeper.wasm under target/wasm32v1-none/release or target/wasm32-unknown-unknown/release" >&2
  echo "   (check the 'Wasm File:' path in the build summary above)" >&2
  exit 1
fi
echo "Using wasm dir: $WASM_DIR"

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

if [ -n "$RELAYER_SECRET" ]; then
  RELAYER_LINE="RELAYER_SECRET_KEY=$RELAYER_SECRET"
else
  RELAYER_LINE="RELAYER_SECRET_KEY=   # <-- FILL IN: secret seed (S...) for '$RELAYER_IDENTITY' (run: stellar keys show $RELAYER_IDENTITY)"
fi

cat <<EOF

###############################################################################
#  DEPLOY COMPLETE — NOW UPDATE backend/.env ON EVERY MACHINE
###############################################################################
#
#  These contract IDs are the SHARED source of truth. Every machine that sets
#  the SAME PERK_CONTRACT_ID + SOROBAN_RPC_URL + STELLAR_NETWORK below will see
#  the SAME live module list (modules are now indexed on-chain). If two machines
#  disagree on any of these three, they will NOT see each other's modules.
#
#  1. Open backend/.env on this machine (copy backend/.env.example if missing).
#  2. Replace the lines below with these exact values.
#  3. Fill in any line marked "<-- FILL IN".
#  4. Copy the SAME block to backend/.env on your other machine(s).
#  5. Restart the backend:  cd backend && npm ci && npm run dev
#     (use 'npm ci' — NOT 'npm install' — so the Stellar SDK version matches
#      the committed lockfile; a mismatched SDK is what causes the 502
#      "bad union switch" error on module create.)
#
# ------------------------- copy from here -------------------------
# --- Network (must match on all machines) ---
STELLAR_NETWORK=$NETWORK
SOROBAN_RPC_URL=$SOROBAN_RPC_URL
CHAIN_MODE=live

# --- Contracts (from THIS deploy) ---
GATEKEEPER_CONTRACT_ID=$GATEKEEPER_ID
PERK_CONTRACT_ID=$PERK_ID

# --- Keys ---
ADMIN_PUBLIC_KEY=$ADMIN_ADDR
$RELAYER_LINE

# --- Payout token (Stellar Asset Contract C... id) ---
PAYOUT_TOKEN_ID=   # <-- FILL IN: the C... contract id of your reward token (e.g. testnet USDC SAC)
# -------------------------- to here -------------------------------
#
#  NOTE: PAYOUT_TOKEN_ID must be a valid C... (or G...) Stellar address, or the
#  backend rejects module creation with a 400 before it ever reaches the chain.
###############################################################################
EOF
