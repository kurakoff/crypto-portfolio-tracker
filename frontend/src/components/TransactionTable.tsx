import { useState } from 'react';
import type { Transaction } from '../hooks/useTransactions';
import { chainBadge } from '../utils/chains';
import { copyToClipboard } from '../utils/clipboard';

interface Props {
  transactions: Transaction[];
}

type SortKey = 'date' | 'token' | 'amount' | 'usd' | 'type';
type SortDir = 'asc' | 'desc';

const DEFAULT_KEY: SortKey = 'date';
const DEFAULT_DIR: SortDir = 'desc';

function formatDateRu(d: Date): string {
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTimeRu(d: Date): string {
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export default function TransactionTable({ transactions }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_KEY);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_DIR);
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);

  const isDefault = sortKey === DEFAULT_KEY && sortDir === DEFAULT_DIR;

  const totalReceived = transactions
    .filter(tx => tx.type === 'receive')
    .reduce((sum, tx) => sum + (tx.value_usd || 0), 0);

  const totalSent = transactions
    .filter(tx => tx.type === 'send')
    .reduce((sum, tx) => sum + (tx.value_usd || 0), 0);

  if (transactions.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <p className="text-gray-400">No transactions found for this period.</p>
      </div>
    );
  }

  const toggle = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'token' || key === 'type' ? 'asc' : 'desc');
    }
  };

  const reset = () => { setSortKey(DEFAULT_KEY); setSortDir(DEFAULT_DIR); };

  const sorted = [...transactions].sort((a, b) => {
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
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-lg font-semibold text-gray-900">Transactions</h2>
        <span className="text-sm text-gray-400">{transactions.length} results</span>
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
      </div>
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
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map(tx => {
              const badge = chainBadge(tx.chain);
              const isReceive = tx.type === 'receive';
              const date = tx.timestamp ? new Date(tx.timestamp) : null;
              const amount = parseFloat(tx.value || '0');

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
                      {isReceive ? '+' : '-'}{formatAmount(amount)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-xs text-gray-500">
                    {tx.value_usd && tx.value_usd > 0.01
                      ? `$${tx.value_usd.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : tx.value_usd && tx.value_usd > 0
                        ? '<$0.01'
                        : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const addr = isReceive ? tx.from_address : tx.to_address;
                      const key = `${tx.hash}-${addr}`;
                      const isCopied = copiedAddr === key;
                      return isCopied ? (
                        <span className="text-xs font-medium text-green-600">Copied!</span>
                      ) : (
                        <span
                          className="cursor-pointer font-mono text-xs text-gray-400 hover:text-gray-600 transition-colors"
                          onClick={() => {
                            copyToClipboard(addr);
                            setCopiedAddr(key);
                            setTimeout(() => setCopiedAddr(null), 3000);
                          }}
                          title="Click to copy"
                        >
                          {shortenAddr(addr)}
                        </span>
                      );
                    })()}
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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

function formatAmount(n: number): string {
  if (n === 0) return '0';
  if (n < 0.0001) return n.toExponential(2);
  if (n < 1) return n.toFixed(6);
  if (n < 1000) return n.toFixed(4);
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}
