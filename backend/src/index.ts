import express from "express";
import cors from "cors";
import { config, chainLive } from "./config.js";
import { modulesRouter } from "./routes/modules.js";
import { claimsRouter } from "./routes/claims.js";

const app = express();
app.use(cors({ origin: config.corsOrigin === "*" ? true : config.corsOrigin.split(",") }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    chainLive,
    network: config.network,
    proverMode: config.proverMode,
    x402Mode: config.x402Mode,
  });
});

app.use("/modules", modulesRouter);
app.use("/claims", claimsRouter);

// Fallback error handler.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err?.message ?? "internal error" });
});

app.listen(config.port, () => {
  console.log(`hiPerk backend listening on :${config.port}`);
  console.log(
    `  chain=${chainLive ? "LIVE" : "MOCK"}  prover=${config.proverMode}  x402=${config.x402Mode}`,
  );
  if (!chainLive) {
    console.log("  (set GATEKEEPER_CONTRACT_ID, PERK_CONTRACT_ID, RELAYER_SECRET_KEY for live chain)");
  }
});
