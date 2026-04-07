import { useState } from 'react';
import type { TokenBalance } from '../hooks/usePortfolio';

interface Props {
  tokens: TokenBalance[];
  totalValue?: number;
}

type SortKey = 'symbol' | 'balance' | 'price' | 'value';
type SortDir = 'asc' | 'desc';

const DEFAULT_KEY: SortKey = 'value';
const DEFAULT_DIR: SortDir = 'desc';

export default function TokenTable({ tokens, totalValue }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_KEY);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_DIR);

  const isDefault = sortKey === DEFAULT_KEY && sortDir === DEFAULT_DIR;

  const toggle = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'symbol' ? 'asc' : 'desc');
    }
  };

  const reset = () => { setSortKey(DEFAULT_KEY); setSortDir(DEFAULT_DIR); };

  const sorted = [...tokens].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'symbol': cmp = a.symbol.localeCompare(b.symbol); break;
      case 'balance': cmp = a.balanceFormatted - b.balanceFormatted; break;
      case 'price': cmp = a.priceUsd - b.priceUsd; break;
      case 'value': cmp = a.valueUsd - b.valueUsd; break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : '';

  const thClass = 'px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 cursor-pointer select-none hover:text-gray-700 transition-colors';

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-lg font-semibold text-gray-900">All Tokens</h2>
        {totalValue !== undefined && (
          <span className="text-sm font-medium text-gray-500">
            ${totalValue.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
              <th className={thClass} onClick={() => toggle('symbol')}>Token{arrow('symbol')}</th>
              <th className={`${thClass} text-right`} onClick={() => toggle('balance')}>Balance{arrow('balance')}</th>
              <th className={`${thClass} text-right`} onClick={() => toggle('price')}>Price{arrow('price')}</th>
              <th className={`${thClass} text-right`} onClick={() => toggle('value')}>Value{arrow('value')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map(token => (
              <tr key={token.address} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <div>
                    <p className="font-medium text-gray-900">{token.symbol}</p>
                    <p className="text-xs text-gray-400">{token.name}</p>
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                  {token.balanceFormatted.toLocaleString('ru-RU', { maximumFractionDigits: 6 })}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                  {token.priceUsd > 0
                    ? `$${token.priceUsd.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`
                    : '-'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900">
                  {token.valueUsd > 0
                    ? `$${token.valueUsd.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`
                    : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
