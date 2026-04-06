import { Router, Request, Response } from 'express';
import db from '../db/client';
import { getNativeTransactions, getTokenTransactions, getTronTransactions } from '../services/explorer';
import { getNativePrice, getTokenPrices } from '../services/prices';
import { getDexScreenerPrices } from '../services/dexscreener';

const router = Router();

interface Wallet {
  id: number;
  address: string;
  chain: string;
  label: string | null;
}

const NATIVE_COIN_IDS: Record<string, string> = {
  ethereum: 'ethereum',
  bsc: 'binancecoin',
  tron: 'tron',
  solana: 'solana',
};

const COINGECKO_PLATFORMS: Record<string, string> = {
  ethereum: 'ethereum',
  bsc: 'binance-smart-chain',
  tron: 'tron',
  solana: 'solana',
};

// GET /api/transactions — all transactions across wallets
router.get('/', async (_req: Request, res: Response) => {
  try {
    const wallets = db.prepare('SELECT * FROM wallets').all() as Wallet[];

    // Sync transactions for all wallets
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

async function syncWalletTransactions(wallet: Wallet): Promise<void> {
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

  // Get current prices for USD estimation
  const prices = await getTxPrices(wallet.chain, allTxs);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO transactions
      (wallet_id, hash, block_number, timestamp, from_address, to_address, value, token_symbol, token_address, type, value_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const batchInsert = db.transaction((txs: typeof allTxs) => {
    for (const tx of txs) {
      const amount = parseFloat(tx.value) || 0;
      const price = prices[tx.tokenAddress.toLowerCase()] || 0;
      const valueUsd = amount * price;

      insert.run(
        wallet.id,
        tx.hash,
        tx.blockNumber,
        tx.timestamp,
        tx.from,
        tx.to,
        tx.value,
        tx.tokenSymbol,
        tx.tokenAddress,
        tx.type,
        valueUsd,
      );
    }
  });

  batchInsert(allTxs);
}

async function getTxPrices(
  chain: string,
  txs: Array<{ tokenAddress: string }>
): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};

  // Native price
  const nativeCoinId = NATIVE_COIN_IDS[chain];
  if (nativeCoinId) {
    const nativePrice = await getNativePrice(nativeCoinId);
    prices['native'] = nativePrice;
  }

  // Token prices
  const tokenAddrs = [...new Set(txs
    .map(tx => tx.tokenAddress.toLowerCase())
    .filter(a => a !== 'native'))];

  if (tokenAddrs.length > 0) {
    const platform = COINGECKO_PLATFORMS[chain];
    if (platform) {
      const cgPrices = await getTokenPrices(platform, tokenAddrs);
      Object.assign(prices, cgPrices);
    }

    // DexScreener fallback for tokens not in CoinGecko
    const missing = tokenAddrs.filter(a => !prices[a]);
    if (missing.length > 0) {
      const dexPrices = await getDexScreenerPrices(chain, missing);
      Object.assign(prices, dexPrices);
    }
  }

  return prices;
}

export default router;
