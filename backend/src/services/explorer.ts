import { cache } from '../cache/memory-cache';

export interface ExplorerTx {
  hash: string;
  blockNumber: number;
  timestamp: string;
  from: string;
  to: string;
  value: string;
  tokenSymbol: string;
  tokenAddress: string;
  type: string;
}

// ---- Ethereum via Blockscout V2 (no API key needed) ----

async function blockscoutTokenTransfers(address: string): Promise<ExplorerTx[]> {
  const cacheKey = `blockscout:tokentx:${address}`;
  const cached = cache.get<ExplorerTx[]>(cacheKey);
  if (cached) return cached;

  try {
    const resp = await fetch(
      `https://eth.blockscout.com/api/v2/addresses/${address}/token-transfers`
    );
    const data = (await resp.json()) as { items?: any[] };

    const txs: ExplorerTx[] = (data.items || []).map((item: any) => ({
      hash: item.tx_hash || '',
      blockNumber: item.block_number || 0,
      timestamp: item.timestamp || '',
      from: item.from?.hash || '',
      to: item.to?.hash || '',
      value: formatBlockscoutValue(item.total?.value, item.total?.decimals || item.token?.decimals || 18),
      tokenSymbol: item.token?.symbol || 'UNKNOWN',
      tokenAddress: item.token?.address_hash || item.token?.address || '',
      type: (item.from?.hash || '').toLowerCase() === address.toLowerCase() ? 'send' : 'receive',
    }));

    cache.set(cacheKey, txs, 60_000);
    return txs;
  } catch (err) {
    console.error('Blockscout token transfers failed:', err);
    return [];
  }
}

async function blockscoutNativeTransfers(address: string): Promise<ExplorerTx[]> {
  const cacheKey = `blockscout:nativetx:${address}`;
  const cached = cache.get<ExplorerTx[]>(cacheKey);
  if (cached) return cached;

  try {
    const resp = await fetch(
      `https://eth.blockscout.com/api/v2/addresses/${address}/transactions?filter=to%7Cfrom`
    );
    const data = (await resp.json()) as { items?: any[] };

    const txs: ExplorerTx[] = (data.items || [])
      .filter((item: any) => item.value && item.value !== '0')
      .map((item: any) => ({
        hash: item.hash || '',
        blockNumber: item.block || 0,
        timestamp: item.timestamp || '',
        from: item.from?.hash || '',
        to: item.to?.hash || '',
        value: formatBlockscoutValue(item.value, 18),
        tokenSymbol: 'ETH',
        tokenAddress: 'native',
        type: (item.from?.hash || '').toLowerCase() === address.toLowerCase() ? 'send' : 'receive',
      }));

    cache.set(cacheKey, txs, 60_000);
    return txs;
  } catch (err) {
    console.error('Blockscout native tx failed:', err);
    return [];
  }
}

// Get unique tokens the wallet holds (for balance checking)
export interface ExplorerTokenBalance {
  contractAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  rawBalance: string;
}

async function blockscoutTokenList(address: string): Promise<ExplorerTokenBalance[]> {
  const cacheKey = `blockscout:tokenlist:${address}`;
  const cached = cache.get<ExplorerTokenBalance[]>(cacheKey);
  if (cached) return cached;

  try {
    const resp = await fetch(
      `https://eth.blockscout.com/api/v2/addresses/${address}/tokens`
    );
    const data = (await resp.json()) as { items?: any[] };

    const tokens = (data.items || [])
      .filter((item: any) => item.token?.type === 'ERC-20')
      .map((item: any) => ({
        contractAddress: item.token?.address_hash || item.token?.address || '',
        symbol: item.token?.symbol || 'UNKNOWN',
        name: item.token?.name || 'Unknown',
        decimals: parseInt(item.token?.decimals || '18'),
        rawBalance: item.value || '0',
      }));

    cache.set(cacheKey, tokens, 60_000);
    return tokens;
  } catch (err) {
    console.error('Blockscout token list failed:', err);
    return [];
  }
}

// ---- BSC via BscScan (V1 still works for BSC) ----

async function bscscanTransactions(address: string, action: 'txlist' | 'tokentx'): Promise<ExplorerTx[]> {
  const cacheKey = `bscscan:${action}:${address}`;
  const cached = cache.get<ExplorerTx[]>(cacheKey);
  if (cached) return cached;

  try {
    const resp = await fetch(
      `https://api.bscscan.com/api?module=account&action=${action}&address=${address}&startblock=0&endblock=99999999&page=1&offset=100&sort=desc`
    );
    const data = (await resp.json()) as { status: string; result: any[] };

    if (data.status !== '1' || !Array.isArray(data.result)) {
      cache.set(cacheKey, [], 30_000);
      return [];
    }

    const isTokenTx = action === 'tokentx';
    const txs: ExplorerTx[] = data.result.map((tx: any) => ({
      hash: tx.hash,
      blockNumber: parseInt(tx.blockNumber),
      timestamp: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
      from: tx.from,
      to: tx.to || '',
      value: isTokenTx
        ? formatTokenValue(tx.value, parseInt(tx.tokenDecimal || '18'))
        : formatWei(tx.value),
      tokenSymbol: isTokenTx ? (tx.tokenSymbol || 'UNKNOWN') : 'BNB',
      tokenAddress: isTokenTx ? tx.contractAddress : 'native',
      type: tx.from.toLowerCase() === address.toLowerCase() ? 'send' : 'receive',
    }));

    cache.set(cacheKey, txs, 60_000);
    return txs;
  } catch (err) {
    console.error(`BscScan ${action} failed:`, err);
    return [];
  }
}

