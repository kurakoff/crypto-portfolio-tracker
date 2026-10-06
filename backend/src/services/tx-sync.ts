/**
 * Transaction sync: pulls transfers for every wallet from the chain explorers
 * into the local DB. Runs in the background on a timer (see startBackgroundSync),
 * so API requests read from the DB and never wait on upstream APIs.
 */
import db from '../db/client';
import {
  getNativeTransactions,
  getTokenTransactions,
  getTronTransactions,
  getTronTxFees,
  getEthereumBlockscoutTxs,
  getEthBlockscoutTxFees,
} from './explorer';
import { getNativePrice, getTokenPrices } from './prices';
import { getDexScreenerPrices } from './dexscreener';
import {
  isNodeRealEnabled,
  isNodeRealChain,
  detectActivity,
  getAssetTransfers,
  getTokenHoldings,
  secondsPerBlock,
  type ActivityState,
} from './nodereal';
import { saveSnapshot, loadSnapshot } from './snapshots';
import type { WalletPortfolio } from '../routes/portfolio';
import {
  isMoralisEnabled,
  isMoralisChain,
  getTokenTransfers,
  getNativeTransfers,
  getWalletTokens,
  getTransactionFees,
  getWalletHistory,
} from './moralis';

export interface Wallet {
  id: number;
  address: string;
  chain: string;
  label: string | null;
  last_synced_at?: string | null;
}

/** How often a wallet is re-synced. Moralis chains are slower to keep API credits in check. */
const SYNC_INTERVAL_MS: Record<string, number> = {
  tron: 2 * 60 * 1000,
  ethereum: 2 * 60 * 1000,
  bsc: 5 * 60 * 1000,
  arbitrum: 5 * 60 * 1000,
  solana: 10 * 60 * 1000,
};
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
/** After a failed sync, retry sooner than the regular interval. */
const RETRY_AFTER_FAIL_MS = 60 * 1000;
/** Background tick: checks which wallets are due. */
const TICK_MS = 60 * 1000;

export const NATIVE_SYMBOLS: Record<string, string> = {
  ethereum: 'ETH',
  bsc: 'BNB',
  arbitrum: 'ETH',
  tron: 'TRX',
  solana: 'SOL',
};

export const NATIVE_COIN_IDS: Record<string, string> = {
  ethereum: 'ethereum',
  bsc: 'binancecoin',
  arbitrum: 'ethereum',
  tron: 'tron',
  solana: 'solana',
};

// ---- run state (exposed via /api/transactions/sync-status) ----

export interface SyncStatus {
  running: boolean;
  startedAt: string | null;
  lastRunAt: string | null;
  lastRunMs: number;
  lastSynced: number;
  lastFailed: number;
  lastSkipped: number;
  failedWallets: string[];
}

const status: SyncStatus = {
  running: false,
  startedAt: null,
  lastRunAt: null,
  lastRunMs: 0,
  lastSynced: 0,
  lastFailed: 0,
  lastSkipped: 0,
  failedWallets: [],
};

const lastFailedAt = new Map<number, number>();
let currentRun: Promise<void> | null = null;

/** Ring buffer of recent runs so "when did X stop updating" can be answered. */
export interface SyncRunRecord {
  at: string;
  ms: number;
  forced: boolean;
  synced: number;
  failed: number;
  skipped: number;
  newTxs: Record<string, number>;   // chain -> rows inserted
  failedWallets: string[];
}
const history: SyncRunRecord[] = [];
const HISTORY_MAX = 300; // ~5h at one tick per minute
let runNewTxs: Record<string, number> = {};

export function getSyncStatus(): SyncStatus {
  return { ...status, failedWallets: [...status.failedWallets] };
}

export function getSyncHistory(): SyncRunRecord[] {
  return history.slice().reverse();
}

function isDue(wallet: Wallet, now: number): boolean {
  const failedAt = lastFailedAt.get(wallet.id);
  if (failedAt) return now - failedAt >= RETRY_AFTER_FAIL_MS;
  if (!wallet.last_synced_at) return true;
  const interval = SYNC_INTERVAL_MS[wallet.chain] ?? DEFAULT_INTERVAL_MS;
  return now - new Date(wallet.last_synced_at + 'Z').getTime() >= interval;
}

