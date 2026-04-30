import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../utils/api";

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
  fee_native: number;
  fee_usd: number;
  wallet_address: string;
  chain: string;
  wallet_label: string | null;
  comment: string;
}

async function fetchTransactions(): Promise<Transaction[]> {
  const res = await apiFetch("/api/transactions");
  if (!res.ok) throw new Error("Failed to fetch transactions");
  return res.json();
}

export function useTransactions() {
  return useQuery({
    queryKey: ["transactions"],
    queryFn: fetchTransactions,
    refetchInterval: 120_000,
  });
}

// Address labels
export interface AddressLabel {
  chain: string;
  address: string;
  label: string;
}

async function fetchAddressLabels(): Promise<AddressLabel[]> {
  const res = await apiFetch("/api/transactions/address-labels");
  if (!res.ok) return [];
  return res.json();
}

export function useAddressLabels() {
  return useQuery({
    queryKey: ["addressLabels"],
    queryFn: fetchAddressLabels,
  });
}

export function useSetAddressLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { chain: string; address: string; label: string }) => {
      const res = await apiFetch("/api/transactions/address-labels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save label");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["addressLabels"] });
    },
  });
}
