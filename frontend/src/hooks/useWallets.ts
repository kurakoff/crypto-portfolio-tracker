import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const API_BASE = import.meta.env.VITE_API_URL || "";

export interface Wallet {
  id: number;
  address: string;
  chain: string;
  label: string | null;
  created_at?: string;
}

export interface CreateWalletInput {
  address: string;
  chain: string;
  label?: string;
}

async function fetchWallets(): Promise<Wallet[]> {
  const res = await fetch(`${API_BASE}/api/wallets`);
  if (!res.ok) throw new Error("Failed to fetch wallets");
  return res.json();
}

async function createWallet(input: CreateWalletInput): Promise<Wallet> {
  const res = await fetch(`${API_BASE}/api/wallets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to create wallet");
  }

  return res.json();
}

async function deleteWallet(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/wallets/${id}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to delete wallet");
  }
}

export function useWallets() {
  return useQuery({
    queryKey: ["wallets"],
    queryFn: fetchWallets,
  });
}

export function useCreateWallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createWallet,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

export function useDeleteWallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteWallet,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}