/**
 * Sync every wallet that is due (or all of them when force=true).
 * Concurrent calls join the run already in progress.
 */
export function syncAllWallets(force = false): Promise<void> {
  if (currentRun) return currentRun;
  const run = (async () => {
    status.running = true;
    status.startedAt = new Date().toISOString();
    const t0 = Date.now();
    let synced = 0, failed = 0, skipped = 0;
    const failedWallets: string[] = [];
    runNewTxs = {};

    try {
      const wallets = db.prepare('SELECT * FROM wallets').all() as Wallet[];
      // Two failures in a row on one chain usually mean a rate limit / outage:
      // skip the rest of that chain this run instead of hammering the API.
      const chainFailStreak = new Map<string, number>();
      for (const wallet of wallets) {
        if (!force && !isDue(wallet, Date.now())) { skipped++; continue; }
        if ((chainFailStreak.get(wallet.chain) || 0) >= 2) { skipped++; continue; }
        const ok = await syncWalletTransactions(wallet);
        if (ok) {
          synced++;
          chainFailStreak.set(wallet.chain, 0);
        } else {
          failed++;
          failedWallets.push(`${wallet.chain}:${wallet.address.slice(0, 10)}`);
          chainFailStreak.set(wallet.chain, (chainFailStreak.get(wallet.chain) || 0) + 1);
          if (chainFailStreak.get(wallet.chain) === 2) console.warn(`[sync] ${wallet.chain}: 2 failures in a row, skipping the rest of this chain until next tick`);
        }
      }
    } catch (err) {
      console.error('[sync] run crashed:', err);
    } finally {
      status.running = false;
      status.lastRunAt = new Date().toISOString();
      status.lastRunMs = Date.now() - t0;
      status.lastSynced = synced;
      status.lastFailed = failed;
      status.lastSkipped = skipped;
      status.failedWallets = failedWallets;
      if (synced + failed > 0) {
        console.log(`[sync] done in ${status.lastRunMs}ms: ${synced} synced, ${failed} failed, ${skipped} not due`);
      }
    }
  })();
  // Clear the slot from a .finally on the outer promise, not inside the run:
  // when every wallet is skipped the run never awaits, so its own finally would
  // execute before `currentRun` is assigned and leave a settled promise in it
  // forever, silently stopping all future syncs.
  currentRun = run;
  void run.finally(() => { if (currentRun === run) currentRun = null; });
  return run;
}

/** Kick off the periodic background sync. Call once at startup. */
export function startBackgroundSync(): void {
  // First pass shortly after boot so a fresh deploy catches up quickly.
  setTimeout(() => { void syncAllWallets(false); }, 3_000);
  setInterval(() => { void syncAllWallets(false); }, TICK_MS);
  console.log(`[sync] background sync started (tick ${TICK_MS / 1000}s)`);
}

/**
 * Sync one wallet now, regardless of schedule. Returns true on success.
 * last_synced_at is only advanced on success so failures retry soon.
 */
export async function syncWalletTransactions(wallet: Wallet): Promise<boolean> {
  let ok = false;
  try {
    if (wallet.chain === 'ethereum') {
      ok = await syncEthereumTransactions(wallet);
    } else if (isNodeRealEnabled() && isNodeRealChain(wallet.chain)) {
      ok = await syncNodeRealTransactions(wallet);
    } else if (isMoralisEnabled() && isMoralisChain(wallet.chain)) {
      ok = await syncMoralisTransactions(wallet);
    } else {
      ok = await syncLegacyTransactions(wallet);
    }
  } catch (err) {
    console.error(`[sync] ${wallet.chain} ${wallet.address.slice(0, 10)} crashed:`, err);
    ok = false;
  }

  if (ok) {
    lastFailedAt.delete(wallet.id);
    db.prepare("UPDATE wallets SET last_synced_at = datetime('now') WHERE id = ?").run(wallet.id);
  } else {
    lastFailedAt.set(wallet.id, Date.now());
    console.warn(`[sync] ${wallet.chain} ${wallet.address.slice(0, 10)} failed, retry in ${RETRY_AFTER_FAIL_MS / 1000}s`);
  }
  return ok;
}

// ---- per-source sync ----

