/**
 * NodeReal MegaNode — replacement for Moralis on BSC (and Ethereum if ever
 * needed). Free plan: 10M CU/month, so every call here is budgeted:
 *   nr_getAssetTransfers 250 CU, nr_getTokenHoldings 300 CU,
 *   eth_getLogs 50, eth_getTransactionCount 25, eth_getBalance 15, eth_blockNumber 5.
 * The expensive calls only run when detectActivity() says something changed.
 */
import { config } from '../config/rpc';

const ENDPOINTS: Record<string, string> = {
  bsc: 'https://bsc-mainnet.nodereal.io/v1/',
  ethereum: 'https://eth-mainnet.nodereal.io/v1/',
};

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const MAX_LOG_RANGE = 45_000; // NodeReal free plan: "exceed maximum block range: 50000"

export function isNodeRealEnabled(): boolean {
  return config.noderealApiKey.length > 0;
}

export function isNodeRealChain(chain: string): boolean {
  return chain in ENDPOINTS;
}

/** Indexer-backed methods lag a little behind the node head; stay this far behind it. */
const HEAD_LAG = 50;

async function rpc<T>(chain: string, method: string, params: unknown[], attempt = 0): Promise<T> {
  const base = ENDPOINTS[chain];
  if (!base || !config.noderealApiKey) throw new Error(`nodereal: unsupported chain ${chain} or no key`);
  try {
    const resp = await fetch(base + config.noderealApiKey, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!resp.ok) throw new Error(`nodereal ${method} HTTP ${resp.status}`);
    const data = (await resp.json()) as { result?: T; error?: { code: number; message: string } };
    if (data.error) throw new Error(`nodereal ${method}: ${data.error.message}`);
    return data.result as T;
  } catch (err: any) {
    // Network blips and 5xx: retry twice with a short pause.
    const msg = String(err?.message || err);
    const retryable = /fetch failed|ECONNRESET|socket|HTTP 5\d\d|timeout/i.test(msg);
    if (retryable && attempt < 2) {
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      return rpc<T>(chain, method, params, attempt + 1);
    }
    throw err;
  }
}

