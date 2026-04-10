import { cache } from '../cache/memory-cache';
import type { TokenBalance, NFTItem } from '../routes/portfolio';

const SUN_PER_TRX = 1_000_000;
const TRONSCAN_API = 'https://apilist.tronscanapi.com';

/**
 * Fetch TRON portfolio via TronScan /api/account — single request returns
 * TRX balance + all TRC-20 tokens with names, decimals, and balances.
 */
export async function getTronPortfolio(address: string): Promise<{
  nativeBalance: number;
  tokens: TokenBalance[];
  nfts: NFTItem[];
}> {
  const resp = await fetch(`${TRONSCAN_API}/api/account?address=${address}`);
  if (!resp.ok) {
    console.warn(`[tron] TronScan ${resp.status} for ${address.slice(0, 12)}...`);
    return { nativeBalance: 0, tokens: [], nfts: [] };
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

  const nativeToken: TokenBalance = {
    address: 'native',
    symbol: 'TRX',
    name: 'Tron',
    decimals: 6,
    balance: (data.balance || 0).toString(),
    balanceFormatted: trxBalance,
  };

  const tokens: TokenBalance[] = [nativeToken];

  for (const t of data.trc20token_balances || []) {
    const dec = t.tokenDecimal ?? 6;
    const rawBal = parseFloat(t.balance || '0');
    const balNum = rawBal / Math.pow(10, dec);

    if (balNum < 0.001) continue;

    tokens.push({
      address: t.tokenId,
      symbol: t.tokenAbbr || t.tokenId.slice(0, 6),
      name: t.tokenName || 'Unknown TRC-20',
      decimals: dec,
      balance: t.balance,
      balanceFormatted: balNum,
      logoUri: t.tokenLogo || undefined,
    });
  }

  console.log(`[tron] ${address.slice(0, 12)}... — ${tokens.length} tokens, TRX=${trxBalance.toFixed(2)}`);
  return { nativeBalance: trxBalance, tokens, nfts: [] };
}