interface TxRecord {
  hash: string;
  blockNumber: number;
  timestamp: string;
  from: string;
  to: string;
  value: string;
  tokenSymbol: string;
  tokenAddress: string;
  type: string;
  valueUsd: number;
  feeNative: number;
  feeUsd: number;
}

/** Return set of tx hashes that already have fee_native > 0 in DB for this wallet */
function getExistingFeeHashes(walletId: number): Set<string> {
  const rows = db.prepare(
    'SELECT hash FROM transactions WHERE wallet_id = ? AND fee_native > 0'
  ).all(walletId) as { hash: string }[];
  return new Set(rows.map(r => r.hash));
}

/**
 * Rows that got fee_native but fee_usd = 0 (price lookup failed during that
 * sync) are never re-fetched, so fill in the USD value from the current price.
 */
export function repairMissingFeeUsd(walletId: number, nativePrice: number): void {
  if (!(nativePrice > 0)) return;
  const r = db.prepare(
    'UPDATE transactions SET fee_usd = fee_native * ? WHERE wallet_id = ? AND fee_native > 0 AND fee_usd = 0'
  ).run(nativePrice, walletId);
  if (r.changes > 0) console.log(`[fees] Filled fee_usd for ${r.changes} tx(s) of wallet ${walletId}`);
}

/**
 * Build a price map from Moralis wallet tokens (current prices).
 * Returns { tokenAddress -> usdPrice, 'native' -> nativePrice }
 */
async function getMoralisPrices(chain: string, address: string): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};

  const tokens = await getWalletTokens(chain, address);
  for (const t of tokens) {
    if (t.native_token) {
      prices['native'] = t.usd_price || 0;
    } else if (t.usd_price) {
      prices[t.token_address.toLowerCase()] = t.usd_price;
    }
  }

  if (!prices['native']) {
    const coinId = NATIVE_COIN_IDS[chain];
    if (coinId) prices['native'] = await getNativePrice(coinId);
  }

  return prices;
}

async function syncEthereumTransactions(wallet: Wallet): Promise<boolean> {
  const txs = await getEthereumBlockscoutTxs(wallet.address);

  // If Blockscout returned nothing, fall back to Moralis so we never regress.
  if (txs.length === 0) {
    return syncMoralisTransactions(wallet);
  }

  const ethPrice = await getNativePrice('ethereum');

  for (const t of txs) {
    if (t.tokenAddress === 'native') t.valueUsd = parseFloat(t.value) * ethPrice;
  }

  // Fees for token sends: most come with the Blockscout address tx list already
  // (t.feeNative). For the rest look them up per hash on Blockscout, then
  // Moralis as a last resort. Only for new hashes.
  const knownFees = getExistingFeeHashes(wallet.id);
  const missing = txs
    .filter(t => t.type === 'send' && t.tokenAddress !== 'native' && !t.feeNative && !knownFees.has(t.hash))
    .map(t => t.hash);
  const feeMap = missing.length > 0
    ? await getEthBlockscoutTxFees(missing)
    : new Map<string, number>();
  const stillMissing = missing.filter(h => !feeMap.has(h));
  if (stillMissing.length > 0) {
    for (const [h, fee] of await getTransactionFees('ethereum', stillMissing)) {
      if (fee > 0) feeMap.set(h, fee);
    }
  }

  const records: TxRecord[] = txs.map(t => {
    const feeNative = t.feeNative || feeMap.get(t.hash) || 0;
    return {
      hash: t.hash,
      blockNumber: t.blockNumber,
      timestamp: t.timestamp,
      from: t.from,
      to: t.to,
      value: t.value,
      tokenSymbol: t.tokenSymbol,
      tokenAddress: t.tokenAddress,
      type: t.type,
      valueUsd: t.valueUsd,
      feeNative,
      feeUsd: feeNative * ethPrice,
    };
  });

  console.log(`[blockscout:eth] Syncing ${records.length} txs for ${wallet.address.slice(0, 8)}...`);
  insertTransactions(wallet.id, records);
  repairMissingFeeUsd(wallet.id, ethPrice);
  return true;
}

// ---- NodeReal (BSC) ----

