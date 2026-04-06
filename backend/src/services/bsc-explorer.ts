import { ethers } from 'ethers';
import { cache } from '../cache/memory-cache';
import type { ExplorerTx } from './explorer';

/**
 * Discover BSC token addresses from CoinGecko master list.
 * Cached for 24h since the list rarely changes.
 */
export async function discoverBscTokens(_address: string): Promise<string[]> {
  const cgCacheKey = 'bsc:coingecko:addresses';
  let cgAddrs = cache.get<string[]>(cgCacheKey);
  if (cgAddrs) return cgAddrs;

  try {
    const resp = await fetch('https://api.coingecko.com/api/v3/coins/list?include_platform=true');
    const coins = (await resp.json()) as any[];
    cgAddrs = coins
      .map((c: any) => c.platforms?.['binance-smart-chain'])
      .filter((a: any) => a && typeof a === 'string' && a.startsWith('0x'))
      .map((a: string) => a.toLowerCase());
    cache.set(cgCacheKey, cgAddrs, 24 * 60 * 60_000); // 24h
    console.log(`[bsc] Loaded ${cgAddrs.length} BSC token addresses from CoinGecko`);
    return cgAddrs;
  } catch {
    return [];
  }
}

/**
 * Get BSC token Transfer events via drpc.org getLogs.
 * Only scans recent blocks (~1 day). Returns empty for inactive wallets.
 */
export async function getBscTransactions(address: string): Promise<ExplorerTx[]> {
  const cacheKey = `bsc:txs:${address}`;
  const cached = cache.get<ExplorerTx[]>(cacheKey);
  if (cached) return cached;

  const provider = new ethers.JsonRpcProvider('https://bsc.drpc.org');
  const transferTopic = ethers.id('Transfer(address,address,uint256)');
  const paddedAddr = ethers.zeroPadValue(address, 32);
  const allLogs: ethers.Log[] = [];

  try {
    const bn = await provider.getBlockNumber();
    const chunkSize = 10000;
    const totalBlocks = 30000; // ~1 day — keep it fast

    for (let offset = 0; offset < totalBlocks; offset += chunkSize) {
      const toBlock = bn - offset;
      const fromBlock = toBlock - chunkSize;
      try {
        const [logsIn, logsOut] = await Promise.all([
          provider.getLogs({ fromBlock, toBlock, topics: [transferTopic, null, paddedAddr] }),
          provider.getLogs({ fromBlock, toBlock, topics: [transferTopic, paddedAddr, null] }),
        ]);
        allLogs.push(...logsIn, ...logsOut);
      } catch {}
    }
  } catch (err) {
    console.error('BSC transaction fetch failed:', err);
  }

  if (allLogs.length === 0) {
    cache.set(cacheKey, [], 60_000);
    return [];
  }

  // Resolve token metadata
  const mainProvider = new ethers.JsonRpcProvider('https://bsc-dataseed1.binance.org');
  const metaIface = new ethers.Interface([
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
  ]);
  const metaCache = new Map<string, { symbol: string; decimals: number }>();
  const txs: ExplorerTx[] = [];

  for (const log of allLogs) {
    const from = ethers.getAddress('0x' + (log.topics[1]?.slice(26) || ''));
    const to = ethers.getAddress('0x' + (log.topics[2]?.slice(26) || ''));
    const value = BigInt(log.data);
    const isReceive = to.toLowerCase() === address.toLowerCase();

    let meta = metaCache.get(log.address);
    if (!meta) {
      try {
        const c = new ethers.Contract(log.address, metaIface, mainProvider);
        const [sym, dec] = await Promise.all([
          c.symbol().catch(() => '?'),
          c.decimals().catch(() => 18),
        ]);
        meta = { symbol: sym, decimals: Number(dec) };
      } catch {
        meta = { symbol: '?', decimals: 18 };
      }
      metaCache.set(log.address, meta);
    }

    txs.push({
      hash: log.transactionHash,
      blockNumber: log.blockNumber,
      timestamp: '',
      from,
      to,
      value: ethers.formatUnits(value, meta.decimals),
      tokenSymbol: meta.symbol,
      tokenAddress: log.address,
      type: isReceive ? 'receive' : 'send',
    });
  }

  cache.set(cacheKey, txs, 60_000);
  return txs;
}
