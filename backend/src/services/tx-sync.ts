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
import { getNativePrice } from './prices';
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
  last_synced_at: string | null;
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

export function getSyncStatus(): SyncStatus {
  return { ...status, failedWallets: [...status.failedWallets] };
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
  currentRun = (async () => {
    status.running = true;
    status.startedAt = new Date().toISOString();
    const t0 = Date.now();
    let synced = 0, failed = 0, skipped = 0;
    const failedWallets: string[] = [];

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
      currentRun = null;
      if (synced + failed > 0) {
        console.log(`[sync] done in ${status.lastRunMs}ms: ${synced} synced, ${failed} failed, ${skipped} not due`);
      }
    }
  })();
  return currentRun;
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