const COINGECKO_PLATFORMS: Record<string, string> = { ethereum: 'ethereum', bsc: 'binance-smart-chain' };
/** Real stablecoin contracts: always priced at $1 even if the price APIs are down. */
const STABLE_CONTRACTS: Record<string, Set<string>> = {
  bsc: new Set([
    '0x55d398326f99059ff775485246999027b3197955', // USDT
    '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC
    '0xe9e7cea3dedca5984780bafc599bd69add087d56', // BUSD
    '0xc5f0f7b66764f6ec8c8dff7ba683102295e16409', // FDUSD
    '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3', // DAI
    '0x14016e85a25aeb13065688cafb43044c2ef86784', // TUSD
  ]),
  ethereum: new Set([
    '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
    '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
  ]),
};

const activityState = new Map<number, ActivityState>();
const holdingsRefreshedAt = new Map<number, number>();
const HOLDINGS_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Prices for a set of token contracts: stable list → CoinGecko → DexScreener. */
async function getTokenPriceMap(chain: string, addresses: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  const stables = STABLE_CONTRACTS[chain] || new Set<string>();
  const unknown: string[] = [];
  for (const a of addresses) {
    if (stables.has(a)) prices[a] = 1;
    else unknown.push(a);
  }
  if (unknown.length > 0) {
    const platform = COINGECKO_PLATFORMS[chain];
    const cg = platform ? await getTokenPrices(platform, unknown) : {};
    const still: string[] = [];
    for (const a of unknown) {
      if (cg[a] > 0) prices[a] = cg[a];
      else still.push(a);
    }
    if (still.length > 0) {
      const dex = await getDexScreenerPrices(chain, still);
      for (const a of still) if (dex[a] > 0) prices[a] = dex[a];
    }
  }
  return prices;
}

/**
 * Refresh a wallet's balances via NodeReal and store them as the portfolio
 * snapshot the portfolio route serves. Called only when activity was detected
 * or the snapshot is older than HOLDINGS_MAX_AGE_MS (300 CU per call).
 */
export async function refreshNodeRealHoldings(wallet: Wallet, nativePrice?: number): Promise<WalletPortfolio> {
  const holdings = await getTokenHoldings(wallet.chain, wallet.address);
  const price = nativePrice ?? await getNativePrice(NATIVE_COIN_IDS[wallet.chain]);
  const prices = await getTokenPriceMap(wallet.chain, holdings.tokens.map(t => t.address));
  const nativeSymbol = NATIVE_SYMBOLS[wallet.chain] || '?';

  const tokens: WalletPortfolio['tokens'] = [{
    address: 'native',
    symbol: nativeSymbol,
    name: nativeSymbol,
    decimals: 18,
    balance: (BigInt(Math.round(holdings.nativeBalance * 1e6)) * 10n ** 12n).toString(),
    balanceFormatted: holdings.nativeBalance,
    priceUsd: price,
    valueUsd: holdings.nativeBalance * price,
  }];
  for (const t of holdings.tokens) {
    const p = prices[t.address] || 0;
    tokens.push({
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      balance: t.balanceRaw,
      balanceFormatted: t.balance,
      priceUsd: p,
      valueUsd: t.balance * p,
    });
  }
  // Priced tokens first, unpriced (mostly spam airdrops) last.
  tokens.sort((a, b) => (b.valueUsd - a.valueUsd) || (b.priceUsd > 0 ? 1 : 0) - (a.priceUsd > 0 ? 1 : 0));

  const portfolio: WalletPortfolio = {
    wallet: { id: wallet.id, address: wallet.address, chain: wallet.chain, label: wallet.label },
    nativeBalance: holdings.nativeBalance,
    tokens,
    nfts: [],
    totalValueUsd: tokens.reduce((s, t) => s + t.valueUsd, 0),
  };
  saveSnapshot(wallet.id, portfolio);
  holdingsRefreshedAt.set(wallet.id, Date.now());
  console.log(`[nodereal:${wallet.chain}] ${wallet.address.slice(0, 8)}... balances: ${tokens.length} tokens, $${portfolio.totalValueUsd.toFixed(2)}`);
  return portfolio;
}

