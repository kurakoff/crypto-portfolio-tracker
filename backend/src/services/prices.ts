import { config } from '../config/rpc';
import { cache } from '../cache/memory-cache';

const BASE = config.coingeckoBaseUrl;

export async function getNativePrice(coinId: string): Promise<number> {
  const cacheKey = `price:native:${coinId}`;
  const cached = cache.get<number>(cacheKey);
  if (cached !== null) return cached;

  try {
    const resp = await fetch(`${BASE}/simple/price?ids=${coinId}&vs_currencies=usd`);
    const data = (await resp.json()) as Record<string, { usd?: number }>;
    const price = data[coinId]?.usd || 0;
    cache.set(cacheKey, price, 60_000); // 60s
    return price;
  } catch (err) {
    console.error(`Failed to fetch ${coinId} price:`, err);
    return 0;
  }
}

export async function getTokenPrices(
  platform: string,
  contractAddresses: string[]
): Promise<Record<string, number>> {
  if (contractAddresses.length === 0) return {};

  const cacheKey = `price:tokens:${platform}:${contractAddresses.sort().join(',')}`;
  const cached = cache.get<Record<string, number>>(cacheKey);
  if (cached) return cached;

  const prices: Record<string, number> = {};

  // CoinGecko allows up to 100 addresses per request
  const chunks = chunkArray(contractAddresses, 100);

  for (const chunk of chunks) {
    try {
      const addresses = chunk.join(',');
      const resp = await fetch(
        `${BASE}/simple/token_price/${platform}?contract_addresses=${addresses}&vs_currencies=usd`
      );
      const data = (await resp.json()) as Record<string, { usd?: number }>;

      for (const [addr, priceData] of Object.entries(data)) {
        prices[addr.toLowerCase()] = (priceData as any)?.usd || 0;
      }
    } catch (err) {
      console.error(`Failed to fetch token prices for ${platform}:`, err);
    }
  }

  cache.set(cacheKey, prices, 60_000); // 60s
  return prices;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
