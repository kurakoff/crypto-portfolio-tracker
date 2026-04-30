import { cache } from '../cache/memory-cache';
import { config } from '../config/rpc';

const BASE = 'https://deep-index.moralis.io/api/v2.2';

// --- API key rotation ---
let currentKeyIndex = 0;

function apiKey(): string {
  const keys = config.moralisApiKeys;
  if (keys.length === 0) return '';
  return keys[currentKeyIndex % keys.length];
}

function rotateKey(): boolean {
  const keys = config.moralisApiKeys;
  if (keys.length <= 1) return false;
  const prev = currentKeyIndex;
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;
  console.log(`[moralis] Rotating API key: ${prev + 1} → ${currentKeyIndex + 1} of ${keys.length}`);
  return true;
}

function headers() {
  return { 'X-API-Key': apiKey(), 'Accept': 'application/json' };
}

/**
 * Fetch with retry: rotates API key on 401/429, retries on 5xx/network errors.
 * keysTried prevents infinite rotation when all keys are exhausted.
 */
async function fetchWithRetry(url: string, retries = 1, keysTried = 0): Promise<globalThis.Response> {
  try {
    const resp = await fetch(url, { headers: headers() });

    // 401/429 — try next API key (but stop after trying all keys)
    if ((resp.status === 401 || resp.status === 429) && keysTried < config.moralisApiKeys.length - 1 && rotateKey()) {
      return fetchWithRetry(url, retries, keysTried + 1);
    }

    // 5xx — retry with delay
    if (retries > 0 && resp.status >= 500) {
      await new Promise(r => setTimeout(r, 2000));
      return fetchWithRetry(url, retries - 1, keysTried);
    }

    return resp;
  } catch (err) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 2000));
      return fetchWithRetry(url, retries - 1, keysTried);
    }
    throw err;
  }
}

// Chain name -> Moralis chain param
const CHAIN_MAP: Record<string, string> = {
  ethereum: 'eth',
  bsc: 'bsc',
};

function moralisChain(chain: string): string | undefined {
  return CHAIN_MAP[chain];
}

// ---- Token Balances with Prices ----

export interface MoralisToken {
  token_address: string;
  symbol: string;
  name: string;
  logo: string | null;
  thumbnail: string | null;
  decimals: number;
  balance: string;
  balance_formatted?: string;
  usd_price?: number | null;
  usd_value?: number | null;
  possible_spam: boolean;
  verified_contract: boolean;
  security_score?: number;
  native_token?: boolean;
}

export interface MoralisWalletTokensResponse {
  result: MoralisToken[];
}

/**
 * Get all ERC-20 tokens with balances and USD prices for a wallet.
 * Uses /wallets/{address}/tokens which includes prices.
 */
export async function getWalletTokens(
  chain: string,
  address: string
): Promise<MoralisToken[]> {
  const mc = moralisChain(chain);
  if (!mc || !apiKey()) return [];

  const cacheKey = `moralis:tokens:${chain}:${address}`;
  const cached = cache.get<MoralisToken[]>(cacheKey);
  if (cached) return cached;

  try {
    const resp = await fetchWithRetry(
      `${BASE}/wallets/${address}/tokens?chain=${mc}`
    );
    if (!resp.ok) {
      console.error(`[moralis] tokens ${resp.status}: ${await resp.text().catch(() => '')}`);
      cache.set(cacheKey, [], 60_000); // cache failure for 60s to avoid spamming
      return [];
    }
    const data = (await resp.json()) as MoralisWalletTokensResponse;
    const tokens = (data.result || []).filter(t => !t.possible_spam);
    cache.set(cacheKey, tokens, 300_000); // 5 min
    return tokens;
  } catch (err) {
    console.error('[moralis] getWalletTokens error:', err);
    cache.set(cacheKey, [], 60_000);
    return [];
  }
}

// ---- Native Balance ----