async function syncNodeRealTransactions(wallet: Wallet): Promise<boolean> {
  const prev = activityState.get(wallet.id);
  const { changed, state } = await detectActivity(wallet.chain, wallet.address, prev);
  activityState.set(wallet.id, state);

  const snapshotAge = (() => {
    const at = holdingsRefreshedAt.get(wallet.id);
    if (at) return Date.now() - at;
    const snap = loadSnapshot(wallet.id);
    return snap ? Date.now() - new Date(snap.createdAt + 'Z').getTime() : Infinity;
  })();
  const firstRun = !prev;

  if (!changed && !firstRun) {
    if (snapshotAge > HOLDINGS_MAX_AGE_MS) await refreshNodeRealHoldings(wallet);
    return true; // nothing new on chain; no expensive calls spent
  }

  // Something happened: pull transfers since the last checked block (with a
  // little overlap). First run after boot: back to the newest tx we already
  // have (minus a day), or 60 days if the wallet has none.
  const head = state.lastBlock;
  let fromBlock: number;
  if (prev) {
    fromBlock = prev.lastBlock - 200;
  } else {
    const latest = db.prepare(
      'SELECT MAX(timestamp) AS ts FROM transactions WHERE wallet_id = ?'
    ).get(wallet.id) as { ts: string | null };
    const sinceMs = latest.ts
      ? new Date(latest.ts).getTime() - 24 * 60 * 60 * 1000
      : Date.now() - 60 * 24 * 60 * 60 * 1000;
    const spb = await secondsPerBlock(wallet.chain, head);
    const ageSec = Math.max(0, (Date.now() - sinceMs) / 1000);
    fromBlock = Math.max(0, head - Math.ceil(ageSec / spb));
  }
  const transfers = await getAssetTransfers(wallet.chain, wallet.address, fromBlock, head);

  const nativePrice = await getNativePrice(NATIVE_COIN_IDS[wallet.chain]);
  const contracts = [...new Set(transfers.filter(t => t.contractAddress !== 'native').map(t => t.contractAddress))];
  const prices = await getTokenPriceMap(wallet.chain, contracts);
  const addr = wallet.address.toLowerCase();
  const nativeSymbol = NATIVE_SYMBOLS[wallet.chain] || '?';

  const records: TxRecord[] = [];
  let dropped = 0, dust = 0;
  for (const t of transfers) {
    if (!(t.amount > 0)) continue;
    const isNative = t.contractAddress === 'native';
    const price = isNative ? nativePrice : (prices[t.contractAddress] || 0);
    if (!isNative && !(price > 0)) { dropped++; continue; } // unpriced token => airdrop spam / poisoning fake
    if (price > 0 && t.amount * price < 0.01) { dust++; continue; } // dust transfers from address poisoners
    const isSend = t.from === addr;
    const feeNative = isSend ? t.feeNative : 0;
    records.push({
      hash: t.hash,
      blockNumber: t.blockNumber,
      timestamp: t.timestamp,
      from: t.from,
      to: t.to,
      value: String(t.amount),
      tokenSymbol: isNative ? nativeSymbol : t.symbol,
      tokenAddress: t.contractAddress,
      type: isSend ? 'send' : 'receive',
      valueUsd: t.amount * price,
      feeNative,
      feeUsd: feeNative * nativePrice,
    });
  }

  console.log(`[nodereal:${wallet.chain}] ${wallet.address.slice(0, 8)}... ${records.length} txs (dropped ${dropped} unpriced, ${dust} dust)`);
  if (records.length > 0) insertTransactions(wallet.id, records);
  repairMissingFeeUsd(wallet.id, nativePrice);

  await refreshNodeRealHoldings(wallet, nativePrice);
  return true;
}

