import { cache } from '../cache/memory-cache';

const CHAIN_MAP: Record<string, string> = {
  ethereum: 'ethereum',
  bsc: 'bsc',
  tron: 'tron',
  solana: 'solana',
};

/**
 * Get token prices from DexScreener as fallback when CoinGecko doesn't have them
 */
export async function getDexScreenerPrices(
  chain: string,
  tokenAddresses: string[]
): Promise<Record<string, number>> {
  if (tokenAddresses.length === 0) return {};

  const dexChain = CHAIN_MAP[chain];
  if (!dexChain) return {};

  const prices: Record<string, number> = {};

  // DexScreener allows batch lookup by address (comma-separated, max ~30)
  const chunks = chunkArray(tokenAddresses, 30);

  for (const chunk of chunks) {
    const addresses = chunk.join(',');
    const cacheKey = `dexscreener:${dexChain}:${addresses}`;
    const cached = cache.get<Record<string, number>>(cacheKey);
    if (cached) {
      Object.assign(prices, cached);
      continue;
    }

    try {
      const resp = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${addresses}`
      );
      const data = (await resp.json()) as { pairs?: any[] };
      const chunkPrices: Record<string, number> = {};

      for (const pair of data.pairs || []) {
        if (pair.chainId !== dexChain) continue;
        const addr = pair.baseToken?.address?.toLowerCase();
        const price = parseFloat(pair.priceUsd || '0');
        if (addr && price > 0 && !chunkPrices[addr]) {
          // Take the first (most liquid) pair price
          chunkPrices[addr] = price;
        }
      }

      cache.set(cacheKey, chunkPrices, 60_000);
      Object.assign(prices, chunkPrices);
    } catch (err) {
      console.error(`DexScreener price fetch failed for ${dexChain}:`, err);
    }
  }

  return prices;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
