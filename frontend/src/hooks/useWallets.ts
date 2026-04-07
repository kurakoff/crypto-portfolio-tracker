import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface Wallet {
  id: number;
  address: string;
  chain: 'ethereum' | 'bsc' | 'tron' | 'solana';
  label: string | null;
  created_at: string;
}

async function fetchWallets(): Promise<Wallet[]> {
  const res = await fetch('/api/wallets');
  if (!res.ok) throw new Error('Failed to fetch wallets');
  return res.json();
}

async function addWallet(data: { address: string; chain: string; label?: string }): Promise<Wallet> {
  const res = await fetch('/api/wallets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to add wallet');
  }
  return res.json();
}

async function deleteWallet(id: number): Promise<void> {
  const res = await fetch(`/api/wallets/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete wallet');
}

export function useWallets() {
  return useQuery({ queryKey: ['wallets'], queryFn: fetchWallets });
}

export function useAddWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addWallet,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wallets'] });
      qc.invalidateQueries({ queryKey: ['portfolio'] });
    },
  });
}

export function useDeleteWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteWallet,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wallets'] });
      qc.invalidateQueries({ queryKey: ['portfolio'] });
    },
  });
}
