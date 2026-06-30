import {
  Account,
  Address,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { config, networkPassphrase, chainLive } from "../config.js";
import {
  relayerKeypair,
  relayerPublicKeyOrMock,
  sorobanServer,
  sponsorAndSubmit,
} from "./feeBumpRelayer.js";

function simHash(method: string): { txHash: string } {
  return { txHash: "SIMTX_" + method + "_" + Math.random().toString(16).slice(2, 12) };
}
import { store } from "../models/store.js";

/**
 * Wraps @stellar/stellar-sdk calls to the Gatekeeper and Perk contracts.
 *
 * When `chainLive` is false (no contracts/relayer configured) every method
 * returns a simulated result so the whole flow is demoable offline. When live,
 * it prepares + signs the invocation with the relayer key and submits it via a
 * fee-bump transaction.
 */

export interface ModulePoolView {
  moduleId: string;
  repoId: string;
  balance: number;
  approvalMode: string;
  token: string;
}

function symVal(s: string): xdr.ScVal {
  return nativeToScVal(s, { type: "symbol" });
}

function bytes32Val(hex: string): xdr.ScVal {
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    throw new Error(`expected 32-byte hex, got ${buf.length} bytes`);
  }
  return nativeToScVal(buf, { type: "bytes" });
}

function addrVal(g: string): xdr.ScVal {
  return new Address(g).toScVal();
}

function i128Val(n: number | string): xdr.ScVal {
  return nativeToScVal(BigInt(n), { type: "i128" });
}

/**
 * Build → simulate → sign(relayer) → fee-bump submit a contract invocation.
 * Returns the transaction hash.
 */
async function invoke(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<{ txHash: string }> {
  if (!chainLive) {
    return { txHash: "SIMTX_" + method + "_" + Math.random().toString(16).slice(2, 12) };
  }

  const server = sorobanServer();
  const relayer = relayerKeypair();
  const source = await server.getAccount(relayer.publicKey());

  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(new Account(source.accountId(), source.sequenceNumber()), {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(relayer);

  // prepared is a Transaction; wrap in fee-bump and submit.
  return sponsorAndSubmit(prepared as any);
}

/** Read-only contract call via simulation (no submission). */
async function readCall(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<any> {
  const server = sorobanServer();
  const relayer = relayerKeypair();
  const source = await server.getAccount(relayer.publicKey());
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(new Account(source.accountId(), source.sequenceNumber()), {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  if ("error" in sim && sim.error) {
    throw new Error(`simulate ${method} failed: ${sim.error}`);
  }
  const retval = (sim as any).result?.retval;
  return retval ? scValToNative(retval) : undefined;
}

// ---------------------------------------------------------------------------
// Gatekeeper
// ---------------------------------------------------------------------------

export async function registerMember(
  repoId: string,
  commitment: string,
): Promise<{ txHash: string }> {
  if (!chainLive) return simHash("register_member");
  return invoke(config.gatekeeperContractId, "register_member", [
    addrVal(relayerPublicKeyOrMock()),
    symVal(repoId),
    bytes32Val(commitment),
  ]);
}

// ---------------------------------------------------------------------------
// Perk / Module
// ---------------------------------------------------------------------------

export async function createModule(params: {
  moduleId: string;
  repoId: string;
  token: string;
  approvalMode: string;
}): Promise<{ txHash: string }> {
  if (!chainLive) return simHash("create_module");
  return invoke(config.perkContractId, "create_module", [
    addrVal(config.adminPublicKey || relayerPublicKeyOrMock()),
    symVal(params.moduleId),
    symVal(params.repoId),
    addrVal(params.token),
    symVal(params.approvalMode),
  ]);
}

export async function fundModule(
  moduleId: string,
  amount: number,
): Promise<{ txHash: string }> {
  if (!chainLive) return simHash("fund_module");
  return invoke(config.perkContractId, "fund_module", [
    addrVal(config.adminPublicKey || relayerPublicKeyOrMock()),
    symVal(moduleId),
    i128Val(amount),
  ]);
}

export async function claimReward(params: {
  moduleId: string;
  commitment: string;
  nullifier: string;
  payoutAddress: string;
  amount: number;
}): Promise<{ txHash: string }> {
  if (!chainLive) return simHash("claim");
  return invoke(config.perkContractId, "claim", [
    addrVal(relayerPublicKeyOrMock()),
    symVal(params.moduleId),
    bytes32Val(params.commitment),
    bytes32Val(params.nullifier),
    addrVal(params.payoutAddress),
    i128Val(params.amount),
  ]);
}

export async function getModule(moduleId: string): Promise<ModulePoolView | undefined> {
  if (!chainLive) {
    const m = store.getModule(moduleId);
    if (!m) return undefined;
    return {
      moduleId: m.moduleId,
      repoId: m.repoId,
      balance: m.balance,
      approvalMode: m.approvalMode,
      token: m.rewardToken,
    };
  }
  const raw = await readCall(config.perkContractId, "get_module", [symVal(moduleId)]);
  if (!raw) return undefined;
  return {
    moduleId: String(raw.module_id),
    repoId: String(raw.repo_id),
    balance: Number(raw.balance),
    approvalMode: String(raw.approval_mode),
    token: String(raw.token),
  };
}
