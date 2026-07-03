import dotenv from "dotenv";
dotenv.config();

function bool(v: string | undefined, dflt = false): boolean {
  if (v === undefined) return dflt;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

const rawChainMode = (process.env.CHAIN_MODE ?? "auto").toLowerCase();

export const config = {
  network: (process.env.STELLAR_NETWORK ?? "testnet") as "testnet" | "public",
  sorobanRpcUrl: process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",

  gatekeeperContractId: process.env.GATEKEEPER_CONTRACT_ID ?? "",
  perkContractId: process.env.PERK_CONTRACT_ID ?? "",

  relayerSecretKey: process.env.RELAYER_SECRET_KEY ?? "",
  adminPublicKey: process.env.ADMIN_PUBLIC_KEY ?? "",
  payoutTokenId: process.env.PAYOUT_TOKEN_ID ?? "",

  proverMode: (process.env.PROVER_MODE ?? "mock") as "mock" | "risc0",
  proverServiceUrl: process.env.PROVER_SERVICE_URL ?? "http://localhost:8080",
  x402Mode: (process.env.X402_MODE ?? "mock") as "mock" | "live",

  x402FacilitatorUrl: process.env.X402_FACILITATOR_URL ?? "",
  x402Network: process.env.X402_NETWORK ?? "stellar:testnet",
  x402PayTo: process.env.X402_PAY_TO ?? "",
  x402UsdcContractId: process.env.X402_USDC_CONTRACT_ID ?? "",
  x402PriceUsd: process.env.X402_PRICE_USD ?? "0.001",

  defaultRewardAmount: Number(process.env.DEFAULT_REWARD_AMOUNT ?? "400"),

  // --- Groq AI: automated PR-complexity -> reward sizing ---
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  groqModel: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
  // Reward is a small fraction of the CURRENT pool balance, scaled by the
  // Groq complexity score (1-10). These bound that fraction so a single claim
  // can never drain the pool and always stays "minimal".
  rewardMinPoolPct: Number(process.env.REWARD_MIN_POOL_PCT ?? "1"), // % of pool at score 1
  rewardMaxPoolPct: Number(process.env.REWARD_MAX_POOL_PCT ?? "5"), // % of pool at score 10

  port: Number(process.env.PORT ?? "4000"),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",

  // --- GitHub OAuth (off-chain PR-authorship verification) ---
  githubClientId: process.env.GITHUB_CLIENT_ID ?? "",
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
  githubCallbackUrl:
    process.env.GITHUB_CALLBACK_URL ?? `http://localhost:${Number(process.env.PORT ?? "4000")}/github/callback`,
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:8080",
};

export const githubOAuthConfigured: boolean = !!config.githubClientId && !!config.githubClientSecret;

/** Whether automated Groq-based reward sizing is available. Falls back to a
 * deterministic local heuristic when no key is set, so the flow still works. */
export const groqConfigured: boolean = !!config.groqApiKey;

/**
 * Whether the backend should submit real on-chain transactions.
 * In `auto` mode this is true only when the contracts AND relayer key are set,
 * so the project runs out-of-the-box (mock) without any Stellar config.
 */
export const chainLive: boolean = (() => {
  const hasCreds =
    !!config.gatekeeperContractId &&
    !!config.perkContractId &&
    !!config.relayerSecretKey;
  if (rawChainMode === "live") return true;
  if (rawChainMode === "mock") return false;
  return hasCreds; // auto
})();

/** A facilitator value only counts if it's a real http(s) URL, not a stray
 * token/typo (e.g. an exported shell var shadowing an empty .env). Without this
 * guard any non-empty string flips x402 "live" and crashes on fetch(url). */
function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Whether the claims endpoint should actually enforce x402 payment.
 * In `auto` mode this requires a valid facilitator URL + payTo address to be
 * configured, so the project still runs out-of-the-box without them.
 */
export const x402Live: boolean = (() => {
  if (config.x402Mode !== "live") return false; // mock
  if (!config.x402PayTo) return false;
  if (!config.x402FacilitatorUrl) return false;
  if (!isHttpUrl(config.x402FacilitatorUrl)) {
    console.warn(
      `[x402] X402_FACILITATOR_URL is not a valid http(s) URL (got "${config.x402FacilitatorUrl}") — ` +
        `staying in mock mode. Check for a stray exported X402_FACILITATOR_URL shell var shadowing .env.`,
    );
    return false;
  }
  return true;
})();

export function networkPassphrase(): string {
  return config.network === "public"
    ? "Public Global Stellar Network ; September 2015"
    : "Test SDF Network ; September 2015";
}