// ---- Tron via TronGrid ----

export async function getTronTransactions(address: string): Promise<ExplorerTx[]> {
  const cacheKey = `explorer:tron:${address}`;
  const cached = cache.get<ExplorerTx[]>(cacheKey);
  if (cached) return cached;

  const txs: ExplorerTx[] = [];

  try {
    const resp = await fetch(`https://api.trongrid.io/v1/accounts/${address}/transactions?limit=50`);
    const data = (await resp.json()) as { data?: any[] };

    for (const tx of data.data || []) {
      const contract = tx.raw_data?.contract?.[0];
      if (!contract) continue;
      const param = contract.parameter?.value;
      if (!param || contract.type !== 'TransferContract') continue;

      txs.push({
        hash: tx.txID,
        blockNumber: tx.blockNumber || 0,
        timestamp: new Date(tx.block_timestamp || tx.raw_data?.timestamp || 0).toISOString(),
        from: param.owner_address || '',
        to: param.to_address || '',
        value: ((param.amount || 0) / 1_000_000).toString(),
        tokenSymbol: 'TRX',
        tokenAddress: 'native',
        type: (param.owner_address || '').toLowerCase() === address.toLowerCase() ? 'send' : 'receive',
      });
    }
  } catch (err) {
    console.error('Tron native tx failed:', err);
  }

  try {
    const resp = await fetch(`https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?limit=50`);
    const data = (await resp.json()) as { data?: any[] };

    for (const tx of data.data || []) {
      txs.push({
        hash: tx.transaction_id,
        blockNumber: 0,
        timestamp: new Date(tx.block_timestamp || 0).toISOString(),
        from: tx.from || '',
        to: tx.to || '',
        value: tx.value ? formatTokenValue(tx.value, tx.token_info?.decimals || 6) : '0',
        tokenSymbol: tx.token_info?.symbol || 'UNKNOWN',
        tokenAddress: tx.token_info?.address || '',
        type: (tx.from || '').toLowerCase() === address.toLowerCase() ? 'send' : 'receive',
      });
    }
  } catch (err) {
    console.error('Tron TRC-20 tx failed:', err);
  }

  cache.set(cacheKey, txs, 60_000);
  return txs;
}

// ---- Unified public API ----

export async function getNativeTransactions(chain: string, address: string): Promise<ExplorerTx[]> {
  if (chain === 'ethereum') return blockscoutNativeTransfers(address);
  if (chain === 'bsc') return bscscanTransactions(address, 'txlist');
  if (chain === 'tron') return getTronTransactions(address);
  return [];
}

export async function getTokenTransactions(chain: string, address: string): Promise<ExplorerTx[]> {
  if (chain === 'ethereum') return blockscoutTokenTransfers(address);
  if (chain === 'bsc') return bscscanTransactions(address, 'tokentx');
  return [];
}

export async function getTokenBalances(
  chain: string,
  address: string
): Promise<ExplorerTokenBalance[]> {
  if (chain === 'ethereum') return blockscoutTokenList(address);
  if (chain === 'bsc') {
    const txs = await bscscanTransactions(address, 'tokentx');
    const seen = new Map<string, { symbol: string; name: string }>();
    for (const tx of txs) {
      if (!seen.has(tx.tokenAddress.toLowerCase())) {
        seen.set(tx.tokenAddress.toLowerCase(), { symbol: tx.tokenSymbol, name: tx.tokenSymbol });
      }
    }
    return Array.from(seen.entries()).map(([addr, info]) => ({
      contractAddress: addr, symbol: info.symbol, name: info.name, decimals: 18, rawBalance: '0',
    }));
  }
  return [];
}

// ---- Helpers ----

function formatBlockscoutValue(raw: string | undefined, decimals: number): string {
  if (!raw) return '0';
  const num = parseFloat(raw) / Math.pow(10, decimals);
  return num.toString();
}

function formatWei(wei: string): string {
  return (parseFloat(wei) / 1e18).toString();
}

function formatTokenValue(raw: string, decimals: number): string {
  return (parseFloat(raw) / Math.pow(10, decimals)).toString();
}