function padTopic(address: string): string {
  return '0x' + address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

// ---- cheap activity detector ----

export interface ActivityState {
  nonce: number;
  balanceWei: string;
  lastBlock: number;
}

/**
 * Detects whether a wallet had any activity since `prev` using ~90 CU:
 * nonce (outgoing txs), native balance (incoming BNB), and incoming ERC-20
 * Transfer logs since the last checked block.
 */
export async function detectActivity(
  chain: string,
  address: string,
  prev: ActivityState | undefined
): Promise<{ changed: boolean; state: ActivityState }> {
  const [nonceHex, balHex, headHex] = await Promise.all([
    rpc<string>(chain, 'eth_getTransactionCount', [address, 'latest']),
    rpc<string>(chain, 'eth_getBalance', [address, 'latest']),
    rpc<string>(chain, 'eth_blockNumber', []),
  ]);
  const nonce = parseInt(nonceHex, 16);
  const head = parseInt(headHex, 16) - HEAD_LAG;
  const balanceWei = BigInt(balHex).toString();
  const state: ActivityState = { nonce, balanceWei, lastBlock: head };

  if (!prev) return { changed: true, state };
  if (nonce !== prev.nonce || balanceWei !== prev.balanceWei) return { changed: true, state };

  const from = Math.max(prev.lastBlock + 1, head - MAX_LOG_RANGE);
  if (from > head) return { changed: false, state };
  const logs = await rpc<unknown[]>(chain, 'eth_getLogs', [{
    fromBlock: '0x' + from.toString(16),
    toBlock: '0x' + head.toString(16),
    topics: [TRANSFER_TOPIC, null, padTopic(address)],
  }]);
  return { changed: logs.length > 0, state };
}

// ---- transfers ----

export interface NrTransfer {
  hash: string;
  blockNumber: number;
  timestamp: string;        // ISO
  from: string;
  to: string;
  amount: number;           // formatted
  symbol: string;
  contractAddress: string;  // lowercased, or 'native'
  decimals: number;
  feeNative: number;        // gasUsed * gasPrice, in BNB/ETH
}

interface RawTransfer {
  category: string;
  blockNum: string;
  from: string;
  to: string;
  value: string;
  asset?: string;
  hash: string;
  contractAddress?: string | null;
  decimal?: string | null;
  blockTimeStamp: number;
  gasPrice?: number;
  gasUsed?: number;
}

function hexToAmount(hex: string, decimals: number): number {
  try {
    const v = BigInt(hex);
    const base = 10n ** BigInt(decimals);
    const whole = v / base;
    const frac = v % base;
    return Number(whole) + Number(frac) / Number(base);
  } catch {
    return 0;
  }
}

const MAX_TRANSFER_RANGE = 1_900_000; // NodeReal: "range must be less than 2000000"

/** Seconds per block, measured over the last 1M blocks; cached for an hour. */
const spbCache = new Map<string, { value: number; at: number }>();
export async function secondsPerBlock(chain: string, head: number): Promise<number> {
  const c = spbCache.get(chain);
  if (c && Date.now() - c.at < 60 * 60 * 1000) return c.value;
  const span = 1_000_000;
  const [b1, b0] = await Promise.all([
    rpc<{ timestamp: string }>(chain, 'eth_getBlockByNumber', ['0x' + head.toString(16), false]),
    rpc<{ timestamp: string }>(chain, 'eth_getBlockByNumber', ['0x' + (head - span).toString(16), false]),
  ]);
  const value = (parseInt(b1.timestamp, 16) - parseInt(b0.timestamp, 16)) / span || 0.75;
  spbCache.set(chain, { value, at: Date.now() });
  return value;
}

/**
 * All native + ERC-20 transfers touching `address` in [fromBlock, toBlock],
 * both directions, newest first. The API's own ordering is not chronological,
 * so the range is walked in <2M-block chunks and sorted here. 250 CU per call.
 */
export async function getAssetTransfers(
  chain: string,
  address: string,
  fromBlock: number,
  toBlock: number,
  maxPagesPerChunk = 10
): Promise<NrTransfer[]> {
  const out: NrTransfer[] = [];
  const seen = new Set<string>();

  for (const direction of ['toAddress', 'fromAddress'] as const) {
    for (let to = toBlock; to >= fromBlock; to -= MAX_TRANSFER_RANGE) {
      const from = Math.max(fromBlock, to - MAX_TRANSFER_RANGE + 1);
      let pageKey: string | undefined;
      for (let page = 0; page < maxPagesPerChunk; page++) {
        const params: Record<string, unknown> = {
          category: ['external', '20'],
          [direction]: address,
          fromBlock: '0x' + from.toString(16),
          toBlock: '0x' + to.toString(16),
          maxCount: '0x64',
        };
        if (pageKey) params.pageKey = pageKey;
        let res: { transfers?: RawTransfer[]; pageKey?: string };
        try {
          res = await rpc(chain, 'nr_getAssetTransfers', [params]);
        } catch (err: any) {
          if (!/blockNum not reached/i.test(String(err?.message))) throw err;
          // Indexer is behind the node head: retry this chunk a bit further back.
          params.toBlock = '0x' + Math.max(from, to - 500).toString(16);
          res = await rpc(chain, 'nr_getAssetTransfers', [params]);
        }
        const transfers = res.transfers || [];

        for (const t of transfers) {
          const ts = (t.blockTimeStamp || 0) * 1000;
          const isNative = t.category === 'external';
          const contract = isNative ? 'native' : (t.contractAddress || '').toLowerCase();
          const key = `${t.hash}:${contract}:${t.from}:${t.to}:${t.value}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const decimals = isNative ? 18 : parseInt(t.decimal || '18', 10) || 18;
          const gasUsed = Number(t.gasUsed || 0);
          const gasPrice = Number(t.gasPrice || 0);
          out.push({
            hash: (t.hash || '').toLowerCase(),
            blockNumber: parseInt(t.blockNum || '0x0', 16) || 0,
            timestamp: ts ? new Date(ts).toISOString() : '',
            from: (t.from || '').toLowerCase(),
            to: (t.to || '').toLowerCase(),
            amount: hexToAmount(t.value || '0x0', decimals),
            symbol: t.asset || (isNative ? '' : '?'),
            contractAddress: contract,
            decimals,
            feeNative: gasUsed && gasPrice ? (gasUsed * gasPrice) / 1e18 : 0,
          });
        }

        if (!res.pageKey || transfers.length === 0) break;
        pageKey = res.pageKey;
      }
    }
  }
  out.sort((a, b) => b.blockNumber - a.blockNumber);
  return out;
}

// ---- balances ----

export interface NrHolding {
  address: string;   // lowercased
  symbol: string;
  name: string;
  decimals: number;
  balanceRaw: string;
  balance: number;
}

export async function getTokenHoldings(
  chain: string,
  address: string
): Promise<{ nativeBalance: number; tokens: NrHolding[] }> {
  interface Res {
    totalCount: string;
    nativeTokenBalance: string;
    details: Array<{ tokenAddress: string; tokenBalance: string; tokenName: string; tokenSymbol: string; tokenDecimals: string }> | null;
  }
  const tokens: NrHolding[] = [];
  let nativeBalance = 0;
  for (let page = 1; page <= 2; page++) {
    const res = await rpc<Res>(chain, 'nr_getTokenHoldings', [address, '0x' + page.toString(16), '0x64']);
    nativeBalance = hexToAmount(res.nativeTokenBalance || '0x0', 18);
    for (const d of res.details || []) {
      const decimals = parseInt(d.tokenDecimals || '0x12', 16) || 18;
      const raw = BigInt(d.tokenBalance || '0x0');
      if (raw === 0n) continue;
      tokens.push({
        address: (d.tokenAddress || '').toLowerCase(),
        symbol: d.tokenSymbol || '?',
        name: d.tokenName || '',
        decimals,
        balanceRaw: raw.toString(),
        balance: hexToAmount(d.tokenBalance, decimals),
      });
    }
    const total = parseInt(res.totalCount || '0x0', 16);
    if (total <= page * 100) break;
  }
  return { nativeBalance, tokens };
}

/** Diagnostic probe for /api/transactions/moralis-check. */
export async function checkNodeReal(): Promise<{ configured: boolean; bsc: string; ethereum: string }> {
  if (!isNodeRealEnabled()) return { configured: false, bsc: 'no key', ethereum: 'no key' };
  const probe = async (chain: string) => {
    try { return 'ok, block ' + parseInt(await rpc<string>(chain, 'eth_blockNumber', []), 16); }
    catch (e: any) { return 'ERR ' + (e?.message || e); }
  };
  return { configured: true, bsc: await probe('bsc'), ethereum: await probe('ethereum') };
}
