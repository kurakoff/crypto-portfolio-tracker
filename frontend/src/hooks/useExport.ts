import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const API_BASE = import.meta.env.VITE_API_URL || "";

export interface ExportStatus {
  connected: boolean;
  spreadsheetId?: string | null;
  spreadsheetUrl?: string | null;
  lastSyncAt?: string | null;
}

export interface ConfigureExportInput {
  spreadsheetId: string;
}

async function fetchExportStatus(): Promise<ExportStatus> {
  const res = await fetch(`${API_BASE}/api/export/status`);
  if (!res.ok) throw new Error("Failed to fetch export status");
  return res.json();
}

async function connectSheets(): Promise<{ url?: string; authUrl?: string }> {
  const res = await fetch(`${API_BASE}/api/export/sheets`, {
    method: "POST",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to connect Google Sheets");
  }

  return res.json();
}

async function configureExport(
  input: ConfigureExportInput
): Promise<ExportStatus> {
  const res = await fetch(`${API_BASE}/api/export/configure`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to configure export");
  }

  return res.json();
}

async function disconnectExport(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/export/disconnect`, {
    method: "DELETE",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to disconnect export");
  }
}

export function useExportStatus() {
  return useQuery({
    queryKey: ["export-status"],
    queryFn: fetchExportStatus,
  });
}

export function useConnectSheets() {
  return useMutation({
    mutationFn: connectSheets,
  });
}

export function useConfigureExport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: configureExport,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["export-status"] });
    },
  });
}

export function useDisconnectExport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: disconnectExport,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["export-status"] });
    },
  });
}
