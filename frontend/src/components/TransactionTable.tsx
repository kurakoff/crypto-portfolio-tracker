import type { Transaction } from '../hooks/useTransactions';
import { chainBadge } from '../utils/chains';

interface Props {
  transactions: Transaction[];
}

export default function TransactionTable({ transactions }: Props) {
  if (transactions.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <p className="text-gray-400">No transactions found yet.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-100 bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Date</th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Wallet</th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Type</th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Token</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Amount</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">USD</th>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">To / From</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {transactions.map(tx => {
            const badge = chainBadge(tx.chain);
            const isReceive = tx.type === 'receive';
            const date = tx.timestamp ? new Date(tx.timestamp) : null;
            const amount = parseFloat(tx.value || '0');

            return (
              <tr key={`${tx.hash}-${tx.token_address}`} className="hover:bg-gray-50 transition-colors">
                <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                  {date ? (
                    <>
                      <div>{date.toLocaleDateString()}</div>
                      <div className="text-xs text-gray-400">{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
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
                    ? `$${tx.value_usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : tx.value_usd && tx.value_usd > 0
                      ? `<$0.01`
                      : '—'}
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-gray-400">
                    {shortenAddr(isReceive ? tx.from_address : tx.to_address)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
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
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
