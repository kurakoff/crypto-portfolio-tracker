import { Router, Request, Response } from 'express';
import db from '../db/client';
import { cache } from '../cache/memory-cache';

const router = Router();

function invalidatePortfolioCache() {
  cache.delete('portfolio:all');
}

// GET /api/wallets
router.get('/', (_req: Request, res: Response) => {
  const wallets = db.prepare('SELECT * FROM wallets ORDER BY created_at DESC').all();
  res.json(wallets);
});

// POST /api/wallets
router.post('/', (req: Request, res: Response) => {
  const { address, chain, label } = req.body;

  if (!address || !chain) {
    res.status(400).json({ error: 'address and chain are required' });
    return;
  }

  if (!['ethereum', 'bsc', 'tron', 'solana'].includes(chain)) {
    res.status(400).json({ error: 'chain must be "ethereum", "bsc", "tron" or "solana"' });
    return;
  }

  try {
    const result = db
      .prepare('INSERT INTO wallets (address, chain, label) VALUES (?, ?, ?)')
      .run(address.trim(), chain, label?.trim() || null);

    const wallet = db.prepare('SELECT * FROM wallets WHERE id = ?').get(result.lastInsertRowid);
    invalidatePortfolioCache();
    res.status(201).json(wallet);
  } catch (err: any) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Wallet already exists for this chain' });
      return;
    }
    throw err;
  }
});

// PATCH /api/wallets/:id — update label
router.patch('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { label } = req.body;

  const result = db.prepare('UPDATE wallets SET label = ? WHERE id = ?')
    .run(label?.trim() || null, id);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Wallet not found' });
    return;
  }

  invalidatePortfolioCache();
  const wallet = db.prepare('SELECT * FROM wallets WHERE id = ?').get(id);
  res.json(wallet);
});

// DELETE /api/wallets/:id
router.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const result = db.prepare('DELETE FROM wallets WHERE id = ?').run(id);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Wallet not found' });
    return;
  }

  invalidatePortfolioCache();
  cache.delete(`portfolio:${id}`);
  res.json({ success: true });
});

export default router;
