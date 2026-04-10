import { config } from '../config/rpc';
import { cache } from '../cache/memory-cache';
import type { TokenBalance, NFTItem } from '../routes/portfolio';

const API = config.tronApiUrl;
const SUN_PER_TRX = 1_000_000;

// Well-known TRC-20 tokens (TronGrid /v1/contracts often returns empty)
const KNOWN_TRC20: Record<string, { symbol: string; name: string; decimals: number }> = {
  'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t': { symbol: 'USDT', name: 'Tether USD', decimals: 6 },
  'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8': { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  'TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9': { symbol: 'BTC', name: 'Bitcoin (TRC20)', decimals: 8 },
  'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR': { symbol: 'WTRX', name: 'Wrapped TRX', decimals: 6 },
  'TFczxzPhnThNSqr5by8tvxsdCFRRz6cPNq': { symbol: 'NFT', name: 'APENFT', decimals: 6 },
  'TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S': { symbol: 'SUN', name: 'SUN', decimals: 18 },
  'TAFjULxiVgT4qWk6UZwjqwZXTSaGaqnVp4': { symbol: 'BTT', name: 'BitTorrent', decimals: 18 },
  'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7': { symbol: 'WIN', name: 'WINkLink', decimals: 6 },
  'THb4CqiFdwNHsWsQCs4JhzwjMWys4aqCbF': { symbol: 'ETH', name: 'Ethereum (TRC20)', decimals: 18 },
  'TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4': { symbol: 'TUSD', name: 'TrueUSD', decimals: 18 },
  'TMwFHYXLJaRUPeW6421aqXL4ZEzPRFGkGT': { symbol: 'USDJ', name: 'JUST Stablecoin', decimals: 18 },
  'TKkeiboTkxXKJpbmVFbv4a8ov5rAfRDMf9': { symbol: 'SUNDOG', name: 'Sundog', decimals: 18 },
};

/** Fetch with retry + delay for TronGrid rate limits */
async function tronFetch(url: string, retries = 2): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1000 * i));
    const resp = await fetch(url);
    if (resp.ok) {
      const data = await resp.json() as any;
      // TronGrid sometimes returns { success: false } even with 200
      if (data.success === false && i < retries) {
        console.warn(`[tron] Retry ${i + 1} for ${url.slice(0, 80)}...`);
        continue;
      }
      return data;
    }
    if (resp.status === 429 || resp.status >= 500) {
      console.warn(`[tron] ${resp.status} — retry ${i + 1} for ${url.slice(0, 80)}...`);
      continue;
    }
    // 4xx (except 429) — don't retry
    return await resp.json();
  }
  return {};
}

export async function getTronPortfolio(address: string): Promise<{
  nativeBalance: number;
  tokens: TokenBalance[];
  nfts: NFTItem[];
}> {
  // 1. Account info (TRX balance + TRC-20 list)
  const accountData = await tronFetch(`${API}/v1/accounts/${address}`) as {
    data?: Array<{
      balance?: number;
      trc20?: Array<Record<string, string>>;
    }>;
  };

  const account = accountData.data?.[0];
  if (!account) {
    console.warn(`[tron] No account data for ${address.slice(0, 12)}... — response keys: ${Object.keys(accountData).join(',')}`);
  }
  const trxBalance = (account?.balance || 0) / SUN_PER_TRX;

  const nativeToken: TokenBalance = {
    address: 'native',
    symbol: 'TRX',
    name: 'Tron',
    decimals: 6,
    balance: (account?.balance || 0).toString(),
    balanceFormatted: trxBalance,
  };

  // 2. TRC-20 tokens
  const tokens: TokenBalance[] = [nativeToken];
  const trc20List = account?.trc20 || [];

  for (const tokenObj of trc20List) {
    const [contractAddr, rawBalance] = Object.entries(tokenObj)[0] || [];
    if (!contractAddr || !rawBalance || rawBalance === '0') continue;

    const meta = await getTrc20TokenInfo(contractAddr);
    const balNum = parseFloat(rawBalance) / Math.pow(10, meta.decimals);

    // Skip dust/spam tokens with very small or no value
    if (balNum < 0.001 && !KNOWN_TRC20[contractAddr]) continue;

    tokens.push({
      address: contractAddr,
      symbol: meta.symbol,
      name: meta.name,
      decimals: meta.decimals,
      balance: rawBalance,
      balanceFormatted: balNum,
    });
  }

  return { nativeBalance: trxBalance, tokens, nfts: [] };
}

interface Trc20Meta {
  symbol: string;
  name: string;
  decimals: number;
}

async function getTrc20TokenInfo(contractAddr: string): Promise<Trc20Meta> {
  // Check known tokens first
  const known = KNOWN_TRC20[contractAddr];
  if (known) return known;

  const cacheKey = `tron:meta:${contractAddr}`;
  const cached = cache.get<Trc20Meta>(cacheKey);
  if (cached) return cached;

  try {
    const data = await tronFetch(`${API}/v1/contracts/${contractAddr}`) as {
      data?: Array<{ name?: string; symbol?: string; decimals?: number }>;
    };
    const info = data.data?.[0];
    if (info?.symbol) {
      const meta: Trc20Meta = {
        name: info.name || 'Unknown TRC-20',
        symbol: info.symbol,
        decimals: info.decimals ?? 6,
      };
      cache.set(cacheKey, meta, 24 * 60 * 60 * 1000);
      return meta;
    }
  } catch { /* fall through */ }

  // Try TronScan API as fallback
  try {
    const resp = await fetch(`https://apilist.tronscanapi.com/api/contract?contract=${contractAddr}`);
    if (resp.ok) {
      const data = (await resp.json()) as {
        data?: Array<{ tokenInfo?: { tokenName?: string; tokenAbbr?: string; tokenDecimal?: number } }>;
      };
      const tokenInfo = data.data?.[0]?.tokenInfo;
      if (tokenInfo?.tokenAbbr) {
        const meta: Trc20Meta = {
          name: tokenInfo.tokenName || 'Unknown TRC-20',
          symbol: tokenInfo.tokenAbbr,
          decimals: tokenInfo.tokenDecimal ?? 6,
        };
        cache.set(cacheKey, meta, 24 * 60 * 60 * 1000);
        return meta;
      }
    }
  } catch { /* fall through */ }

  return { symbol: contractAddr.slice(0, 6), name: 'Unknown TRC-20', decimals: 6 };
}
