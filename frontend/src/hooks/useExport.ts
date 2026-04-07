import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface ExportResult {
  spreadsheetUrl: string;
  newRows: number;
  totalRows: number;
}

interface ExportStatus {
  id?: number;
  spreadsheet_id?: string;
  spreadsheet_url?: string;
  last_export_at?: string;
  rows_exported?: number;
  configured: boolean;
  serviceAccountEmail: string;
}

interface ExportData {
  totalValue?: number;
  totalReceived?: number;
  totalSent?: number;
  dateFrom?: string;
  dateTo?: string;
  exportedAt?: string;
  tokens?: Array<{
    symbol: string;
    name: string;
    balance: string;
    priceUsd: number;
    valueUsd: number;
  }>;
  transactions?: Array<{
    timestamp: string;
    wallet_label?: string;
    wallet_address: string;
    chain: string;
    type: string;
    token_symbol: string;
    value: string;
    value_usd: number;
    from_address: string;
    to_address: string;
    hash: string;
  }>;
}

async function exportToSheets(data?: ExportData): Promise<ExportResult> {
  const res = await fetch(`${API_BASE}/api/export/sheets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data || {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.details || err.error || "Failed to export");
  }
  return res.json();
}

async function configureSheet(spreadsheetUrl: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/export/configure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spreadsheetUrl }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to configure");
  }
}

async function fetchExportStatus(): Promise<ExportStatus> {
  const res = await fetch(`${API_BASE}/api/export/status`);
  if (!res.ok) return { configured: false, serviceAccountEmail: "" };
  return res.json();
}

export function useExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data?: ExportData) => exportToSheets(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exportStatus"] });
    },
  });
}

export function useConfigureSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: configureSheet,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exportStatus"] });
    },
  });
}

export function useDisconnectSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/export/disconnect`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to disconnect");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["exportStatus"] });
    },
  });
}

export function useExportStatus() {
  return useQuery({
    queryKey: ["exportStatus"],
    queryFn: fetchExportStatus,
  });
}
