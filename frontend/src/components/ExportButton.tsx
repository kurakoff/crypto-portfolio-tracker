import { useExport, useExportStatus, useConfigureSheet } from '../hooks/useExport';
import { useState } from 'react';

export default function ExportButton() {
  const exportMutation = useExport();
  const configureMutation = useConfigureSheet();
  const { data: status } = useExportStatus();
  const [lastResult, setLastResult] = useState<{ url: string; newRows: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');

  const isConfigured = status?.configured;

  const handleExport = () => {
    if (!isConfigured) {
      setShowSetup(true);
      return;
    }
    setError(null);
    setLastResult(null);
    exportMutation.mutate(undefined, {
      onSuccess: (data) => {
        setLastResult({ url: data.spreadsheetUrl, newRows: data.newRows });
        setError(null);
      },
      onError: (err: any) => {
        setError(err?.message || 'Export failed');
      },
    });
  };

  const handleConfigure = () => {
    if (!sheetUrl.trim()) return;
    setError(null);
    configureMutation.mutate(sheetUrl.trim(), {
      onSuccess: () => {
        setShowSetup(false);
        setSheetUrl('');
        // Auto-export after connecting
        exportMutation.mutate(undefined, {
          onSuccess: (data) => {
            setLastResult({ url: data.spreadsheetUrl, newRows: data.newRows });
          },
          onError: (err: any) => {
            setError(err?.message || 'Export failed');
          },
        });
      },
      onError: (err: any) => {
        setError(err?.message || 'Failed to configure');
      },
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-3">
        {/* Link to existing sheet */}
        {status?.spreadsheet_url && (
          <a
            href={status.spreadsheet_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline"
          >
            {status.last_export_at
              ? `Last export: ${new Date(status.last_export_at).toLocaleDateString()} (${status.rows_exported} rows)`
              : 'Open Sheet'}
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

      {/* Success */}
      {lastResult && (
        <a
          href={lastResult.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 shadow-sm hover:bg-green-100"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Exported {lastResult.newRows} rows — Open Google Sheet
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Setup modal */}
      {showSetup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowSetup(false)}>
          <div className="mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900">Connect Google Sheet</h3>
            <div className="mt-4 space-y-3 text-sm text-gray-600">
              <p>1. Create a new Google Sheet</p>
              <p>2. Click <strong>Share</strong> and add this email as <strong>Editor</strong>:</p>
              <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
                <code className="flex-1 break-all text-xs text-gray-800">
                  {status?.serviceAccountEmail || 'loading...'}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(status?.serviceAccountEmail || '')}
                  className="shrink-0 rounded bg-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-300"
                >
                  Copy
                </button>
              </div>
              <p>3. Paste the sheet URL below:</p>
            </div>

            <input
              type="text"
              value={sheetUrl}
              onChange={e => setSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowSetup(false)}
                className="rounded-lg px-4 py-2 text-sm text-gray-500 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfigure}
                disabled={!sheetUrl.trim() || configureMutation.isPending}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {configureMutation.isPending ? 'Saving...' : 'Connect & Export'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