export async function getNativeBalance(
  chain: string,
  address: string
): Promise<{ balance: string; balanceFormatted: number }> {
  const mc = moralisChain(chain);
  if (!mc || !apiKey()) return { balance: '0', balanceFormatted: 0 };

  const cacheKey = `moralis:native:${chain}:${address}`;
  const cached = cache.get<{ balance: string; balanceFormatted: number }>(cacheKey);
  if (cached) return cached;

  try {
    const resp = await fetch(
      `${BASE}/${address}/balance?chain=${mc}`,
      { headers: headers() }
    );
    if (!resp.ok) return { balance: '0', balanceFormatted: 0 };
    const data = (await resp.json()) as { balance: string };
    const balanceFormatted = parseFloat(data.balance) / 1e18;
    const result = { balance: data.balance, balanceFormatted };
    cache.set(cacheKey, result, 30_000); // 30s
    return result;
  } catch {
    return { balance: '0', balanceFormatted: 0 };
  }
}

// ---- Token Transfers (Transactions) ----

export interface MoralisTransfer {
  transaction_hash: string;
  block_number: string;
  block_timestamp: string;
  from_address: string;
  to_address: string;
  value: string;
  value_decimal: string;
  token_symbol: string;
  address: string; // token address
  possible_spam: boolean;
}

export interface MoralisNativeTx {
  hash: string;
  block_number: string;
  block_timestamp: string;
  from_address: string;
  to_address: string;
  value: string;
  transaction_fee?: string;
}

/**
 * Get ERC-20 token transfers for a wallet.
 */
export async function getTokenTransfers(
  chain: string,
  address: string,
  limit = 100
): Promise<MoralisTransfer[]> {
  const mc = moralisChain(chain);
  if (!mc || !apiKey()) return [];

  const cacheKey = `moralis:transfers:${chain}:${address}`;
  const cached = cache.get<MoralisTransfer[]>(cacheKey);
  if (cached) return cached;

  try {
    const resp = await fetchWithRetry(
      `${BASE}/${address}/erc20/transfers?chain=${mc}&limit=${limit}`
    );
    if (!resp.ok) {
      console.error(`[moralis] transfers ${resp.status}`);
      cache.set(cacheKey, [], 60_000);
      return [];
    }
    const data = (await resp.json()) as { result: MoralisTransfer[] };
    const transfers = (data.result || []).filter(t => !t.possible_spam);
    cache.set(cacheKey, transfers, 300_000); // 5 min
    return transfers;
  } catch (err) {
    console.error('[moralis] getTokenTransfers error:', err);
    cache.set(cacheKey, [], 60_000);
    return [];
  }
}

/**
 * Get native (ETH/BNB) transactions.
 */
export async function getNativeTransfers(
  chain: string,
  address: string,
  limit = 50
): Promise<MoralisNativeTx[]> {
  const mc = moralisChain(chain);
  if (!mc || !apiKey()) return [];

  const cacheKey = `moralis:nativetx:${chain}:${address}`;
  const cached = cache.get<MoralisNativeTx[]>(cacheKey);
  if (cached) return cached;

  try {
    const resp = await fetchWithRetry(
      `${BASE}/${address}?chain=${mc}&limit=${limit}`
    );
    if (!resp.ok) {
      cache.set(cacheKey, [], 60_000);
      return [];
    }
    const data = (await resp.json()) as { result: MoralisNativeTx[] };
    const txs = data.result || [];
    cache.set(cacheKey, txs, 300_000); // 5 min
    return txs;
  } catch {
    cache.set(cacheKey, [], 60_000);
    return [];
  }
}

/**
 * Batch-fetch transaction fees for EVM send txs.
 * Returns Map<hash, feeNative> (in ETH/BNB).
 */
export async function getTransactionFees(
  chain: string,
  hashes: string[]
): Promise<Map<string, number>> {
  const mc = moralisChain(chain);
  const fees = new Map<string, number>();
  if (!mc || !apiKey() || hashes.length === 0) return fees;

  // Batch in groups of 5
  for (let i = 0; i < hashes.length; i += 5) {
    const batch = hashes.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(async (hash) => {
        try {
          const resp = await fetchWithRetry(
            `${BASE}/transaction/${hash}?chain=${mc}`
          );
          if (!resp.ok) return [hash, 0] as const;
          const data = (await resp.json()) as { transaction_fee?: string };
          return [hash, parseFloat(data.transaction_fee || '0')] as const;
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

/**
 * Check if Moralis is configured (API key present).
 */
export function isMoralisEnabled(): boolean {
  return config.moralisApiKeys.length > 0;
}

export function isMoralisChain(chain: string): boolean {
  return !!moralisChain(chain);
}
