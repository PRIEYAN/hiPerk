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

/** POST /modules — admin creates a module. */
modulesRouter.post("/", async (req, res) => {
  const { repoId, rewardToken, approvalMode, createdBy } = req.body ?? {};
  if (!repoId) return res.status(400).json({ error: "repoId required" });

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

  const m: Module = {
    moduleId,
    repoId,
    rewardToken: token,
    approvalMode: mode,
    balance: 0,
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
 * The module index (which modules exist) comes from the off-chain store, since
 * Soroban can't enumerate storage. But the balance/approval/token for each is
 * read LIVE from the Perk contract via get_module, so the dashboard reflects
 * real on-chain pool state — not a stale mirror. If a chain read fails (or we're
 * in mock mode) we fall back to the mirrored values for that module.
 */
modulesRouter.get("/", async (_req, res) => {
  const mirrored = store.listModules();
  const views = await Promise.all(
    mirrored.map(async (m) => {
      let onChain: Awaited<ReturnType<typeof stellar.getModule>> | undefined;
      try {
        onChain = await stellar.getModule(m.moduleId);
      } catch {
        onChain = undefined; // degrade to mirror for this module
      }
      // Only claim "on-chain" when the chain is actually live AND the read
      // succeeded — in mock mode getModule returns the mirror, which isn't chain.
      const live = chainLive && Boolean(onChain);
      return {
        moduleId: m.moduleId,
        repoId: m.repoId, // human-readable, from the mirror (on-chain is lossy Symbol)
        balance: onChain ? onChain.balance : m.balance,
        approvalMode: onChain ? (onChain.approvalMode as ApprovalMode) : m.approvalMode,
        rewardToken: onChain ? onChain.token : m.rewardToken,
        status: m.status,
        onChain: live, // UI badge: genuinely read from the Perk contract
      };
    }),
  );
  res.json(views);
});

/** GET /modules/:moduleId — single module detail. */
modulesRouter.get("/:moduleId", async (req, res) => {
  const view = await stellar.getModule(req.params.moduleId);
  if (!view) return res.status(404).json({ error: "module not found" });
  res.json(view);
});
