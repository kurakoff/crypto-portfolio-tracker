import { useSyncStatus, useForceSync } from '../hooks/useTransactions';

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/** Manual "sync all wallets now" with background sync status underneath. */
export default function SyncButton() {
  const { data: status } = useSyncStatus();
  const force = useForceSync();
  const running = !!status?.running || force.isPending;
  const failed = status?.lastFailed || 0;

  const title = status
    ? `Last sync: ${ago(status.lastRunAt)} (${status.lastSynced} synced, ${failed} failed, ${Math.round(status.lastRunMs / 1000)}s)` +
      (failed > 0 ? `\nFailed: ${status.failedWallets.join(', ')}` : '')
    : '';

  return (
    <div className="relative" title={title}>
      <button
        onClick={() => force.mutate()}
        disabled={running}
        className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-60"
      >
        <svg className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {running ? 'Syncing…' : 'Refresh'}
      </button>
      {status && !running && (
        <span className={`absolute right-0 top-full mt-0.5 whitespace-nowrap text-[10px] ${failed > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
          synced {ago(status.lastRunAt)}{failed > 0 ? `, ${failed} failed` : ''}
        </span>
      )}
    </div>
  );
}
