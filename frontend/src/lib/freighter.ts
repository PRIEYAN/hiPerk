export class WrongNetworkError extends Error {
  constructor(public readonly network: string) {
    super(`Freighter is set to ${network}. Switch it to TESTNET and try again.`);
  }
}

// Real Freighter connection (browser only). Falls back to a mock address
// if the extension isn't installed so the flow stays clickable.
export async function connectFreighter(): Promise<string> {
  try {
    const mod = await import("@stellar/freighter-api");
    const api: any = mod;
    if (api.isConnected) {
      try { await api.isConnected(); } catch {}
    }
    if (api.setAllowed) {
      try { await api.setAllowed(); } catch {}
    }

    // hiPerk only runs on Stellar testnet — Freighter's extension-wide
    // network setting is whatever the user last picked, so it must be
    // checked explicitly rather than assumed.
    if (api.getNetwork) {
      const { network } = await api.getNetwork();
      if (network && network.toUpperCase() !== "TESTNET") {
        throw new WrongNetworkError(network);
      }
    }

    if (api.requestAccess) {
      const res = await api.requestAccess();
      if (typeof res === "string") return res;
      if (res?.address) return res.address;
    }
    if (api.getAddress) {
      const res = await api.getAddress();
      if (res?.address) return res.address;
    }
    if (api.getPublicKey) {
      const pk = await api.getPublicKey();
      if (typeof pk === "string" && pk) return pk;
    }
    throw new Error("Freighter not available");
  } catch (e) {
    if (e instanceof WrongNetworkError) throw e;
    // mock address so demo continues
    return "GDEMOXX" + Math.random().toString(36).slice(2, 10).toUpperCase() + "STELLAR";
  }
}
