import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Transaction, AddressLabel } from '../hooks/useTransactions';
import { useAddressLabels, useSetAddressLabel } from '../hooks/useTransactions';
import { chainBadge } from '../utils/chains';
import { apiFetch } from '../utils/api';

interface Props {
  transactions: Transaction[];
  txBalanceMap?: Map<string, number>;
}

type SortKey = 'date' | 'token' | 'amount' | 'balance' | 'usd' | 'type';
type SortDir = 'asc' | 'desc';

const DEFAULT_KEY: SortKey = 'date';
const DEFAULT_DIR: SortDir = 'desc';

const STABLECOIN_RE = /^(usdt|usdc|busd|tusd|usdp|dai|frax|lusd|gusd|susd|eusd|usdd|fdusd|pyusd|usd\+)$/i;

function formatDateRu(d: Date): string {
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTimeRu(d: Date): string {
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function CommentCell({ tx }: { tx: Transaction }) {
  const [value, setValue] = useState(tx.comment || '');
  const [saving, setSaving] = useState(false);
  const savedRef = useRef(tx.comment || '');
  const qc = useQueryClient();

  // Sync with server data when React Query refreshes
  useEffect(() => {
    const serverVal = tx.comment || '';
    savedRef.current = serverVal;
    setValue(serverVal);
  }, [tx.comment]);

  const save = useCallback(async () => {
    const trimmed = value.trim();
    if (trimmed === savedRef.current) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/transactions/${tx.id}/comment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: trimmed }),
      });
      if (res.ok) {
        savedRef.current = trimmed;
        // Update React Query cache directly so navigation preserves the value
        qc.setQueryData<Transaction[]>(['transactions'], old =>
          old?.map(t => t.id === tx.id ? { ...t, comment: trimmed } : t)
        );
      }
    } catch { /* ignore */ }
    setSaving(false);
  }, [value, tx.id, qc]);

  return (
    <textarea
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) (e.target as HTMLTextAreaElement).blur(); }}
      placeholder="..."
      rows={2}
      title={value || undefined}
      className={`w-full min-w-[200px] resize-none rounded border border-transparent bg-transparent px-1.5 py-1 text-sm leading-snug text-gray-600 placeholder-gray-300 hover:border-gray-300 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 ${saving ? 'opacity-50' : ''}`}
    />
  );
}

function AddressCell({ address, chain, labels }: { address: string; chain: string; labels: Map<string, string> }) {
  const [editing, setEditing] = useState(false);
  const labelKey = `${chain}:${address}`;
  const existingLabel = labels.get(labelKey) || '';
  const [value, setValue] = useState(existingLabel);
  const mutation = useSetAddressLabel();

  useEffect(() => {
    setValue(labels.get(`${chain}:${address}`) || '');
  }, [labels, chain, address]);

  const save = () => {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed === existingLabel) return;
    mutation.mutate({ chain, address, label: trimmed });
  };

  if (!address) return <span className="text-xs text-gray-400">—</span>;

  return (
    <div className="min-w-[120px]">
      {existingLabel && !editing && (
        <div
          className="text-xs font-medium text-blue-600 cursor-pointer hover:text-blue-800 mb-0.5"
          onClick={() => setEditing(true)}
          title="Click to edit label"
        >
          {existingLabel}
        </div>
      )}
      {editing ? (
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false); }}
          autoFocus
          placeholder="Label..."
          className="w-full rounded border border-blue-400 bg-white px-1.5 py-0.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      ) : (
        <span
          className="block cursor-pointer break-all font-mono text-xs text-gray-400 hover:text-gray-600 transition-colors"
          onClick={() => setEditing(true)}
          title="Click to add label"
        >
          {address}
        </span>
      )}
    </div>
  );
}

