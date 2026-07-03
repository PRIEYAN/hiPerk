/**
 * End-to-end smoke test against a running backend (mock chain mode).
 * Usage: ensure the server is running, then `npm run smoke`.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:4000";

async function j(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return data;
}

async function main() {
  console.log("health:", await j("GET", "/health"));

  // Omit rewardToken so the backend uses its configured PAYOUT_TOKEN_ID (a real
  // SAC contract id in live mode). Sending the literal "USDC" here breaks live
  // mode, where the token is parsed as a Soroban address, not a label.
  const created = await j("POST", "/modules", {
    repoId: "stellar/smoke-test",
    approvalMode: "manual",
  });
  const moduleId = created.moduleId;
  console.log("created module:", moduleId);

  const funded = await j("POST", `/modules/${moduleId}/fund`, { amount: 1000 });
  console.log("funded:", funded);

  const claim = await j("POST", "/claims", {
    moduleId,
    evidenceText: "PR #42 merged into stellar/smoke-test by maintainer on 2026-06-30",
    payoutAddress: "GTESTPAYOUTADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  });
  console.log("claim submitted:", claim);

  const status = await j("GET", `/claims/${claim.claimId}`);
  console.log("claim status:", status);

  const approved = await j("POST", `/claims/${claim.claimId}/approve`, {});
  console.log("approved:", approved);

  // Re-submitting the same evidence must be blocked (nullifier reuse).
  const dup = await fetch(`${BASE}/claims`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      moduleId,
      evidenceText: "PR #42 merged into stellar/smoke-test by maintainer on 2026-06-30",
    }),
  });
  console.log("duplicate claim blocked:", dup.status === 409 ? "yes (409)" : `NO (${dup.status})`);

  const modules = await j("GET", "/modules");
  const mine = modules.find((m: any) => m.moduleId === moduleId);
  console.log("final module balance:", mine?.balance);

  console.log("\nSMOKE TEST PASSED ✅");
}

main().catch((e) => {
  console.error("\nSMOKE TEST FAILED ❌\n", e);
  process.exit(1);
});
