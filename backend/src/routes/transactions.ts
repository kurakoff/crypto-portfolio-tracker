import { Router, Request, Response } from 'express';
import db from '../db/client';
import { getNativeTransactions, getTokenTransactions, getTronTransactions, getTronTxFees } from '../services/explorer';
import { getNativePrice } from '../services/prices';
import {
  isMoralisEnabled,
  isMoralisChain,
  getTokenTransfers,
  getNativeTransfers,
  getWalletTokens,
  getTransactionFees,
} from '../services/moralis';

const router = Router();

interface Wallet {
  id: number;
  address: string;
  chain: string;
  label: string | null;
  last_synced_at: string | null;
}

const SYNC_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

const NATIVE_SYMBOLS: Record<string, string> = {
  ethereum: 'ETH',
  bsc: 'BNB',
  tron: 'TRX',
  solana: 'SOL',
};

const NATIVE_COIN_IDS: Record<string, string> = {
  ethereum: 'ethereum',
  bsc: 'binancecoin',
  tron: 'tron',
  solana: 'solana',
};

// GET /api/transactions/address-labels — all address labels
router.get('/address-labels', (_req: Request, res: Response) => {
  const rows = db.prepare('SELECT chain, address, label FROM address_labels').all();
  res.json(rows);
});

// PUT /api/transactions/address-labels — set label for address
router.put('/address-labels', (req: Request, res: Response) => {
  const { chain, address, label } = req.body;
  if (!chain || !address) {
    res.status(400).json({ error: 'chain and address required' });
    return;
  }
  if (!label || !label.trim()) {
    db.prepare('DELETE FROM address_labels WHERE chain = ? AND address = ?').run(chain, address);
  } else {
    db.prepare('INSERT INTO address_labels (chain, address, label) VALUES (?, ?, ?) ON CONFLICT(chain, address) DO UPDATE SET label = excluded.label')
      .run(chain, address, label.trim());
  }
  res.json({ ok: true });
});

// POST /api/transactions/backfill-fees — one-time backfill fees for last 30 days
router.post('/backfill-fees', async (_req: Request, res: Response) => {
  try {
    const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const rows = db.prepare(`
      SELECT t.id, t.hash, w.chain
      FROM transactions t
      JOIN wallets w ON t.wallet_id = w.id
      WHERE t.type = 'send'
        AND (t.fee_native IS NULL OR t.fee_native = 0)
        AND t.timestamp >= ?
      ORDER BY t.timestamp DESC
    `).all(oneMonthAgo) as { id: number; hash: string; chain: string }[];

    if (rows.length === 0) {
      res.json({ message: 'No transactions to backfill', updated: 0 });
      return;
    }

    // Get native prices
    const prices: Record<string, number> = {};
    for (const coinId of ['ethereum', 'binancecoin', 'tron']) {
      prices[coinId] = await getNativePrice(coinId);
    }

    const update = db.prepare('UPDATE transactions SET fee_native = ?, fee_usd = ? WHERE id = ?');
    let updated = 0;

    // Group by chain
    const tronHashes = rows.filter(r => r.chain === 'tron');
    const evmRows = rows.filter(r => r.chain === 'ethereum' || r.chain === 'bsc');

    // TRON: batch via getTronTxFees
    if (tronHashes.length > 0) {
      const hashes = tronHashes.map(r => r.hash);
      const feeMap = await getTronTxFees(hashes);
      const trxPrice = prices['tron'] || 0;
      for (const row of tronHashes) {
        const fee = feeMap.get(row.hash) || 0;
        if (fee > 0) {
          update.run(fee, fee * trxPrice, row.id);
          updated++;
        }
      }
    }

    // EVM: batch via getTransactionFees (Moralis)
    for (const chain of ['ethereum', 'bsc'] as const) {
      const chainRows = evmRows.filter(r => r.chain === chain);
      if (chainRows.length === 0) continue;
      const hashes = chainRows.map(r => r.hash);
      const feeMap = await getTransactionFees(chain, hashes);
      const coinId = NATIVE_COIN_IDS[chain];
      const nativePrice = prices[coinId] || 0;
      for (const row of chainRows) {
        const fee = feeMap.get(row.hash) || 0;
        if (fee > 0) {
          update.run(fee, fee * nativePrice, row.id);
          updated++;
        }
      }
    }

    res.json({ message: 'Backfill complete', total: rows.length, updated, prices });
  } catch (err: any) {
    console.error('Backfill fees error:', err);
    res.status(500).json({ error: 'Backfill failed', details: err.message });
  }
});

// GET /api/transactions — all transactions across wallets
router.get('/', async (_req: Request, res: Response) => {
  try {
    const wallets = db.prepare('SELECT * FROM wallets').all() as Wallet[];

    for (const wallet of wallets) {
      await syncWalletTransactions(wallet);
    }

    const transactions = db.prepare(`
      SELECT t.*, w.address as wallet_address, w.chain, w.label as wallet_label
      FROM transactions t
      JOIN wallets w ON t.wallet_id = w.id
      ORDER BY t.timestamp DESC
      LIMIT 500
    `).all();

    res.json(transactions);
  } catch (err: any) {
    console.error('Transactions fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch transactions', details: err.message });
  }
});

// PATCH /api/transactions/:id/comment
router.patch('/:id/comment', (req: Request, res: Response) => {
  const { comment } = req.body;
  if (comment == null) {
    res.status(400).json({ error: 'comment is required' });
    return;
  }
  const result = db.prepare('UPDATE transactions SET comment = ? WHERE id = ?').run(comment, req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Transaction not found' });
    return;
  }
  res.json({ ok: true });
});

