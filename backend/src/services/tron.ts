import { config } from '../config/rpc';
import { cache } from '../cache/memory-cache';
import type { TokenBalance, NFTItem } from '../routes/portfolio';

const SUN_PER_TRX = 1_000_000;
const TRONSCAN_API = 'https://apilist.tronscanapi.com';
const TRONGRID_API = config.tronApiUrl; // https://api.trongrid.io

// Well-known TRC-20 tokens for TronGrid fallback
const KNOWN_TRC20: Record<string, { symbol: string; name: string; decimals: number }> = {
  'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t': { symbol: 'USDT', name: 'Tether USD', decimals: 6 },
  'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8': { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR': { symbol: 'WTRX', name: 'Wrapped TRX', decimals: 6 },
  'TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S': { symbol: 'SUN', name: 'SUN', decimals: 18 },
  'TAFjULxiVgT4qWk6UZwjqwZXTSaGaqnVp4': { symbol: 'BTT', name: 'BitTorrent', decimals: 18 },
  'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7': { symbol: 'WIN', name: 'WINkLink', decimals: 6 },
};

interface TronResult {
  nativeBalance: number;
  tokens: TokenBalance[];
  nfts: NFTItem[];
}

/**
 * Primary: TronScan /api/account (1 request, all data).
 * Fallback: TronGrid /v1/accounts (if TronScan fails or returns empty).
 */
export async function getTronPortfolio(address: string): Promise<TronResult> {
  // Try TronScan first
  const result = await fetchViaTronScan(address);
  if (result && result.tokens.length > 1) {
    return result;
  }

  // TronScan returned only native or failed — try TronGrid
  console.warn(`[tron] TronScan incomplete for ${address.slice(0, 12)}..., trying TronGrid`);
  const fallback = await fetchViaTronGrid(address);
  if (fallback && fallback.tokens.length > 1) {
    return fallback;
  }

  // Return whichever got more data
  return (result && result.tokens.length >= (fallback?.tokens.length || 0)) ? result! : (fallback || emptyResult());
}

function emptyResult(): TronResult {
  return { nativeBalance: 0, tokens: [], nfts: [] };
}

/** TronScan — single request, returns everything */
async function fetchViaTronScan(address: string): Promise<TronResult | null> {
  try {
    const resp = await fetch(`${TRONSCAN_API}/api/account?address=${address}`);
    if (!resp.ok) {
      console.warn(`[tron:tronscan] ${resp.status} for ${address.slice(0, 12)}...`);
      return null;
    }

    const data = await resp.json() as {
      balance?: number;
      trc20token_balances?: Array<{
        tokenId: string;
        balance: string;
        tokenName: string;
        tokenAbbr: string;
        tokenDecimal: number;
        tokenLogo?: string;
      }>;
    };

    const trxBalance = (data.balance || 0) / SUN_PER_TRX;
    const tokens: TokenBalance[] = [{
      address: 'native', symbol: 'TRX', name: 'Tron',
      decimals: 6, balance: (data.balance || 0).toString(), balanceFormatted: trxBalance,
    }];

    for (const t of data.trc20token_balances || []) {
      const dec = t.tokenDecimal ?? 6;
      const balNum = parseFloat(t.balance || '0') / Math.pow(10, dec);
      if (balNum < 0.001) continue;
      tokens.push({
        address: t.tokenId,
        symbol: t.tokenAbbr || t.tokenId.slice(0, 6),
        name: t.tokenName || 'Unknown TRC-20',
        decimals: dec, balance: t.balance, balanceFormatted: balNum,
        logoUri: t.tokenLogo || undefined,
      });
    }

    console.log(`[tron:tronscan] ${address.slice(0, 12)}... — ${tokens.length} tokens`);
    return { nativeBalance: trxBalance, tokens, nfts: [] };
  } catch (err) {
    console.warn(`[tron:tronscan] Error for ${address.slice(0, 12)}...`, err);
    return null;
  }
}

/** TronGrid fallback — account endpoint + known token metadata */
async function fetchViaTronGrid(address: string): Promise<TronResult | null> {
  try {
    const resp = await fetch(`${TRONGRID_API}/v1/accounts/${address}`);
    if (!resp.ok) return null;

    const accountData = await resp.json() as {
      data?: Array<{ balance?: number; trc20?: Array<Record<string, string>> }>;
    };
    const account = accountData.data?.[0];
    if (!account) return null;

    const trxBalance = (account.balance || 0) / SUN_PER_TRX;
    const tokens: TokenBalance[] = [{
      address: 'native', symbol: 'TRX', name: 'Tron',
      decimals: 6, balance: (account.balance || 0).toString(), balanceFormatted: trxBalance,
    }];

    for (const tokenObj of account.trc20 || []) {
      const [contractAddr, rawBalance] = Object.entries(tokenObj)[0] || [];
      if (!contractAddr || !rawBalance || rawBalance === '0') continue;

      const meta = KNOWN_TRC20[contractAddr];
      const dec = meta?.decimals ?? 6;
      const balNum = parseFloat(rawBalance) / Math.pow(10, dec);
      if (balNum < 0.001 && !meta) continue;

      tokens.push({
        address: contractAddr,
        symbol: meta?.symbol || contractAddr.slice(0, 6),
        name: meta?.name || 'TRC-20',
        decimals: dec, balance: rawBalance, balanceFormatted: balNum,
      });
    }

    console.log(`[tron:trongrid] ${address.slice(0, 12)}... — ${tokens.length} tokens`);
    return { nativeBalance: trxBalance, tokens, nfts: [] };
  } catch (err) {
    console.warn(`[tron:trongrid] Error for ${address.slice(0, 12)}...`, err);
    return null;
  }
}
