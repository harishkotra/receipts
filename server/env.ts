import "dotenv/config";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name} in .env`);
  return v;
}

export const env = {
  memwalAccountId: req("MEMWAL_ACCOUNT_ID"),
  memwalAgentId: req("MEMWAL_AGENT_ID"),
  memwalServerUrl: process.env.MEMWAL_SERVER_URL ?? "https://relayer.memory.walrus.xyz",
  memwalKey: process.env.MEMWAL_KEY ?? "",
  /* local test double: same interface, blobs on disk. Never used for a submission run. */
  memwalFake: process.env.MEMWAL_FAKE === "1",
  namespace: process.env.MEMWAL_NAMESPACE ?? "receipts",
  tatumApiKey: process.env.TATUM_API_KEY ?? "",
  tatumSuiRpc: process.env.TATUM_SUI_RPC ?? "https://sui-mainnet.gateway.tatum.io",
  x402PayTo: process.env.X402_PAY_TO ?? "",
  x402PriceMist: process.env.X402_PRICE_MIST ?? "100000000",
  x402Network: process.env.X402_NETWORK ?? "sui:mainnet",
  x402Mock: process.env.X402_MOCK === "1",
  port: Number(process.env.PORT ?? 4310),
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "",
  openaiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "",
};

export const memwalReady = () => env.memwalFake || env.memwalKey.length >= 64;