// GET /api/transactions/:walletId
router.get('/:walletId', async (req: Request, res: Response) => {
  try {
    const wallet = db.prepare('SELECT * FROM wallets WHERE id = ?').get(req.params.walletId) as Wallet | undefined;
    if (!wallet) {
      res.status(404).json({ error: 'Wallet not found' });
      return;
    }

    await syncWalletTransactions(wallet);

    const transactions = db.prepare(`
      SELECT t.*, w.address as wallet_address, w.chain, w.label as wallet_label
      FROM transactions t
      JOIN wallets w ON t.wallet_id = w.id
      WHERE t.wallet_id = ?
      ORDER BY t.timestamp DESC
      LIMIT 200
    `).all(wallet.id);

    res.json(transactions);
  } catch (err: any) {
    console.error('Transactions fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch transactions', details: err.message });
  }
});

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

async function syncWalletTransactions(wallet: Wallet): Promise<void> {
  // Throttle: skip sync if last synced < 5 minutes ago
  if (wallet.last_synced_at) {
    const elapsed = Date.now() - new Date(wallet.last_synced_at).getTime();
    if (elapsed < SYNC_THROTTLE_MS) return;
  }

  if (isMoralisEnabled() && isMoralisChain(wallet.chain)) {
    await syncMoralisTransactions(wallet);
  } else {
    await syncLegacyTransactions(wallet);
  }

  // Update last_synced_at
  db.prepare('UPDATE wallets SET last_synced_at = datetime(\'now\') WHERE id = ?').run(wallet.id);
}

/**
 * Build a price map from Moralis wallet tokens (current prices).
 * Returns { tokenAddress -> usdPrice, 'native' -> nativePrice }
 */
async function getMoralisPrices(
  chain: string,
  address: string
): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};

  // Get token prices from Moralis portfolio (already cached)
  const tokens = await getWalletTokens(chain, address);
  for (const t of tokens) {
    if (t.native_token) {
      prices['native'] = t.usd_price || 0;
    } else if (t.usd_price) {
      prices[t.token_address.toLowerCase()] = t.usd_price;
    }
  }

  // Fallback native price from CoinGecko if not in Moralis
  if (!prices['native']) {
    const coinId = NATIVE_COIN_IDS[chain];
    if (coinId) {
      prices['native'] = await getNativePrice(coinId);
    }
  }

  return prices;
}

async function syncMoralisTransactions(wallet: Wallet): Promise<void> {
  const [tokenTxs, nativeTxs, prices] = await Promise.all([
    getTokenTransfers(wallet.chain, wallet.address),
    getNativeTransfers(wallet.chain, wallet.address),
    getMoralisPrices(wallet.chain, wallet.address),
  ]);

  const nativePrice = prices['native'] || 0;
  const nativeSymbol = NATIVE_SYMBOLS[wallet.chain] || '?';
  const knownFees = getExistingFeeHashes(wallet.id);

  // Collect send token tx hashes for fee lookup (skip already known)
  const sendTokenHashes = tokenTxs
    .filter(tx => tx.to_address.toLowerCase() !== wallet.address.toLowerCase())
    .map(tx => tx.transaction_hash)
    .filter(h => !knownFees.has(h));

  // Fetch fees only for new send token txs
  const tokenFeeMap = sendTokenHashes.length > 0
    ? await getTransactionFees(wallet.chain, sendTokenHashes)
    : new Map<string, number>();

  const allTxs: TxRecord[] = [];

  // Token transfers
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

  // Native transfers — transaction_fee already in response
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

  if (allTxs.length === 0) return;

  console.log(`[moralis:${wallet.chain}] Syncing ${allTxs.length} txs for ${wallet.address.slice(0, 8)}...`);
  insertTransactions(wallet.id, allTxs);
}

async function syncLegacyTransactions(wallet: Wallet): Promise<void> {
  let allExplorerTxs: import('../services/explorer').ExplorerTx[] = [];

  if (wallet.chain === 'ethereum' || wallet.chain === 'bsc') {
    const [native, tokens] = await Promise.all([
      getNativeTransactions(wallet.chain, wallet.address),
      getTokenTransactions(wallet.chain, wallet.address),
    ]);
    allExplorerTxs = [...native, ...tokens];
  } else if (wallet.chain === 'tron') {
    allExplorerTxs = await getTronTransactions(wallet.address);
  }

  if (allExplorerTxs.length === 0) return;

  // Get native price for fee USD calculation (TRON)
  let nativePrice = 0;
  if (wallet.chain === 'tron') {
    const coinId = NATIVE_COIN_IDS[wallet.chain];
    if (coinId) nativePrice = await getNativePrice(coinId);

    // Fetch TRON fees only for send txs not already in DB
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

  // Estimate USD for stablecoins ($1 per token)
  const STABLECOIN_RE = /^(usdt|usdc|busd|tusd|dai|fdusd|pyusd)$/i;
  const records: TxRecord[] = allExplorerTxs.map(tx => {
    const feeNative = tx.feeNative || 0;
    return {
      ...tx,
      valueUsd: STABLECOIN_RE.test(tx.tokenSymbol)
        ? parseFloat(tx.value || '0')
        : 0,
      feeNative,
      feeUsd: feeNative * nativePrice,
    };
  });

  insertTransactions(wallet.id, records);
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
        walletId,
        tx.hash,
        tx.blockNumber,
        tx.timestamp,
        tx.from,
        tx.to,
        tx.value,
        tx.tokenSymbol,
        tx.tokenAddress,
        tx.type,
        tx.valueUsd,
        tx.feeNative,
        tx.feeUsd,
      );
    }
  });

  batchInsert(txs);
}

export default router;
