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

  proverMode: (process.env.PROVER_MODE ?? "mock") as "mock" | "boundless",
  x402Mode: (process.env.X402_MODE ?? "mock") as "mock" | "live",

  defaultRewardAmount: Number(process.env.DEFAULT_REWARD_AMOUNT ?? "400"),

  port: Number(process.env.PORT ?? "4000"),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
};

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

export function networkPassphrase(): string {
  return config.network === "public"
    ? "Public Global Stellar Network ; September 2015"
    : "Test SDF Network ; September 2015";
}
