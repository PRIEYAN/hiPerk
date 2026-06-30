import { Router } from "express";
import { nanoid } from "nanoid";
import { store } from "../models/store.js";
import { Module, ApprovalMode } from "../models/types.js";
import { config } from "../config.js";
import * as stellar from "../services/stellarClient.js";

export const modulesRouter = Router();

/** POST /modules — admin creates a module. */
modulesRouter.post("/", async (req, res) => {
  const { repoId, rewardToken, approvalMode, createdBy } = req.body ?? {};
  if (!repoId) return res.status(400).json({ error: "repoId required" });

  const mode: ApprovalMode = approvalMode === "automatic" ? "automatic" : "manual";
  const moduleId = `mod_${nanoid(6)}`;
  const token = rewardToken || config.payoutTokenId || "USDC";

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

/** GET /modules — list modules (Dashboard + Browse). */
modulesRouter.get("/", (_req, res) => {
  res.json(
    store.listModules().map((m) => ({
      moduleId: m.moduleId,
      repoId: m.repoId,
      balance: m.balance,
      approvalMode: m.approvalMode,
      rewardToken: m.rewardToken,
      status: m.status,
    })),
  );
});

/** GET /modules/:moduleId — single module detail. */
modulesRouter.get("/:moduleId", async (req, res) => {
  const view = await stellar.getModule(req.params.moduleId);
  if (!view) return res.status(404).json({ error: "module not found" });
  res.json(view);
});
