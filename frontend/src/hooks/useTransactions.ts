import { useQuery } from '@tanstack/react-query';

export interface Transaction {
  id: number;
  wallet_id: number;
  hash: string;
  block_number: number;
  timestamp: string;
  from_address: string;
  to_address: string;
  value: string;
  token_symbol: string;
  token_address: string;
  type: string;
  value_usd: number;
  wallet_address: string;
  chain: string;
  wallet_label: string | null;
}

async function fetchTransactions(): Promise<Transaction[]> {
  const res = await fetch('/api/transactions');
  if (!res.ok) throw new Error('Failed to fetch transactions');
  return res.json();
}

export function useTransactions() {
  return useQuery({
    queryKey: ['transactions'],
    queryFn: fetchTransactions,
    refetchInterval: 120_000,
  });
}
