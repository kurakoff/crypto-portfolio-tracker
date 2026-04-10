import { Router, Request, Response } from 'express';
import db from '../db/client';
import { getNativeTransactions, getTokenTransactions, getTronTransactions } from '../services/explorer';
import { getNativePrice } from '../services/prices';
import {
  isMoralisEnabled,
  isMoralisChain,
  getTokenTransfers,
  getNativeTransfers,
  getWalletTokens,
} from '../services/moralis';

const router = Router();

interface Wallet {
  id: number;
  address: string;
  chain: string;
  label: string | null;
}

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
}

async function syncWalletTransactions(wallet: Wallet): Promise<void> {
  if (isMoralisEnabled() && isMoralisChain(wallet.chain)) {
    return syncMoralisTransactions(wallet);
  }
  return syncLegacyTransactions(wallet);
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

  const allTxs: TxRecord[] = [];
  const nativeSymbol = NATIVE_SYMBOLS[wallet.chain] || '?';

  // Token transfers
  for (const tx of tokenTxs) {
    const isReceive = tx.to_address.toLowerCase() === wallet.address.toLowerCase();
    const valueDecimal = tx.value_decimal || '0';
    const amount = parseFloat(valueDecimal) || 0;
    const price = prices[tx.address.toLowerCase()] || 0;

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
    });
  }

  // Native transfers
  const nativePrice = prices['native'] || 0;
  for (const tx of nativeTxs) {
    if (tx.value === '0') continue;
    const isReceive = tx.to_address.toLowerCase() === wallet.address.toLowerCase();
    const valueFormatted = parseFloat(tx.value) / 1e18;

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
    });
  }

  if (allTxs.length === 0) return;

  console.log(`[moralis:${wallet.chain}] Syncing ${allTxs.length} txs for ${wallet.address.slice(0, 8)}...`);
  insertTransactions(wallet.id, allTxs);
}

async function syncLegacyTransactions(wallet: Wallet): Promise<void> {
  let allTxs: Array<{
    hash: string;
    blockNumber: number;
    timestamp: string;
    from: string;
    to: string;
    value: string;
    tokenSymbol: string;
    tokenAddress: string;
    type: string;
  }> = [];

  if (wallet.chain === 'ethereum' || wallet.chain === 'bsc') {
    const [native, tokens] = await Promise.all([
      getNativeTransactions(wallet.chain, wallet.address),
      getTokenTransactions(wallet.chain, wallet.address),
    ]);
    allTxs = [...native, ...tokens];
  } else if (wallet.chain === 'tron') {
    allTxs = await getTronTransactions(wallet.address);
  }

  if (allTxs.length === 0) return;

  // Estimate USD for stablecoins ($1 per token)
  const STABLECOIN_RE = /^(usdt|usdc|busd|tusd|dai|fdusd|pyusd)$/i;
  const records: TxRecord[] = allTxs.map(tx => ({
    ...tx,
    valueUsd: STABLECOIN_RE.test(tx.tokenSymbol)
      ? parseFloat(tx.value || '0')
      : 0,
  }));

  insertTransactions(wallet.id, records);
}

function insertTransactions(walletId: number, txs: TxRecord[]): void {
  const insert = db.prepare(`
    INSERT INTO transactions
      (wallet_id, hash, block_number, timestamp, from_address, to_address, value, token_symbol, token_address, type, value_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(wallet_id, hash, token_address) DO UPDATE SET
      value_usd = excluded.value_usd
    WHERE excluded.value_usd > 0 AND transactions.value_usd = 0
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
      );
    }
  });

  batchInsert(txs);
}

export default router;
