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
    // The backend syncs wallets in the background; this just re-reads its DB.
    refetchInterval: 60_000,
  });
}

// Background sync status / manual refresh
export interface SyncStatus {
  running: boolean;
  startedAt: string | null;
  lastRunAt: string | null;
  lastRunMs: number;
  lastSynced: number;
  lastFailed: number;
  lastSkipped: number;
  failedWallets: string[];
}

async function fetchSyncStatus(): Promise<SyncStatus> {
  const res = await apiFetch("/api/transactions/sync-status");
  if (!res.ok) throw new Error("Failed to fetch sync status");
  return res.json();
}

/** Polls quickly while a sync is running, slowly otherwise. */
export function useSyncStatus() {
  return useQuery({
    queryKey: ["syncStatus"],
    queryFn: fetchSyncStatus,
    refetchInterval: (query) => (query.state.data?.running ? 2_000 : 30_000),
  });
}

/** Forces a sync of every wallet, then refreshes transactions when it finishes. */
export function useForceSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/transactions/sync", { method: "POST" });
      if (!res.ok) throw new Error("Failed to start sync");
      // Wait for the run to finish (status is polled every 2s meanwhile).
      for (let i = 0; i < 150; i++) {
        await new Promise(r => setTimeout(r, 2_000));
        const st = await fetchSyncStatus();
        qc.setQueryData(["syncStatus"], st);
        if (!st.running) return st;
      }
      throw new Error("Sync is taking too long");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["syncStatus"] });
      qc.invalidateQueries({ queryKey: ["portfolio"] });
    },
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
