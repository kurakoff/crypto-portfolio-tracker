import { Router, Request, Response } from 'express';
import db from '../db/client';
import { getTronTxFees, getEthBlockscoutTxFees } from '../services/explorer';
import { getNativePrice } from '../services/prices';
import { getTransactionFees, checkMoralisKeys } from '../services/moralis';
import { syncAllWallets, getSyncStatus, NATIVE_COIN_IDS } from '../services/tx-sync';

const router = Router();

// POST /api/transactions/sync — force a sync of all wallets now (background).
// Returns immediately; poll GET /sync-status until running=false, then refetch.
router.post('/sync', (_req: Request, res: Response) => {
  const before = getSyncStatus();
  void syncAllWallets(true);
  res.status(202).json({ started: !before.running, ...getSyncStatus() });
});

// GET /api/transactions/moralis-check — probe each configured Moralis key
router.get('/moralis-check', async (_req: Request, res: Response) => {
  const keys = await checkMoralisKeys();
  res.json({ keysConfigured: keys.length, keys });
});

// GET /api/transactions/sync-status
router.get('/sync-status', (_req: Request, res: Response) => {
  res.json(getSyncStatus());
});

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

    // Get native prices
    const prices: Record<string, number> = {};
    for (const coinId of ['ethereum', 'binancecoin', 'tron']) {
      prices[coinId] = await getNativePrice(coinId);
    }

    // Rows that already have fee_native but lost fee_usd: just recompute USD
    let usdRepaired = 0;
    for (const w of db.prepare('SELECT id, chain FROM wallets').all() as { id: number; chain: string }[]) {
      const price = prices[NATIVE_COIN_IDS[w.chain]] || 0;
      if (!(price > 0)) continue;
      usdRepaired += db.prepare(
        'UPDATE transactions SET fee_usd = fee_native * ? WHERE wallet_id = ? AND fee_native > 0 AND fee_usd = 0'
      ).run(price, w.id).changes;
    }

    if (rows.length === 0) {
      res.json({ message: 'No transactions to backfill', updated: 0, usdRepaired, prices });
      return;
    }

    const update = db.prepare('UPDATE transactions SET fee_native = ?, fee_usd = ? WHERE id = ?');
    let updated = 0;

    // Group by chain
    const tronHashes = rows.filter(r => r.chain === 'tron');
    const evmRows = rows.filter(r => r.chain === 'ethereum' || r.chain === 'bsc' || r.chain === 'arbitrum');

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
    for (const chain of ['ethereum', 'bsc', 'arbitrum'] as const) {
      const chainRows = evmRows.filter(r => r.chain === chain);
      if (chainRows.length === 0) continue;
      const hashes = chainRows.map(r => r.hash);
      const feeMap = chain === 'ethereum'
        ? await getEthBlockscoutTxFees(hashes)
        : await getTransactionFees(chain, hashes);
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

    res.json({ message: 'Backfill complete', total: rows.length, updated, usdRepaired, prices });
  } catch (err: any) {
    console.error('Backfill fees error:', err);
    res.status(500).json({ error: 'Backfill failed', details: err.message });
  }
});

// GET /api/transactions — all transactions across wallets
router.get('/', async (_req: Request, res: Response) => {
  try {
    // Sync runs in the background (services/tx-sync); this only reads the DB.
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
    const wallet = db.prepare('SELECT * FROM wallets WHERE id = ?').get(req.params.walletId) as { id: number } | undefined;
    if (!wallet) {
      res.status(404).json({ error: 'Wallet not found' });
      return;
    }

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

export default router;
