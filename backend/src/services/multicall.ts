import { ethers } from 'ethers';
import { MULTICALL3_ADDRESS, MULTICALL3_ABI, ERC20_ABI } from '../config/constants';

const erc20Interface = new ethers.Interface(ERC20_ABI);

interface MulticallResult {
  success: boolean;
  returnData: string;
}

export async function multicallBalances(
  provider: ethers.JsonRpcProvider,
  owner: string,
  tokenAddresses: string[]
): Promise<Map<string, bigint>> {
  if (tokenAddresses.length === 0) return new Map();

  const multicall = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  const balanceOfData = erc20Interface.encodeFunctionData('balanceOf', [owner]);

  const balances = new Map<string, bigint>();
  const BATCH_SIZE = 500;

  for (let start = 0; start < tokenAddresses.length; start += BATCH_SIZE) {
    const batch = tokenAddresses.slice(start, start + BATCH_SIZE);
    const calls = batch.map(addr => ({
      target: addr,
      allowFailure: true,
      callData: balanceOfData,
    }));

    try {
      const results: MulticallResult[] = await multicall.aggregate3.staticCall(calls);
      for (let i = 0; i < results.length; i++) {
        if (results[i].success && results[i].returnData !== '0x') {
          try {
            const decoded = erc20Interface.decodeFunctionResult('balanceOf', results[i].returnData);
            const balance = decoded[0] as bigint;
            if (balance > 0n) {
              balances.set(batch[i], balance);
            }
          } catch {}
        }
      }
    } catch (err) {
      console.error(`Multicall batch failed (${start}-${start + batch.length}):`, (err as Error).message?.slice(0, 100));
    }
  }

  return balances;
}

export async function multicallTokenMetadata(
  provider: ethers.JsonRpcProvider,
  tokenAddresses: string[]
): Promise<Map<string, { symbol: string; name: string; decimals: number }>> {
  if (tokenAddresses.length === 0) return new Map();

  const multicall = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);

  const calls = tokenAddresses.flatMap(addr => [
    { target: addr, allowFailure: true, callData: erc20Interface.encodeFunctionData('symbol') },
    { target: addr, allowFailure: true, callData: erc20Interface.encodeFunctionData('name') },
    { target: addr, allowFailure: true, callData: erc20Interface.encodeFunctionData('decimals') },
  ]);

  const results: MulticallResult[] = await multicall.aggregate3.staticCall(calls);
  const metadata = new Map<string, { symbol: string; name: string; decimals: number }>();

  for (let i = 0; i < tokenAddresses.length; i++) {
    const base = i * 3;
    try {
      const symbol = results[base].success
        ? erc20Interface.decodeFunctionResult('symbol', results[base].returnData)[0]
        : 'UNKNOWN';
      const name = results[base + 1].success
        ? erc20Interface.decodeFunctionResult('name', results[base + 1].returnData)[0]
        : 'Unknown Token';
      const decimals = results[base + 2].success
        ? Number(erc20Interface.decodeFunctionResult('decimals', results[base + 2].returnData)[0])
        : 18;

      metadata.set(tokenAddresses[i], { symbol, name, decimals });
    } catch {
      // skip
    }
  }

  return metadata;
}
