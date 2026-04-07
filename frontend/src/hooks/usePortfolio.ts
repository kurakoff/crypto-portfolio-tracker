import { useQuery } from "@tanstack/react-query";

const API_BASE = import.meta.env.VITE_API_URL || "";

export interface TokenBalance {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  balanceFormatted: number;
  priceUsd: number;
  valueUsd: number;
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
  wallet: {
    id: number;
    address: string;
    chain: string;
    label: string | null;
  };
  nativeBalance: number;
  tokens: TokenBalance[];
  nfts: NFTItem[];
  totalValueUsd: number;
}

async function fetchPortfolio(): Promise<WalletPortfolio[]> {
  const res = await fetch(`${API_BASE}/api/portfolio`);
  if (!res.ok) throw new Error("Failed to fetch portfolio");
  return res.json();
}

export function usePortfolio() {
  return useQuery({
    queryKey: ["portfolio"],
    queryFn: fetchPortfolio,
    refetchInterval: 120_000,
  });
}
