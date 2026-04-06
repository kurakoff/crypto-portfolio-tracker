import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

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

async function exportToSheets(): Promise<ExportResult> {
  const res = await fetch('/api/export/sheets', { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.details || err.error || 'Failed to export');
  }
  return res.json();
}

async function configureSheet(spreadsheetUrl: string): Promise<void> {
  const res = await fetch('/api/export/configure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spreadsheetUrl }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to configure');
  }
}

async function fetchExportStatus(): Promise<ExportStatus> {
  const res = await fetch('/api/export/status');
  if (!res.ok) return { configured: false, serviceAccountEmail: '' };
  return res.json();
}

export function useExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: exportToSheets,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exportStatus'] });
    },
  });
}

export function useConfigureSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: configureSheet,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exportStatus'] });
    },
  });
}

export function useExportStatus() {
  return useQuery({
    queryKey: ['exportStatus'],
    queryFn: fetchExportStatus,
  });
}
