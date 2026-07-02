#!/usr/bin/env bash
# hiPerk — live testnet readiness checklist + smoke test.
#
# This does NOT build/run the prover (Rust toolchain lives on a different
# machine, per project convention). Run this on the machine where you'll
# actually start the backend + prover host.
#
# Usage: ./test-live.sh
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:4000}"
PROVER_URL="${PROVER_SERVICE_URL:-http://localhost:8080}"

pass() { echo "  OK   $1"; }
fail() { echo "  FAIL $1"; FAILED=1; }
FAILED=0

echo "== 1. backend/.env required values =="
ENV_FILE="backend/.env"
if [ ! -f "$ENV_FILE" ]; then
  fail "$ENV_FILE not found"
else
  envval() { grep -E "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d '\r'; }
  check_set() {
    val=$(envval "$1")
    if [ -z "$val" ]; then fail "$1 is empty"; else pass "$1 is set"; fi
  }
  check_set GATEKEEPER_CONTRACT_ID
  check_set PERK_CONTRACT_ID
  check_set RELAYER_SECRET_KEY
  check_set ADMIN_PUBLIC_KEY
  check_set PAYOUT_TOKEN_ID
  check_set X402_FACILITATOR_URL
  check_set X402_PAY_TO
  proverMode=$(envval PROVER_MODE)
  [ "$proverMode" = "risc0" ] && pass "PROVER_MODE=risc0" || fail "PROVER_MODE is '$proverMode', expected risc0"
  chainMode=$(envval CHAIN_MODE)
  [ "$chainMode" = "live" ] && pass "CHAIN_MODE=live" || fail "CHAIN_MODE is '$chainMode', expected live"
fi

echo ""
echo "== 2. relayer + admin account funded on testnet =="
ADMIN_PUB=$(grep -E '^ADMIN_PUBLIC_KEY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '\r')
if [ -n "${ADMIN_PUB:-}" ]; then
  resp=$(curl -s "https://horizon-testnet.stellar.org/accounts/$ADMIN_PUB")
  echo "$resp" | grep -q '"sequence"' && pass "admin account exists on testnet ($ADMIN_PUB)" \
    || fail "admin account not found/funded — run: stellar keys fund <identity> --network testnet"
else
  fail "ADMIN_PUBLIC_KEY not set, cannot check"
fi

echo ""
echo "== 3. relayer USDC trustline (needed for payouts / x402 payTo) =="
if [ -n "${ADMIN_PUB:-}" ]; then
  resp=$(curl -s "https://horizon-testnet.stellar.org/accounts/$ADMIN_PUB")
  echo "$resp" | grep -q '"asset_code":"USDC"' && pass "USDC trustline found" \
    || fail "no USDC trustline on $ADMIN_PUB — establish one before enabling live x402/payouts"
fi

echo ""
echo "== 4. prover host service (backend/prover) =="
echo "  Build/run this on the machine with the Rust + RISC Zero toolchain:"
echo "    cd backend/prover && cargo run --release --bin host"
if curl -s -o /dev/null -m 3 "$PROVER_URL/health" 2>/dev/null || curl -s -o /dev/null -m 3 "$PROVER_URL" 2>/dev/null; then
  pass "prover host reachable at $PROVER_URL"
else
  fail "prover host NOT reachable at $PROVER_URL (expected if not running here)"
fi
echo "  NOTE: DKIM verification in the guest program is currently stubbed"
echo "        (structural email check only) — see backend/prover/README.md."

echo ""
echo "== 5. backend server reachable =="
if curl -s -m 3 "$BASE_URL/health" > /dev/null 2>&1; then
  pass "backend reachable at $BASE_URL"
  echo ""
  echo "== 6. smoke test (backend/scripts/smoke.ts) =="
  echo "  NOTE: written for mock mode — in live mode /claims is x402-gated"
  echo "  (expects HTTP 402 + payment header) and payoutAddress must be a"
  echo "  real funded testnet account. Expect it to fail past the paywall"
  echo "  unless you extend it to handle the x402 payment handshake."
  (cd backend && BASE_URL="$BASE_URL" npm run smoke)
else
  fail "backend not reachable at $BASE_URL — start it with: cd backend && npm run dev"
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "All checks passed."
else
  echo "Some checks failed — see FAIL lines above before trusting live mode."
fi
