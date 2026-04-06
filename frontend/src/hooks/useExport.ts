import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface ExportResult {
  spreadsheetUrl: string;
  newRows: number;
  totalRows: number;
}

interface ExportStatus {
  id: number;
  spreadsheet_id: string;
  spreadsheet_url: string;
  last_export_at: string;
  rows_exported: number;
}

async function exportToSheets(): Promise<ExportResult> {
  const res = await fetch('/api/export/sheets', { method: 'POST' });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to export');
  }
  return res.json();
}

async function fetchExportStatus(): Promise<ExportStatus | null> {
  const res = await fetch('/api/export/status');
  if (!res.ok) return null;
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

export function useExportStatus() {
  return useQuery({
    queryKey: ['exportStatus'],
    queryFn: fetchExportStatus,
  });
}
