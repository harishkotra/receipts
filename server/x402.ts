import { env } from "./env.js";

export interface Requirement {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { name: string; symbol: string };
}

export function requirement(resource: string): Requirement {
  return {
    scheme: "exact",
    network: env.x402Network,
    maxAmountRequired: env.x402PriceMist,
    resource,
    description: "Verified receipt — full pick, evidence and tamper check",
    mimeType: "application/json",
    payTo: env.x402PayTo,
    maxTimeoutSeconds: 300,
    asset: "0x2::sui::SUI",
    extra: { name: "SUI", symbol: "SUI" },
  };
}

export function isConfigured(): boolean {
  return env.x402Mock || env.x402PayTo.startsWith("0x") && env.x402PayTo.length > 20;
}

const seen = new Set<string>();

interface VerifyOk {
  ok: true;
  mode: "chain" | "demo";
  txDigest: string;
  payer?: string;
  explorer: string;
}
interface VerifyErr {
  ok: false;
  error: string;
}

export async function verifyPayment(header: string | undefined): Promise<VerifyOk | VerifyErr> {
  if (!header) return { ok: false, error: "missing X-PAYMENT" };
  let payload: { txDigest?: string; payer?: string };
  try {
    payload = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    try {
      payload = JSON.parse(header);
    } catch {
      return { ok: false, error: "X-PAYMENT is not base64 JSON" };
    }
  }
  const digest = payload.txDigest;
  if (!digest) return { ok: false, error: "X-PAYMENT has no txDigest" };
  if (seen.has(digest)) return { ok: false, error: "payment already spent" };

  if (env.x402Mock) {
    seen.add(digest);
    return {
      ok: true,
      mode: "demo",
      txDigest: digest,
      payer: payload.payer,
      explorer: "mock://settlement-disabled",
    };
  }

  const rpc = env.tatumApiKey
    ? env.tatumSuiRpc
    : "https://fullnode.mainnet.sui.io";
  const res = await fetch(rpc, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(env.tatumApiKey ? { "x-api-key": env.tatumApiKey } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sui_getTransactionBlock",
      params: [digest, { showEffects: true, showBalanceChanges: true, showInput: true }],
    }),
  });
  if (!res.ok) return { ok: false, error: `sui rpc ${res.status}` };
  const body: any = await res.json();
  if (body.error) return { ok: false, error: `sui rpc: ${body.error.message}` };

  const tx = body.result;
  if (!tx?.effects?.status?.status || tx.effects.status.status !== "success") {
    return { ok: false, error: "transaction did not succeed" };
  }
  const price = BigInt(env.x402PriceMist);
  const paid = (tx.balanceChanges ?? []).some((c: any) => {
    const owner = c.owner?.AddressOwner;
    const amount = BigInt(c.amount ?? "0");
    return owner === env.x402PayTo && amount >= price && String(c.coinType).endsWith("::sui::SUI");
  });
  if (!paid) return { ok: false, error: "no matching SUI transfer to payTo" };

  seen.add(digest);
  return {
    ok: true,
    mode: "chain",
    txDigest: digest,
    payer: payload.payer,
    explorer: `https://suiscan.xyz/mainnet/tx/${digest}`,
  };
}
