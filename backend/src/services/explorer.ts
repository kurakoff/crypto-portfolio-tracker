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
  feeNative?: number;
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

// ---- Ethereum full tx sync via Blockscout (reliable, keyless) ----
// Blockscout is used as the primary Ethereum transaction source instead of the
// flaky Moralis /erc20/transfers (which returns an inconsistent window). Real
// tokens carry a market price (token.exchange_rate); address-poisoning fakes do
// not — so we keep only priced tokens, which drops the look-alike "USDT" spam.

export interface EthBlockscoutTx {
  hash: string;
  blockNumber: number;
  timestamp: string;
  from: string;
  to: string;
  value: string;         // formatted amount
  tokenSymbol: string;
  tokenAddress: string;  // lowercased, or 'native'
  type: 'send' | 'receive';
  valueUsd: number;      // native filled by caller (needs ETH price)
  feeNative: number;     // ETH; set for native sends
}

export async function getEthereumBlockscoutTxs(address: string): Promise<EthBlockscoutTx[]> {
  const addrL = address.toLowerCase();
  const cacheKey = `blockscout:full:${addrL}`;
  const cached = cache.get<EthBlockscoutTx[]>(cacheKey);
  if (cached) return cached;

  const out: EthBlockscoutTx[] = [];

  // ERC-20 transfers — paginate a few pages; keep only real (priced) tokens.
  let next: Record<string, string> | null = null;
  for (let page = 0; page < 5; page++) {
    const url = next
      ? `https://eth.blockscout.com/api/v2/addresses/${address}/token-transfers?${new URLSearchParams(next)}`
      : `https://eth.blockscout.com/api/v2/addresses/${address}/token-transfers?type=ERC-20`;
    let data: { items?: any[]; next_page_params?: Record<string, string> | null };
    try {
      data = (await (await fetch(url)).json()) as any;
    } catch (err) {
      console.error('[blockscout] token-transfers failed:', err);
      break;
    }
    for (const item of data.items || []) {
      const tok = item.token || {};
      if (tok.exchange_rate == null) continue; // no market price => poisoning fake
      const decimals = parseInt(tok.decimals || '18');
      const amount = parseFloat(item.total?.value || '0') / Math.pow(10, decimals);
      if (!(amount > 0)) continue;
      const from = (item.from?.hash || '');
      out.push({
        hash: (item.transaction_hash || '').toLowerCase(),
        blockNumber: item.block_number || 0,
        timestamp: item.timestamp || '',
        from,
        to: item.to?.hash || '',
        value: String(amount),
        tokenSymbol: tok.symbol || '?',
        tokenAddress: (tok.address_hash || tok.address || '').toLowerCase(),
        type: from.toLowerCase() === addrL ? 'send' : 'receive',
        valueUsd: amount * parseFloat(tok.exchange_rate),
        feeNative: 0,
      });
    }
    if (!data.next_page_params) break;
    next = data.next_page_params;
  }

  // Native ETH transfers (value != 0).
  try {
    const data = (await (await fetch(
      `https://eth.blockscout.com/api/v2/addresses/${address}/transactions?filter=to%7Cfrom`
    )).json()) as { items?: any[] };
    for (const item of data.items || []) {
      if (!item.value || item.value === '0') continue;
      const amount = parseFloat(item.value) / 1e18;
      if (!(amount > 0)) continue;
      const from = (item.from?.hash || '');
      const isSend = from.toLowerCase() === addrL;
      const feeNative = item.fee?.value ? parseFloat(item.fee.value) / 1e18 : 0;
      out.push({
        hash: (item.hash || '').toLowerCase(),
        blockNumber: item.block || item.block_number || 0,
        timestamp: item.timestamp || '',
        from,
        to: item.to?.hash || '',
        value: String(amount),
        tokenSymbol: 'ETH',
        tokenAddress: 'native',
        type: isSend ? 'send' : 'receive',
        valueUsd: 0, // caller multiplies by ETH price
        feeNative: isSend ? feeNative : 0,
      });
    }
  } catch (err) {
    console.error('[blockscout] native tx failed:', err);
  }

  if (out.length > 0) cache.set(cacheKey, out, 60_000);
  return out;
}

// ---- BSC via Etherscan V2 API (requires free API key) ----
// BscScan V1 is deprecated. BSC transactions require Etherscan V2 API key.
// For now, BSC token discovery uses PancakeSwap token list + Multicall.
// BSC transactions are not available without an API key.

// ---- Tron fee lookup ----

export async function getTronTxFees(hashes: string[]): Promise<Map<string, number>> {
  const fees = new Map<string, number>();
  // Batch in groups of 5
  for (let i = 0; i < hashes.length; i += 5) {
    const batch = hashes.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(async (hash) => {
        try {
          const resp = await fetch('https://api.trongrid.io/wallet/gettransactioninfobyid', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: hash }),
          });
          const data = await resp.json() as any;
          // energy_fee is in sun (1 TRX = 1e6 sun), also include net_fee
          const energyFee = data.receipt?.energy_fee || 0;
          const netFee = data.receipt?.net_fee || 0;
          const totalFee = (energyFee + netFee) / 1_000_000;
          return [hash, totalFee] as const;
        } catch {
          return [hash, 0] as const;
        }
      })
    );
    for (const [hash, fee] of results) {
      fees.set(hash, fee);
    }
  }
  return fees;
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
      // Skip non-transfer events (approve, etc.)
      if (tx.type && tx.type !== 'Transfer') continue;

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
  if (chain === 'tron') return getTronTransactions(address);
  // BSC native TXs: not available via free API
  return [];
}

export async function getTokenTransactions(chain: string, address: string): Promise<ExplorerTx[]> {
  if (chain === 'ethereum') return blockscoutTokenTransfers(address);
  if (chain === 'bsc') {
    // BSC token transfers via getLogs (drpc.org)
    const { getBscTransactions } = await import('./bsc-explorer');
    return getBscTransactions(address);
  }
  return [];
}

export async function getTokenBalances(
  chain: string,
  address: string
): Promise<ExplorerTokenBalance[]> {
  if (chain === 'ethereum') return blockscoutTokenList(address);
  // BSC: token discovery via PancakeSwap token list + Multicall (handled in ethereum.ts)
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
