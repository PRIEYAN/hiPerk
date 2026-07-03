import { Router } from "express";
import { customAlphabet } from "nanoid";
import { store } from "../models/store.js";
import { Module, ApprovalMode } from "../models/types.js";
import { config, chainLive } from "../config.js";
import * as stellar from "../services/stellarClient.js";

// Symbol-safe id generator: nanoid's DEFAULT alphabet includes '-', which is
// illegal in a Soroban Symbol; restrict to [A-Za-z0-9_] so module_id (a
// cross-call storage key) can never be rejected on-chain.
const symbolId = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_",
  6,
);

export const modulesRouter = Router();

/**
 * POST /modules — moderator creates a module AND escrows its reward pool.
 *
 * The `rewardPool` amount is funded from the moderator/admin account into the
 * Perk contract escrow as part of creation (create_module → fund_module), so
 * clicking "Create module" credits the pool immediately. Rewards are later
 * paid out of this escrow automatically per claim (see routes/claims.ts).
 */
modulesRouter.post("/", async (req, res) => {
  const { repoId, rewardToken, approvalMode, createdBy, rewardPool } = req.body ?? {};
  if (!repoId) return res.status(400).json({ error: "repoId required" });

  const pool = Number(rewardPool);
  if (!Number.isFinite(pool) || pool <= 0) {
    return res.status(400).json({ error: "rewardPool must be a positive number to escrow" });
  }

  const mode: ApprovalMode = approvalMode === "automatic" ? "automatic" : "manual";
  const moduleId = `mod_${symbolId()}`;
  const token = rewardToken || config.payoutTokenId || "USDC";
  if (chainLive && !/^[GC][A-Z2-7]{55}$/.test(token)) {
    return res.status(400).json({
      error:
        `rewardToken '${token}' is not a valid Stellar address. ` +
        "Set PAYOUT_TOKEN_ID in backend/.env to the token's C... contract ID " +
        "(e.g. the USDC Stellar Asset Contract), or pass a valid rewardToken.",
    });
  }

  try {
    await stellar.createModule({ moduleId, repoId, token, approvalMode: mode });
  } catch (e) {
    return res.status(502).json({ error: `on-chain create_module failed: ${(e as Error).message}` });
  }

  // Escrow the reward pool into the Perk contract. If this fails the module
  // exists on-chain but unfunded; surface that so the moderator can retry via
  // POST /modules/:id/fund rather than silently showing a 0-balance module.
  try {
    await stellar.fundModule(moduleId, pool);
  } catch (e) {
    return res.status(502).json({
      error: `module created but escrow funding failed: ${(e as Error).message}. Retry funding via POST /modules/${moduleId}/fund`,
      moduleId,
    });
  }

  const m: Module = {
    moduleId,
    repoId,
    rewardToken: token,
    approvalMode: mode,
    balance: pool,
    status: "Open",
    createdBy: createdBy || config.adminPublicKey || "admin",
    createdAt: new Date().toISOString(),
  };
  store.putModule(m);
  res.status(201).json({ moduleId, module: m });
});

/** POST /modules/:moduleId/fund — admin funds the pool. */
modulesRouter.post("/:moduleId/fund", async (req, res) => {
  const { moduleId } = req.params;
  const amount = Number(req.body?.amount);
  const m = store.getModule(moduleId);
  if (!m) return res.status(404).json({ error: "module not found" });
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "amount must be a positive number" });
  }

  let txHash: string;
  try {
    ({ txHash } = await stellar.fundModule(moduleId, amount));
  } catch (e) {
    return res.status(502).json({ error: `on-chain fund_module failed: ${(e as Error).message}` });
  }

  m.balance += amount;
  store.putModule(m);
  res.json({ txHash, balance: m.balance });
});

/**
 * GET /modules — list modules (Dashboard + Browse).
 *
 * When the chain is live, the module SET itself comes from the Perk contract's
 * on-chain index (stellar.listModulesOnChain) — so every machine pointed at the
 * same PERK_CONTRACT_ID sees the identical, live list, with no dependency on any
 * single machine's local store. Local-store rows only supply display-only extras
 * (createdBy, status) merged in by moduleId when present; a module created on
 * another machine still shows up fully, just without those local-only fields.
 *
 * If the on-chain list read fails, we degrade to the local store so the
 * dashboard still renders this machine's known modules. In mock mode there is
 * no chain, so the local store is authoritative.
 */
modulesRouter.get("/", async (_req, res) => {
  if (chainLive) {
    try {
      const onChain = await stellar.listModulesOnChain();
      const views = onChain.map((c) => {
        const local = store.getModule(c.moduleId); // display-only extras, may be undefined
        return {
          moduleId: c.moduleId,
          repoId: c.repoId, // full human-readable String, straight from chain
          balance: c.balance,
          approvalMode: c.approvalMode as ApprovalMode,
          rewardToken: c.token,
          status: local?.status ?? "Open",
          onChain: true, // genuinely read from the Perk contract
        };
      });
      return res.json(views);
    } catch {
      // Chain read failed — fall through to the local-store mirror below so the
      // dashboard still renders instead of erroring.
    }
  }

  const mirrored = store.listModules();
  const views = mirrored.map((m) => ({
    moduleId: m.moduleId,
    repoId: m.repoId,
    balance: m.balance,
    approvalMode: m.approvalMode,
    rewardToken: m.rewardToken,
    status: m.status,
    onChain: false, // mock mode or degraded read: not live from chain
  }));
  res.json(views);
});

/** GET /modules/:moduleId — single module detail. */
modulesRouter.get("/:moduleId", async (req, res) => {
  const view = await stellar.getModule(req.params.moduleId);
  if (!view) return res.status(404).json({ error: "module not found" });
  res.json(view);
});
