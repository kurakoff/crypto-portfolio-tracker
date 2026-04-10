import { Router, Request, Response } from 'express';
import db from '../db/client';
import { cache } from '../cache/memory-cache';
import { getEvmPortfolio, getEvmChainConfig } from '../services/ethereum';
import { getSolanaPortfolio } from '../services/solana';
import { getTronPortfolio } from '../services/tron';
import { getNativePrice, getTokenPrices } from '../services/prices';
import {
  isMoralisEnabled,
  isMoralisChain,
  getWalletTokens,
} from '../services/moralis';

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

const NATIVE_SYMBOLS: Record<string, { symbol: string; name: string }> = {
  ethereum: { symbol: 'ETH', name: 'Ethereum' },
  bsc: { symbol: 'BNB', name: 'BNB' },
  tron: { symbol: 'TRX', name: 'Tron' },
  solana: { symbol: 'SOL', name: 'Solana' },
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

    // Fetch EVM wallets in parallel (Moralis handles concurrency),
    // but TRON/Solana sequentially to avoid rate limits
    const evmWallets = wallets.filter(w => w.chain === 'ethereum' || w.chain === 'bsc');
    const otherWallets = wallets.filter(w => w.chain !== 'ethereum' && w.chain !== 'bsc');

    const evmResults = await Promise.all(evmWallets.map(fetchWalletPortfolio));

    const otherResults: WalletPortfolio[] = [];
    for (let i = 0; i < otherWallets.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 1500));
      otherResults.push(await fetchWalletPortfolio(otherWallets[i]));
    }

    const portfolios = [...evmResults, ...otherResults]
      .sort((a, b) => a.wallet.id - b.wallet.id);

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
  // Use Moralis for supported EVM chains
  if (isMoralisEnabled() && isMoralisChain(wallet.chain)) {
    return fetchMoralisPortfolio(wallet);
  }

  // Fallback to existing implementations
  return fetchLegacyPortfolio(wallet);
}

/**
 * Moralis-powered portfolio — single API gives tokens + prices + logos.
 * /wallets/{address}/tokens returns both native + ERC-20 in one call.
 */
async function fetchMoralisPortfolio(wallet: Wallet): Promise<WalletPortfolio> {
  const moralisTokens = await getWalletTokens(wallet.chain, wallet.address);

  const nativeInfo = NATIVE_SYMBOLS[wallet.chain] || { symbol: '?', name: '?' };

  // Map all tokens (native + ERC-20) from Moralis
  const allTokens = moralisTokens.map(t => {
    const isNative = t.native_token === true ||
      t.token_address === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

    const balFormatted = parseFloat(t.balance_formatted || '0') ||
      parseFloat(t.balance) / Math.pow(10, t.decimals);
    const priceUsd = t.usd_price || 0;

    return {
      address: isNative ? 'native' : t.token_address,
      symbol: isNative ? nativeInfo.symbol : t.symbol,
      name: isNative ? nativeInfo.name : t.name,
      decimals: t.decimals,
      balance: t.balance,
      balanceFormatted: balFormatted,
      logoUri: t.logo || t.thumbnail || undefined,
      priceUsd,
      valueUsd: balFormatted * priceUsd,
    };
  });

  const nativeToken = allTokens.find(t => t.address === 'native');
  const nativeBalance = nativeToken?.balanceFormatted || 0;
  const totalValueUsd = allTokens.reduce((sum, t) => sum + t.valueUsd, 0);

  console.log(`[moralis:${wallet.chain}] ${wallet.address.slice(0, 8)}... — ${allTokens.length} tokens, $${totalValueUsd.toFixed(2)}`);

  return {
    wallet,
    nativeBalance,
    tokens: allTokens,
    nfts: [],
    totalValueUsd,
  };
}

/**
 * Legacy portfolio for non-Moralis chains (Tron, Solana) or when Moralis is disabled.
 */
async function fetchLegacyPortfolio(wallet: Wallet): Promise<WalletPortfolio> {
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

  // Token prices via CoinGecko
  const COINGECKO_PLATFORMS: Record<string, string> = {
    ethereum: 'ethereum', bsc: 'binance-smart-chain', tron: 'tron', solana: 'solana',
  };
  const tokenAddrs = tokens.filter(t => t.address !== 'native').map(t => t.address);
  const platform = COINGECKO_PLATFORMS[wallet.chain];
  const tokenPrices = platform && tokenAddrs.length > 0
    ? await getTokenPrices(platform, tokenAddrs)
    : {};

  // Stablecoins worth $1 regardless of price API
  const STABLECOIN_SYMBOLS = new Set(['USDT', 'USDC', 'BUSD', 'TUSD', 'DAI', 'USDJ', 'FDUSD', 'PYUSD']);

  const enrichedTokens = tokens.map(t => {
    let priceUsd: number;
    if (t.address === 'native') {
      priceUsd = nativePrice;
    } else if (STABLECOIN_SYMBOLS.has(t.symbol.toUpperCase())) {
      priceUsd = 1;
    } else {
      priceUsd = tokenPrices[t.address.toLowerCase()] || 0;
    }
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