export default function TransactionTable({ transactions, txBalanceMap }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_KEY);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_DIR);
  const [minUsd, setMinUsd] = useState(1);
  const [stableOnly, setStableOnly] = useState(false);
  const { data: addressLabelsRaw } = useAddressLabels();

  // Build a map chain:address -> label
  const addressLabels = useMemo(() => {
    const m = new Map<string, string>();
    if (addressLabelsRaw) {
      for (const al of addressLabelsRaw) {
        m.set(`${al.chain}:${al.address}`, al.label);
      }
    }
    return m;
  }, [addressLabelsRaw]);

  const isDefault = sortKey === DEFAULT_KEY && sortDir === DEFAULT_DIR;

  // Apply filters
  const filtered = useMemo(() => {
    return transactions.filter(tx => {
      if (!tx.value_usd || tx.value_usd < minUsd) return false;
      if (stableOnly && !STABLECOIN_RE.test(tx.token_symbol || '')) return false;
      return true;
    });
  }, [transactions, minUsd, stableOnly]);

  const totalReceived = filtered
    .filter(tx => tx.type === 'receive')
    .reduce((sum, tx) => sum + (tx.value_usd || 0), 0);

  const totalSent = filtered
    .filter(tx => tx.type === 'send')
    .reduce((sum, tx) => sum + (tx.value_usd || 0), 0);

  const toggle = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'token' || key === 'type' ? 'asc' : 'desc');
    }
  };

  const reset = () => { setSortKey(DEFAULT_KEY); setSortDir(DEFAULT_DIR); };

  const getBalance = (tx: Transaction): number | undefined =>
    txBalanceMap?.get(`${tx.hash}-${tx.token_address}`);

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'date': {
        const da = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const db = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        cmp = da - db;
        break;
      }
      case 'token': cmp = (a.token_symbol || '').localeCompare(b.token_symbol || ''); break;
      case 'amount': cmp = (parseFloat(a.value || '0')) - (parseFloat(b.value || '0')); break;
      case 'balance': cmp = (getBalance(a) || 0) - (getBalance(b) || 0); break;
      case 'usd': cmp = (a.value_usd || 0) - (b.value_usd || 0); break;
      case 'type': cmp = (a.type || '').localeCompare(b.type || ''); break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : '';

  const thClass = 'px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 cursor-pointer select-none hover:text-gray-700 transition-colors';

  return (
    <div>
      {/* Header row */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-lg font-semibold text-gray-900">Transactions</h2>
        <span className="text-sm text-gray-400">{filtered.length} results</span>
        {totalReceived > 0 && (
          <span className="text-sm font-medium text-green-600">
            +${totalReceived.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )}
        {totalSent > 0 && (
          <span className="text-sm font-medium text-orange-600">
            -${totalSent.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )}
        <button
          onClick={reset}
          title="Reset sorting"
          className={`transition-colors ${isDefault ? 'text-gray-300' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Filters */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            Don't show &lt; $
            <input
              type="number"
              min={0}
              step={0.1}
              value={minUsd}
              onChange={e => setMinUsd(parseFloat(e.target.value) || 0)}
              className="w-16 rounded border border-gray-300 px-1.5 py-1 text-xs text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-500 select-none">
            <input
              type="checkbox"
              checked={stableOnly}
              onChange={e => setStableOnly(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-400"
            />
            Stablecoins only
          </label>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <p className="text-gray-400">No transactions match current filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                <th className={thClass} onClick={() => toggle('date')}>Date{arrow('date')}</th>
                <th className={`${thClass}`}>Wallet</th>
                <th className={thClass} onClick={() => toggle('type')}>Type{arrow('type')}</th>
                <th className={thClass} onClick={() => toggle('token')}>Token{arrow('token')}</th>
                <th className={`${thClass} text-right`} onClick={() => toggle('amount')}>Amount{arrow('amount')}</th>
                <th className={`${thClass} text-right`} onClick={() => toggle('usd')}>USD{arrow('usd')}</th>
                <th className={`${thClass}`}>To / From</th>
                <th className={`${thClass} text-center`}>Tx</th>
                <th className={`${thClass} text-right`} onClick={() => toggle('balance')}>Balance after{arrow('balance')}</th>
                <th className={thClass}>Comment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map(tx => {
                const badge = chainBadge(tx.chain);
                const isReceive = tx.type === 'receive';
                const date = tx.timestamp ? new Date(tx.timestamp) : null;
                const amount = parseFloat(tx.value || '0');
                const balance = getBalance(tx);

                return (
                  <tr key={`${tx.hash}-${tx.token_address}`} className="hover:bg-gray-50 transition-colors">
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                      {date ? (
                        <>
                          <div>{formatDateRu(date)}</div>
                          <div className="text-xs text-gray-400">{formatTimeRu(date)}</div>
                        </>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${badge.classes}`}>
                          {badge.label}
                        </span>
                        <span className="text-gray-700 text-xs">
                          {tx.wallet_label || shortenAddr(tx.wallet_address)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-lg px-2 py-0.5 text-xs font-medium ${
                        isReceive
                          ? 'bg-green-50 text-green-700'
                          : 'bg-orange-50 text-orange-700'
                      }`}>
                        {isReceive ? 'Receive' : 'Send'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{tx.token_symbol}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className={isReceive ? 'text-green-600' : 'text-gray-700'}>
                        {isReceive ? '+' : '-'}{amount.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-xs text-gray-500">
                      {tx.value_usd && tx.value_usd > 0.01
                        ? `$${tx.value_usd.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : tx.value_usd && tx.value_usd > 0
                          ? '<$0.01'
                          : '—'}
                    </td>
                    <td className="max-w-[220px] px-4 py-3">
                      <AddressCell
                        address={isReceive ? tx.from_address : tx.to_address}
                        chain={tx.chain}
                        labels={addressLabels}
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      {tx.hash && (
                        <a
                          href={txExplorerUrl(tx.chain, tx.hash)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open in explorer"
                          className="inline-block text-gray-400 hover:text-blue-600 transition-colors"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                      {balance != null ? balance.toFixed(2) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <CommentCell tx={tx} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function txExplorerUrl(chain: string, hash: string): string {
  switch (chain) {
    case 'ethereum': return `https://etherscan.io/tx/${hash}`;
    case 'bsc': return `https://bscscan.com/tx/${hash}`;
    case 'tron': return `https://tronscan.org/#/transaction/${hash}`;
    case 'solana': return `https://solscan.io/tx/${hash}`;
    default: return `https://etherscan.io/tx/${hash}`;
  }
}

function shortenAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr || '—';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
