import { config } from '../config/rpc';
import { cache } from '../cache/memory-cache';
import type { TokenBalance, NFTItem } from '../routes/portfolio';

const API = config.tronApiUrl;
const SUN_PER_TRX = 1_000_000;

export async function getTronPortfolio(address: string): Promise<{
  nativeBalance: number;
  tokens: TokenBalance[];
  nfts: NFTItem[];
}> {
  // 1. Account info (TRX balance + TRC-20 list)
  const accountResp = await fetch(`${API}/v1/accounts/${address}`);
  const accountData = (await accountResp.json()) as {
    data?: Array<{
      balance?: number;
      trc20?: Array<Record<string, string>>;
    }>;
  };

  const account = accountData.data?.[0];
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
  const cacheKey = `tron:meta:${contractAddr}`;
  const cached = cache.get<Trc20Meta>(cacheKey);
  if (cached) return cached;

  try {
    const resp = await fetch(`${API}/v1/contracts/${contractAddr}`);
    const data = (await resp.json()) as {
      data?: Array<{ name?: string; symbol?: string; decimals?: number }>;
    };
    const info = data.data?.[0];
    const meta: Trc20Meta = {
      name: info?.name || 'Unknown TRC-20',
      symbol: info?.symbol || contractAddr.slice(0, 6),
      decimals: info?.decimals ?? 6,
    };
    cache.set(cacheKey, meta, 24 * 60 * 60 * 1000);
    return meta;
  } catch {
    return { symbol: contractAddr.slice(0, 6), name: 'Unknown TRC-20', decimals: 6 };
  }
}
