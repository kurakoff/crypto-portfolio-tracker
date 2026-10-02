import { cache } from '../cache/memory-cache';
import { config } from '../config/rpc';

/** TronGrid headers: free API key lifts the strict anonymous rate limit. */
function tronHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return config.tronApiKey ? { ...extra, 'TRON-PRO-API-KEY': config.tronApiKey } : extra;
}

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

  // Native ETH transfers (value != 0) + fees of every outgoing tx. A token
  // send is itself a transaction from this address, so its gas fee is in this
  // list too — no need for a per-hash Moralis lookup.
  const outgoingFees = new Map<string, number>();
  try {
    const data = (await (await fetch(
      `https://eth.blockscout.com/api/v2/addresses/${address}/transactions?filter=to%7Cfrom`
    )).json()) as { items?: any[] };
    for (const item of data.items || []) {
      const from = (item.from?.hash || '');
      const isSend = from.toLowerCase() === addrL;
      const feeNative = item.fee?.value ? parseFloat(item.fee.value) / 1e18 : 0;
      if (isSend && feeNative > 0) outgoingFees.set((item.hash || '').toLowerCase(), feeNative);
      if (!item.value || item.value === '0') continue;
      const amount = parseFloat(item.value) / 1e18;
      if (!(amount > 0)) continue;
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

  for (const t of out) {
    if (t.type === 'send' && t.tokenAddress !== 'native' && !t.feeNative) {
      t.feeNative = outgoingFees.get(t.hash) || 0;
    }
  }

  if (out.length > 0) cache.set(cacheKey, out, 60_000);
  return out;
}

/**
 * Ethereum balances via Blockscout (keyless): native balance + priced tokens.
 * Tokens without an exchange_rate are address-poisoning fakes and are dropped.
 */
export interface BlockscoutPortfolio {
  nativeBalance: number;
  nativePriceUsd: number;
  tokens: Array<{ address: string; symbol: string; name: string; decimals: number; balance: string; balanceFormatted: number; priceUsd: number; logoUri?: string }>;
}

export async function getEthereumBlockscoutPortfolio(address: string): Promise<BlockscoutPortfolio> {
  const [addrResp, balResp] = await Promise.all([
    fetch(`https://eth.blockscout.com/api/v2/addresses/${address}`),
    fetch(`https://eth.blockscout.com/api/v2/addresses/${address}/token-balances`),
  ]);
  if (!addrResp.ok) throw new Error(`blockscout address HTTP ${addrResp.status}`);
  if (!balResp.ok) throw new Error(`blockscout token-balances HTTP ${balResp.status}`);
  const addr = (await addrResp.json()) as { coin_balance?: string | null; exchange_rate?: string | null };
  const bals = (await balResp.json()) as any[];

  const tokens: BlockscoutPortfolio['tokens'] = [];
  for (const b of Array.isArray(bals) ? bals : []) {
    const tok = b.token || {};
    if (tok.type !== 'ERC-20' || tok.exchange_rate == null) continue;
    const decimals = parseInt(tok.decimals || '18', 10) || 18;
    const raw = b.value || '0';
    const formatted = parseFloat(raw) / Math.pow(10, decimals);
    if (!(formatted > 0)) continue;
    tokens.push({
      address: (tok.address_hash || tok.address || '').toLowerCase(),
      symbol: tok.symbol || '?',
      name: tok.name || '',
      decimals,
      balance: raw,
      balanceFormatted: formatted,
      priceUsd: parseFloat(tok.exchange_rate) || 0,
      logoUri: tok.icon_url || undefined,
    });
  }
  return {
    nativeBalance: parseFloat(addr.coin_balance || '0') / 1e18,
    nativePriceUsd: parseFloat(addr.exchange_rate || '0') || 0,
    tokens,
  };
}

/** Per-hash fee lookup on Blockscout (keyless) for txs missing from the address list. */
export async function getEthBlockscoutTxFees(hashes: string[]): Promise<Map<string, number>> {
  const fees = new Map<string, number>();
  for (let i = 0; i < hashes.length; i += 5) {
    const batch = hashes.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(async (hash) => {
        try {
          const resp = await fetch(`https://eth.blockscout.com/api/v2/transactions/${hash}`);
          if (!resp.ok) return [hash, 0] as const;
          const data = (await resp.json()) as { fee?: { value?: string } };
          return [hash, data.fee?.value ? parseFloat(data.fee.value) / 1e18 : 0] as const;
        } catch {
          return [hash, 0] as const;
        }
      })
    );
    for (const [hash, fee] of results) if (fee > 0) fees.set(hash, fee);
  }
  return fees;
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
          const resp = await fetch(`${config.tronApiUrl}/wallet/gettransactioninfobyid`, {
            method: 'POST',
            headers: tronHeaders({ 'Content-Type': 'application/json' }),
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

/** TronGrid list call. Returns null on HTTP error / rate limit so callers can
 *  tell "failed" apart from "no transactions". */
async function tronGridList(url: string, what: string): Promise<any[] | null> {
  try {
    const resp = await fetch(url, { headers: tronHeaders() });
    if (!resp.ok) {
      console.error(`[trongrid] ${what} HTTP ${resp.status}`);
      return null;
    }
    const data = (await resp.json()) as { success?: boolean; error?: string; data?: any[] };
    if (data.success === false || data.error) {
      console.error(`[trongrid] ${what} error: ${data.error || 'success=false'}`);
      return null;
    }
    return data.data || [];
  } catch (err) {
    console.error(`[trongrid] ${what} failed:`, err);
    return null;
  }
}

/** Returns null when TronGrid could not be read (nothing is cached then). */
export async function getTronTransactions(address: string): Promise<ExplorerTx[] | null> {
  const cacheKey = `explorer:tron:${address}`;
  const cached = cache.get<ExplorerTx[]>(cacheKey);
  if (cached) return cached;

  const [native, trc20] = await Promise.all([
    tronGridList(`${config.tronApiUrl}/v1/accounts/${address}/transactions?limit=50`, `native ${address.slice(0, 8)}`),
    tronGridList(`${config.tronApiUrl}/v1/accounts/${address}/transactions/trc20?limit=50`, `trc20 ${address.slice(0, 8)}`),
  ]);
  if (native === null || trc20 === null) return null;

  const txs: ExplorerTx[] = [];

  for (const tx of native) {
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

  for (const tx of trc20) {
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

  cache.set(cacheKey, txs, 60_000);
  return txs;
}

// ---- Unified public API ----

export async function getNativeTransactions(chain: string, address: string): Promise<ExplorerTx[]> {
  if (chain === 'ethereum') return blockscoutNativeTransfers(address);
  if (chain === 'tron') return (await getTronTransactions(address)) || [];
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
