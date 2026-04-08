import { useExport, useExportStatus, useConfigureSheet, useDisconnectSheet } from '../hooks/useExport';
import { useState, useRef, useEffect } from 'react';
import { copyToClipboard } from '../utils/clipboard';

interface ExportData {
  totalValue?: number;
  totalReceived?: number;
  totalSent?: number;
  dateFrom?: string;
  dateTo?: string;
  exportedAt?: string;
  tokens: Array<{ symbol: string; name: string; balance: string; priceUsd: number; valueUsd: number }>;
  transactions: Array<{
    timestamp: string; wallet_label?: string; wallet_address: string; chain: string;
    type: string; token_symbol: string; value: string; value_usd: number;
    balance?: string; from_address: string; to_address: string; hash: string;
    comment?: string;
  }>;
}

interface Props {
  exportData?: ExportData;
}

export default function ExportButton({ exportData }: Props) {
  const exportMutation = useExport();
  const configureMutation = useConfigureSheet();
  const disconnectMutation = useDisconnectSheet();
  const { data: status } = useExportStatus();
  const [lastResult, setLastResult] = useState<{ url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  const isConfigured = status?.configured;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleExport = () => {
    if (!isConfigured) {
      setShowSetup(true);
      return;
    }
    setError(null);
    setLastResult(null);
    exportMutation.mutate(exportData, {
      onSuccess: (data) => {
        setLastResult({ url: data.spreadsheetUrl });
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
        exportMutation.mutate(exportData, {
          onSuccess: (data) => {
            setLastResult({ url: data.spreadsheetUrl });
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

  const handleDisconnect = () => {
    setLastResult(null);
    setError(null);
    setShowMenu(false);
    disconnectMutation.mutate();
  };

  return (
    <>
      <div className="flex items-center gap-1.5">
        {/* Link to sheet — compact icon */}
        {isConfigured && status?.spreadsheet_url && (
          <a
            href={status.spreadsheet_url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open Google Sheet"
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-green-600 transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M14.727 6.727H14V0H4.91c-.905 0-1.637.732-1.637 1.636v20.728c0 .904.732 1.636 1.636 1.636h14.182c.904 0 1.636-.732 1.636-1.636V6.727h-4.727zM7.09 18.545h2.455v1.636H7.09v-1.636zm0-3.272h2.455v1.636H7.09v-1.636zm0-3.273h2.455v1.636H7.09V12zm4.91 6.545h2.454v1.636H12v-1.636zm0-3.272h2.454v1.636H12v-1.636zm0-3.273h2.454v1.636H12V12zm4.91 6.545h1.635v1.636H16.91v-1.636zm0-3.272h1.635v1.636H16.91v-1.636zm0-3.273h1.635v1.636H16.91V12zM14.727 0l6.364 6.727h-6.364V0z"/>
            </svg>
          </a>
        )}

        {/* After-export link */}
        {lastResult && (
          <a
            href={lastResult.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Open Google Sheet"
            className="rounded-lg p-2 text-green-500 hover:bg-green-50 hover:text-green-600 transition-colors animate-pulse"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </a>
        )}

        {/* Export button */}
        <button
          onClick={handleExport}
          disabled={exportMutation.isPending}
          className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          {exportMutation.isPending ? 'Exporting...' : 'Export'}
        </button>

        {/* Settings gear with dropdown */}
        {isConfigured && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              title="Export settings"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            {showMenu && (
              <div className="absolute right-0 z-20 mt-1 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Google Sheet</p>
                <a
                  href={status.spreadsheet_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mb-2 block truncate rounded-lg bg-gray-50 px-3 py-2 text-xs text-blue-600 hover:bg-gray-100 transition-colors"
                >
                  {status.spreadsheet_url}
                </a>
                <button
                  onClick={handleDisconnect}
                  disabled={disconnectMutation.isPending}
                  className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  {disconnectMutation.isPending ? 'Disconnecting...' : 'Disconnect sheet'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

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
                  onClick={() => copyToClipboard(status?.serviceAccountEmail || '')}
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
    </>
  );
}