async function syncMoralisTransactions(wallet: Wallet): Promise<boolean> {
  const [tokenTxs, nativeTxs, prices] = await Promise.all([
    getTokenTransfers(wallet.chain, wallet.address),
    getNativeTransfers(wallet.chain, wallet.address),
    getMoralisPrices(wallet.chain, wallet.address),
  ]);

  // Upstream failure (rate limit, 5xx): report it so the wallet retries soon.
  if (tokenTxs === null || nativeTxs === null) return false;

  const nativePrice = prices['native'] || 0;
  const nativeSymbol = NATIVE_SYMBOLS[wallet.chain] || '?';
  const knownFees = getExistingFeeHashes(wallet.id);

  const sendTokenHashes = tokenTxs
    .filter(tx => tx.to_address.toLowerCase() !== wallet.address.toLowerCase())
    .map(tx => tx.transaction_hash)
    .filter(h => !knownFees.has(h));

  const tokenFeeMap = sendTokenHashes.length > 0
    ? await getTransactionFees(wallet.chain, sendTokenHashes)
    : new Map<string, number>();

  const allTxs: TxRecord[] = [];

  for (const tx of tokenTxs) {
    const isReceive = tx.to_address.toLowerCase() === wallet.address.toLowerCase();
    const valueDecimal = tx.value_decimal || '0';
    const amount = parseFloat(valueDecimal) || 0;
    const price = prices[tx.address.toLowerCase()] || 0;
    const feeNative = isReceive ? 0 : (tokenFeeMap.get(tx.transaction_hash) || 0);

    allTxs.push({
      hash: tx.transaction_hash,
      blockNumber: parseInt(tx.block_number) || 0,
      timestamp: tx.block_timestamp || '',
      from: tx.from_address,
      to: tx.to_address,
      value: valueDecimal,
      tokenSymbol: tx.token_symbol || '?',
      tokenAddress: tx.address,
      type: isReceive ? 'receive' : 'send',
      valueUsd: amount * price,
      feeNative,
      feeUsd: feeNative * nativePrice,
    });
  }

  for (const tx of nativeTxs) {
    if (tx.value === '0') continue;
    const isReceive = tx.to_address.toLowerCase() === wallet.address.toLowerCase();
    const valueFormatted = parseFloat(tx.value) / 1e18;
    const feeNative = isReceive ? 0 : parseFloat(tx.transaction_fee || '0');

    allTxs.push({
      hash: tx.hash,
      blockNumber: parseInt(tx.block_number) || 0,
      timestamp: tx.block_timestamp || '',
      from: tx.from_address,
      to: tx.to_address,
      value: valueFormatted.toString(),
      tokenSymbol: nativeSymbol,
      tokenAddress: 'native',
      type: isReceive ? 'receive' : 'send',
      valueUsd: valueFormatted * nativePrice,
      feeNative,
      feeUsd: feeNative * nativePrice,
    });
  }

  // Fallback: the legacy /erc20/transfers + native endpoints return nothing for
  // some wallets/chains (e.g. Arbitrum) even when transfers exist. Only when we
  // got zero txs above, pull them from the unified /history endpoint.
  if (allTxs.length === 0) {
    const addr = wallet.address.toLowerCase();
    const STABLES = new Set(['USDT', 'USDC', 'BUSD', 'TUSD', 'DAI', 'USDJ', 'FDUSD', 'PYUSD']);
    const history = await getWalletHistory(wallet.chain, wallet.address);
    if (history === null) return false;

    for (const item of history) {
      const fee = parseFloat(item.transaction_fee || '0');
      const blockNumber = parseInt(item.block_number) || 0;
      const ts = item.block_timestamp || '';

      for (const t of item.erc20_transfers || []) {
        if (t.possible_spam) continue;
        const isReceive = t.direction === 'receive' || (t.to_address || '').toLowerCase() === addr;
        const amount = parseFloat(t.value_formatted || '0');
        const tokenAddr = (t.address || '').toLowerCase();
        const price = prices[tokenAddr] || (STABLES.has((t.token_symbol || '').toUpperCase()) ? 1 : 0);
        const feeNative = isReceive ? 0 : fee;

        allTxs.push({
          hash: item.hash,
          blockNumber,
          timestamp: ts,
          from: t.from_address,
          to: t.to_address,
          value: t.value_formatted || '0',
          tokenSymbol: t.token_symbol || '?',
          tokenAddress: t.address || '',
          type: isReceive ? 'receive' : 'send',
          valueUsd: amount * price,
          feeNative,
          feeUsd: feeNative * nativePrice,
        });
      }

      for (const t of item.native_transfers || []) {
        const amount = parseFloat(t.value_formatted || '0');
        if (amount === 0) continue;
        const isReceive = t.direction === 'receive' || (t.to_address || '').toLowerCase() === addr;
        const feeNative = isReceive ? 0 : fee;

        allTxs.push({
          hash: item.hash,
          blockNumber,
          timestamp: ts,
          from: t.from_address,
          to: t.to_address,
          value: t.value_formatted || '0',
          tokenSymbol: nativeSymbol,
          tokenAddress: 'native',
          type: isReceive ? 'receive' : 'send',
          valueUsd: amount * nativePrice,
          feeNative,
          feeUsd: feeNative * nativePrice,
        });
      }
    }
  }

  repairMissingFeeUsd(wallet.id, nativePrice);
  if (allTxs.length === 0) return true;

  console.log(`[moralis:${wallet.chain}] Syncing ${allTxs.length} txs for ${wallet.address.slice(0, 8)}...`);
  insertTransactions(wallet.id, allTxs);
  return true;
}

