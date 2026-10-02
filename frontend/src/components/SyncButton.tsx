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
    <div className="flex flex-col items-end" title={title}>
      <button
        onClick={() => force.mutate()}
        disabled={running}
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:border-gray-300 transition-colors disabled:opacity-60"
      >
        <span className={`inline-block h-3.5 w-3.5 rounded-full border-2 border-blue-600 border-t-transparent ${running ? 'animate-spin' : 'opacity-0 w-0 border-0'}`} />
        {running ? 'Syncing…' : 'Refresh'}
      </button>
      {status && !running && (
        <span className={`mt-0.5 text-[10px] ${failed > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
          synced {ago(status.lastRunAt)}{failed > 0 ? `, ${failed} failed` : ''}
        </span>
      )}
    </div>
  );
}
