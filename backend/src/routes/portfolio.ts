import { Router, Request, Response } from 'express';
import db from '../db/client';
import { cache } from '../cache/memory-cache';
import { getEvmPortfolio, getEvmChainConfig } from '../services/ethereum';
import { getSolanaPortfolio } from '../services/solana';
import { getTronPortfolio } from '../services/tron';
import { getTokenPrices, getNativePrice } from '../services/prices';
import { getDexScreenerPrices } from '../services/dexscreener';

const router = Router();

interface Wallet {
  id: number;
  address: string;
  chain: string;
  label: string | null;
}

export interface TokenBalance {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  balanceFormatted: number;
  logoUri?: string;
}

export interface NFTItem {
  contractAddress: string;
  tokenId: string;
  name: string;
  imageUrl: string;
  standard: string;
}

export interface WalletPortfolio {
  wallet: Wallet;
  nativeBalance: number;
  tokens: (TokenBalance & { priceUsd: number; valueUsd: number })[];
  nfts: NFTItem[];
  totalValueUsd: number;
}

// Chain -> CoinGecko native coin id
const NATIVE_COIN_IDS: Record<string, string> = {
  ethereum: 'ethereum',
  bsc: 'binancecoin',
  tron: 'tron',
  solana: 'solana',
};

// Chain -> CoinGecko platform id for token prices
const COINGECKO_PLATFORMS: Record<string, string> = {
  ethereum: 'ethereum',
  bsc: 'binance-smart-chain',
  tron: 'tron',
  solana: 'solana',
};

// GET /api/portfolio
router.get('/', async (_req: Request, res: Response) => {
  try {
    const cacheKey = 'portfolio:all';
    const cached = cache.get<WalletPortfolio[]>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const wallets = db.prepare('SELECT * FROM wallets').all() as Wallet[];
    const portfolios = await Promise.all(wallets.map(fetchWalletPortfolio));

    cache.set(cacheKey, portfolios, 120_000);
    res.json(portfolios);
  } catch (err: any) {
    console.error('Portfolio fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch portfolio', details: err.message });
  }
});

// GET /api/portfolio/:walletId
router.get('/:walletId', async (req: Request, res: Response) => {
  try {
    const wallet = db.prepare('SELECT * FROM wallets WHERE id = ?').get(req.params.walletId) as Wallet | undefined;
    if (!wallet) {
      res.status(404).json({ error: 'Wallet not found' });
      return;
    }

    const cacheKey = `portfolio:${wallet.id}`;
    const cached = cache.get<WalletPortfolio>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const portfolio = await fetchWalletPortfolio(wallet);
    cache.set(cacheKey, portfolio, 120_000);
    res.json(portfolio);
  } catch (err: any) {
    console.error('Portfolio fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch portfolio', details: err.message });
  }
});

async function fetchWalletPortfolio(wallet: Wallet): Promise<WalletPortfolio> {
  let tokens: TokenBalance[] = [];
  let nfts: NFTItem[] = [];
  let nativeBalance = 0;

  if (wallet.chain === 'ethereum' || wallet.chain === 'bsc') {
    const result = await getEvmPortfolio(wallet.chain, wallet.address);
    tokens = result.tokens;
    nfts = result.nfts;
    nativeBalance = result.nativeBalance;
  } else if (wallet.chain === 'tron') {
    const result = await getTronPortfolio(wallet.address);
    tokens = result.tokens;
    nfts = result.nfts;
    nativeBalance = result.nativeBalance;
  } else if (wallet.chain === 'solana') {
    const result = await getSolanaPortfolio(wallet.address);
    tokens = result.tokens;
    nfts = result.nfts;
    nativeBalance = result.nativeBalance;
  }

  // Fetch prices
  const nativeCoinId = NATIVE_COIN_IDS[wallet.chain] || 'ethereum';
  const nativePrice = await getNativePrice(nativeCoinId);

  const tokenAddresses = tokens
    .filter(t => t.address !== 'native')
    .map(t => t.address);

  const platform = COINGECKO_PLATFORMS[wallet.chain] || 'ethereum';
  const tokenPrices = tokenAddresses.length > 0
    ? await getTokenPrices(platform, tokenAddresses)
    : {};

  // Find tokens without CoinGecko price — try DexScreener
  const missingPriceAddrs = tokenAddresses.filter(a => !tokenPrices[a.toLowerCase()]);
  let dexPrices: Record<string, number> = {};
  if (missingPriceAddrs.length > 0) {
    dexPrices = await getDexScreenerPrices(wallet.chain, missingPriceAddrs);
  }

  const enrichedTokens = tokens.map(t => {
    const addr = t.address.toLowerCase();
    const priceUsd = t.address === 'native'
      ? nativePrice
      : (tokenPrices[addr] || dexPrices[addr] || 0);
    return {
      ...t,
      priceUsd,
      valueUsd: t.balanceFormatted * priceUsd,
    };
  });

  const totalValueUsd = enrichedTokens.reduce((sum, t) => sum + t.valueUsd, 0);

  return {
    wallet,
    nativeBalance,
    tokens: enrichedTokens,
    nfts,
    totalValueUsd,
  };
}

export default router;
