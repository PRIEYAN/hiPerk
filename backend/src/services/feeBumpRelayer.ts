import {
  Keypair,
  Transaction,
  TransactionBuilder,
  rpc,
} from "@stellar/stellar-sdk";
import { config, networkPassphrase, chainLive } from "../config.js";

/**
 * Fee-bump relayer.
 *
 * Holds the relayer keypair (from env, never exposed to the frontend) and
 * gives contributors a $0-fee experience: every contributor-triggered on-chain
 * action is routed through here, wrapped in a FeeBumpTransaction paid by the
 * relayer (implementation.md §6.4).
 */

let _relayer: Keypair | null = null;
export function relayerKeypair(): Keypair {
  if (_relayer) return _relayer;
  if (!config.relayerSecretKey) {
    throw new Error("RELAYER_SECRET_KEY not set — cannot sign on-chain transactions");
  }
  _relayer = Keypair.fromSecret(config.relayerSecretKey);
  return _relayer;
}

let _admin: Keypair | null = null;
/**
 * Admin keypair used to satisfy `admin.require_auth()` in create_module /
 * fund_module. Falls back to the relayer key when ADMIN_SECRET_KEY is unset —
 * which only authorizes correctly if the on-chain config.admin IS the relayer
 * account. When they differ (the common case), ADMIN_SECRET_KEY must be set to
 * the secret seed of the account stored as config.admin on the Perk contract.
 */
export function adminKeypair(): Keypair {
  if (_admin) return _admin;
  _admin = config.adminSecretKey
    ? Keypair.fromSecret(config.adminSecretKey)
    : relayerKeypair();
  return _admin;
}

/**
 * All keypairs the backend can sign Soroban auth entries with, keyed by public
 * key. invoke() signs each required auth entry with whichever of these matches
 * the entry's address credential.
 */
export function signerKeypairs(): Keypair[] {
  const keys = [relayerKeypair()];
  if (config.adminSecretKey) keys.push(Keypair.fromSecret(config.adminSecretKey));
  return keys;
}

export function relayerPublicKey(): string {
  return relayerKeypair().publicKey();
}

/**
 * Relayer public key, or a stable placeholder G-address in mock mode so the
 * orchestration flow runs without a configured relayer key.
 */
export function relayerPublicKeyOrMock(): string {
  if (!chainLive || !config.relayerSecretKey) {
    return "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  }
  return relayerKeypair().publicKey();
}

let _server: rpc.Server | null = null;
export function sorobanServer(): rpc.Server {
  if (!_server) {
    _server = new rpc.Server(config.sorobanRpcUrl, {
      allowHttp: config.sorobanRpcUrl.startsWith("http://"),
    });
  }
  return _server;
}

/**
 * Wrap an already-signed inner transaction in a fee-bump paid by the relayer,
 * submit it, and wait for the result. Returns the (inner) transaction hash.
 *
 * For Soroban contract invocations the inner tx is built + signed by the
 * relayer too (the relayer is the contract caller), so the fee-bump here is
 * primarily the mechanism that keeps fees off any contributor account and lets
 * us batch fee policy in one place.
 */
export async function sponsorAndSubmit(innerTx: Transaction): Promise<{ txHash: string }> {
  if (!chainLive) {
    return { txHash: simulatedHash() };
  }
  const relayer = relayerKeypair();
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    relayer,
    // Bump fee per operation; generous ceiling for testnet.
    (Number(innerTx.fee) * 10).toString(),
    innerTx,
    networkPassphrase(),
  );
  feeBump.sign(relayer);

  const server = sorobanServer();
  const sent = await server.sendTransaction(feeBump);
  if (sent.status === "ERROR") {
    throw new Error(`fee-bump submit failed: ${JSON.stringify(sent.errorResult)}`);
  }
  await waitForTx(sent.hash);
  return { txHash: innerTx.hash().toString("hex") };
}

async function waitForTx(hash: string): Promise<void> {
  const server = sorobanServer();
  for (let i = 0; i < 30; i++) {
    const res = await server.getTransaction(hash);
    if (res.status === "SUCCESS") return;
    if (res.status === "FAILED") {
      throw new Error(`transaction ${hash} failed on-chain`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for transaction ${hash}`);
}

function simulatedHash(): string {
  // Deterministic-ish fake hash for mock mode demos.
  return "SIMTX_" + Math.random().toString(16).slice(2).padEnd(58, "0").slice(0, 58);
}
