import { cache } from '../cache/memory-cache';
import { config } from '../config/rpc';

const BASE = 'https://deep-index.moralis.io/api/v2.2';

function apiKey(): string {
  return config.moralisApiKey;
}

function headers() {
  return { 'X-API-Key': apiKey(), 'Accept': 'application/json' };
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
    const resp = await fetch(
      `${BASE}/wallets/${address}/tokens?chain=${mc}`,
      { headers: headers() }
    );
    if (!resp.ok) {
      console.error(`[moralis] tokens ${resp.status}: ${await resp.text().catch(() => '')}`);
      return [];
    }
    const data = (await resp.json()) as MoralisWalletTokensResponse;
    const tokens = (data.result || []).filter(t => !t.possible_spam);
    cache.set(cacheKey, tokens, 60_000); // 60s
    return tokens;
  } catch (err) {
    console.error('[moralis] getWalletTokens error:', err);
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
    const resp = await fetch(
      `${BASE}/${address}/erc20/transfers?chain=${mc}&limit=${limit}`,
      { headers: headers() }
    );
    if (!resp.ok) {
      console.error(`[moralis] transfers ${resp.status}`);
      return [];
    }
    const data = (await resp.json()) as { result: MoralisTransfer[] };
    const transfers = (data.result || []).filter(t => !t.possible_spam);
    cache.set(cacheKey, transfers, 60_000);
    return transfers;
  } catch (err) {
    console.error('[moralis] getTokenTransfers error:', err);
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
    const resp = await fetch(
      `${BASE}/${address}?chain=${mc}&limit=${limit}`,
      { headers: headers() }
    );
    if (!resp.ok) return [];
    const data = (await resp.json()) as { result: MoralisNativeTx[] };
    const txs = data.result || [];
    cache.set(cacheKey, txs, 60_000);
    return txs;
  } catch {
    return [];
  }
}

/**
 * Check if Moralis is configured (API key present).
 */
export function isMoralisEnabled(): boolean {
  return !!apiKey();
}

export function isMoralisChain(chain: string): boolean {
  return !!moralisChain(chain);
}