async function syncLegacyTransactions(wallet: Wallet): Promise<boolean> {
  let allExplorerTxs: import('./explorer').ExplorerTx[] = [];

  if (wallet.chain === 'ethereum' || wallet.chain === 'bsc' || wallet.chain === 'arbitrum') {
    const [native, tokens] = await Promise.all([
      getNativeTransactions(wallet.chain, wallet.address),
      getTokenTransactions(wallet.chain, wallet.address),
    ]);
    allExplorerTxs = [...native, ...tokens];
  } else if (wallet.chain === 'tron') {
    const txs = await getTronTransactions(wallet.address);
    if (txs === null) return false; // TronGrid failed / rate-limited
    allExplorerTxs = txs;
  } else {
    return true; // unsupported chain (solana): nothing to sync
  }

  let nativePrice = 0;
  if (wallet.chain === 'tron') {
    const coinId = NATIVE_COIN_IDS[wallet.chain];
    if (coinId) nativePrice = await getNativePrice(coinId);
    repairMissingFeeUsd(wallet.id, nativePrice);
  }

  if (allExplorerTxs.length === 0) return true;

  if (wallet.chain === 'tron') {
    const knownFees = getExistingFeeHashes(wallet.id);
    const newSendHashes = allExplorerTxs
      .filter(tx => tx.type === 'send' && !knownFees.has(tx.hash))
      .map(tx => tx.hash);

    if (newSendHashes.length > 0) {
      const feeMap = await getTronTxFees(newSendHashes);
      for (const tx of allExplorerTxs) {
        if (tx.type === 'send' && feeMap.has(tx.hash)) {
          tx.feeNative = feeMap.get(tx.hash);
        }
      }
    }
  }

  const STABLECOIN_RE = /^(usdt|usdc|busd|tusd|dai|fdusd|pyusd)$/i;
  const records: TxRecord[] = allExplorerTxs.map(tx => {
    const feeNative = tx.feeNative || 0;
    return {
      ...tx,
      valueUsd: STABLECOIN_RE.test(tx.tokenSymbol) ? parseFloat(tx.value || '0') : 0,
      feeNative,
      feeUsd: feeNative * nativePrice,
    };
  });

  insertTransactions(wallet.id, records);
  return true;
}

function insertTransactions(walletId: number, txs: TxRecord[]): void {
  const insert = db.prepare(`
    INSERT INTO transactions
      (wallet_id, hash, block_number, timestamp, from_address, to_address, value, token_symbol, token_address, type, value_usd, fee_native, fee_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(wallet_id, hash, token_address) DO UPDATE SET
      value_usd = CASE WHEN excluded.value_usd > 0 AND transactions.value_usd = 0 THEN excluded.value_usd ELSE transactions.value_usd END,
      fee_native = CASE WHEN excluded.fee_native > 0 AND transactions.fee_native = 0 THEN excluded.fee_native ELSE transactions.fee_native END,
      fee_usd = CASE WHEN excluded.fee_usd > 0 AND transactions.fee_usd = 0 THEN excluded.fee_usd ELSE transactions.fee_usd END
  `);

  const batchInsert = db.transaction((records: TxRecord[]) => {
    for (const tx of records) {
      insert.run(
        walletId, tx.hash, tx.blockNumber, tx.timestamp, tx.from, tx.to, tx.value,
        tx.tokenSymbol, tx.tokenAddress, tx.type, tx.valueUsd, tx.feeNative, tx.feeUsd,
      );
    }
  });

  batchInsert(txs);
}
