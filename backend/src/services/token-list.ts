import { cache } from '../cache/memory-cache';

interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
}

const UNISWAP_TOKEN_LIST_URL = 'https://tokens.uniswap.org';

export async function getTopBscTokens(): Promise<TokenInfo[]> {
  const cacheKey = 'token-list:bsc';
  const cached = cache.get<TokenInfo[]>(cacheKey);
  if (cached) return cached;

  try {
    // PancakeSwap extended token list includes BSC tokens
    const resp = await fetch('https://tokens.pancakeswap.finance/pancakeswap-extended.json');
    const data = (await resp.json()) as { tokens?: any[] };

    const bscTokens: TokenInfo[] = (data.tokens || [])
      .filter((t: any) => t.chainId === 56)
      .slice(0, 200)
      .map((t: any) => ({
        address: t.address,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        logoURI: t.logoURI,
      }));

    cache.set(cacheKey, bscTokens, 24 * 60 * 60 * 1000);
    return bscTokens;
  } catch (err) {
    console.error('Failed to fetch BSC token list:', err);
    return [];
  }
}

export async function getTopEthereumTokens(): Promise<TokenInfo[]> {
  const cacheKey = 'token-list:ethereum';
  const cached = cache.get<TokenInfo[]>(cacheKey);
  if (cached) return cached;

  try {
    const resp = await fetch(UNISWAP_TOKEN_LIST_URL);
    const data = (await resp.json()) as { tokens?: any[] };

    const ethTokens: TokenInfo[] = (data.tokens || [])
      .filter((t: any) => t.chainId === 1)
      .slice(0, 200)
      .map((t: any) => ({
        address: t.address,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        logoURI: t.logoURI,
      }));

    cache.set(cacheKey, ethTokens, 24 * 60 * 60 * 1000); // 24h
    return ethTokens;
  } catch (err) {
    console.error('Failed to fetch token list:', err);
    return [];
  }
}
