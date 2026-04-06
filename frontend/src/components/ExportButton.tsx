import { useExport, useExportStatus } from '../hooks/useExport';
import { useState } from 'react';

export default function ExportButton() {
  const exportMutation = useExport();
  const { data: status } = useExportStatus();
  const [lastResult, setLastResult] = useState<{ url: string; newRows: number } | null>(null);

  const handleExport = () => {
    exportMutation.mutate(undefined, {
      onSuccess: (data) => {
        setLastResult({ url: data.spreadsheetUrl, newRows: data.newRows });
      },
    });
  };

  return (
    <div className="flex items-center gap-3">
      {/* Export status */}
      {status && (
        <a
          href={status.spreadsheet_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:underline"
        >
          Last export: {new Date(status.last_export_at).toLocaleDateString()}
          {' '}({status.rows_exported} rows)
        </a>
      )}

      {/* Success toast */}
      {lastResult && (
        <a
          href={lastResult.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-green-50 border border-green-200 px-3 py-1.5 text-xs text-green-700 hover:bg-green-100"
        >
          Exported {lastResult.newRows} new rows — Open Sheet
        </a>
      )}

      <button
        onClick={handleExport}
        disabled={exportMutation.isPending}
        className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
      >
        {exportMutation.isPending ? 'Exporting...' : 'Export to Sheets'}
      </button>
    </div>
  );
}
