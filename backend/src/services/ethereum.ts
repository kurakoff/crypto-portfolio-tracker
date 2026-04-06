import { ethers } from 'ethers';
import { config } from '../config/rpc';
import { cache } from '../cache/memory-cache';
import { multicallBalances, multicallTokenMetadata } from './multicall';
import { getTopEthereumTokens, getTopBscTokens } from './token-list';
import { getTokenBalances } from './explorer';
import { discoverBscTokens } from './bsc-explorer';
import type { TokenBalance, NFTItem } from '../routes/portfolio';

const providers = new Map<string, ethers.JsonRpcProvider>();

function getProvider(rpcUrl: string): ethers.JsonRpcProvider {
  let p = providers.get(rpcUrl);
  if (!p) {
    p = new ethers.JsonRpcProvider(rpcUrl);
    providers.set(rpcUrl, p);
  }
  return p;
}

interface EvmChainConfig {
  rpcUrl: string;
  nativeSymbol: string;
  nativeName: string;
  coingeckoId: string;
  chainPrefix: string;
  useTokenList: boolean;
}

const EVM_CHAINS: Record<string, EvmChainConfig> = {
  ethereum: {
    rpcUrl: config.ethRpcUrl,
    nativeSymbol: 'ETH',
    nativeName: 'Ethereum',
    coingeckoId: 'ethereum',
    chainPrefix: 'eth',
    useTokenList: true,
  },
  bsc: {
    rpcUrl: config.bscRpcUrl,
    nativeSymbol: 'BNB',
    nativeName: 'BNB',
    coingeckoId: 'binancecoin',
    chainPrefix: 'bsc',
    useTokenList: true,
  },
};

export function getEvmChainConfig(chain: string): EvmChainConfig | undefined {
  return EVM_CHAINS[chain];
}

export async function getEvmPortfolio(chain: string, address: string): Promise<{
  nativeBalance: number;
  tokens: TokenBalance[];
  nfts: NFTItem[];
}> {
  const cfg = EVM_CHAINS[chain];
  if (!cfg) throw new Error(`Unknown EVM chain: ${chain}`);

  const p = getProvider(cfg.rpcUrl);

  // 1. Native balance
  const rawBalance = await p.getBalance(address);
  const nativeBalance = parseFloat(ethers.formatEther(rawBalance));

  const nativeToken: TokenBalance = {
    address: 'native',
    symbol: cfg.nativeSymbol,
    name: cfg.nativeName,
    decimals: 18,
    balance: rawBalance.toString(),
    balanceFormatted: nativeBalance,
  };

  // 2. Collect token addresses to check
  const tokenAddressSet = new Set<string>();

  // 2a. From token lists (Uniswap for ETH, PancakeSwap for BSC)
  let tokenList: Awaited<ReturnType<typeof getTopEthereumTokens>> = [];
  if (cfg.useTokenList) {
    tokenList = chain === 'bsc' ? await getTopBscTokens() : await getTopEthereumTokens();
  }
  for (const t of tokenList) {
    tokenAddressSet.add(t.address.toLowerCase());
  }

  // 2b. From explorer API — discover tokens the wallet has interacted with
  let explorerTokens = await getTokenBalances(chain, address);

  // 2c. BSC specific: discover token addresses via CoinGecko + getLogs
  if (chain === 'bsc') {
    const discoveredAddrs = await discoverBscTokens(address);
    for (const a of discoveredAddrs) {
      tokenAddressSet.add(a);
    }
  }

  if (explorerTokens.length > 0) {
    console.log(`[${chain}] Explorer found ${explorerTokens.length} tokens for ${address.slice(0,8)}`);
  }
  for (const t of explorerTokens) {
    tokenAddressSet.add(t.contractAddress.toLowerCase());
  }

  // 3. Batch check all balances via Multicall3
  const allAddresses = Array.from(tokenAddressSet);
  let balances: Map<string, bigint>;
  try {
    balances = await multicallBalances(p, address, allAddresses);
  } catch (err) {
    console.error('Multicall failed, using explorer balances:', err);
    balances = new Map();
  }

  // 4. Build token list — use Multicall balances + fallback to explorer balances
  const erc20Tokens: TokenBalance[] = [];
  const processedAddrs = new Set<string>();

  // 4a. Tokens found via Multicall
  if (balances.size > 0) {
    const metadata = await multicallTokenMetadata(p, Array.from(balances.keys()));
    for (const [addr, balance] of balances) {
      const listInfo = tokenList.find(t => t.address.toLowerCase() === addr.toLowerCase());
      const mcMeta = metadata.get(addr);
      const explorerInfo = explorerTokens.find(t => t.contractAddress.toLowerCase() === addr.toLowerCase());

      const symbol = listInfo?.symbol || mcMeta?.symbol || explorerInfo?.symbol || 'UNKNOWN';
      const name = listInfo?.name || mcMeta?.name || explorerInfo?.name || 'Unknown Token';
      const decimals = listInfo?.decimals ?? mcMeta?.decimals ?? explorerInfo?.decimals ?? 18;

      erc20Tokens.push({
        address: addr,
        symbol,
        name,
        decimals,
        balance: balance.toString(),
        balanceFormatted: parseFloat(ethers.formatUnits(balance, decimals)),
        logoUri: listInfo?.logoURI,
      });
      processedAddrs.add(addr.toLowerCase());
    }
  }

  // 4b. Fallback: tokens from explorer that Multicall missed
  for (const et of explorerTokens) {
    if (processedAddrs.has(et.contractAddress.toLowerCase())) continue;
    if (et.rawBalance === '0') continue;

    const bal = BigInt(et.rawBalance);
    if (bal === 0n) continue;

    erc20Tokens.push({
      address: et.contractAddress,
      symbol: et.symbol,
      name: et.name,
      decimals: et.decimals,
      balance: et.rawBalance,
      balanceFormatted: parseFloat(ethers.formatUnits(bal, et.decimals)),
    });
  }

  return {
    nativeBalance,
    tokens: [nativeToken, ...erc20Tokens],
    nfts: [],
  };
}

export async function getEthereumPortfolio(address: string) {
  return getEvmPortfolio('ethereum', address);
}
