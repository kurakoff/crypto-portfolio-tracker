import { useState, useMemo } from 'react';
import { usePortfolio } from '../hooks/usePortfolio';
import { useTransactions } from '../hooks/useTransactions';
import TransactionTable from '../components/TransactionTable';
import ExportButton from '../components/ExportButton';
import DateRangeFilter, { makePresetRange, type DateRange } from '../components/DateRangeFilter';

export default function Dashboard() {
  const { data: portfolios, isLoading, error } = usePortfolio();
  const { data: transactions, isLoading: txLoading } = useTransactions();
  const [dateRange, setDateRange] = useState<DateRange>(() => makePresetRange(28));

  // All wallet IDs
  const allWalletIds = useMemo(() => {
    if (!portfolios) return new Set<number>();
    return new Set(portfolios.map(p => p.wallet.id));
  }, [portfolios]);

  // Aggregate tokens from all wallets (for export)
  const aggregatedTokens = useMemo(() => {
    if (!portfolios) return [];
    const allTokens = portfolios.flatMap(p => p.tokens);
    const tokenMap = new Map<string, typeof allTokens[0]>();
    for (const token of allTokens) {
      const key = token.address;
      const existing = tokenMap.get(key);
      if (existing) {
        tokenMap.set(key, {
          ...existing,
          balanceFormatted: existing.balanceFormatted + token.balanceFormatted,
          valueUsd: existing.valueUsd + token.valueUsd,
        });
      } else {
        tokenMap.set(key, { ...token });
      }
    }
    return Array.from(tokenMap.values());
  }, [portfolios]);

  // Filter transactions by date range
  const filteredTxs = useMemo(() => {
    if (!transactions) return [];
    return transactions.filter(tx => {
      if (!tx.timestamp) return false;
      if (!allWalletIds.has(tx.wallet_id)) return false;
      const ts = new Date(tx.timestamp).getTime();
      return ts >= dateRange.from.getTime() && ts <= dateRange.to.getTime();
    });
  }, [transactions, dateRange, allWalletIds]);

  // Transaction totals
  const totalReceived = useMemo(() =>
    filteredTxs.filter(tx => tx.type === 'receive').reduce((sum, tx) => sum + (tx.value_usd || 0), 0),
    [filteredTxs]);
  const totalSent = useMemo(() =>
    filteredTxs.filter(tx => tx.type === 'send').reduce((sum, tx) => sum + (tx.value_usd || 0), 0),
    [filteredTxs]);

  // Compute balance-after-transaction map using current portfolio as anchor
  const txBalanceMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!transactions || !portfolios) return map;

    // Current token balances: "walletId-SYMBOL" -> balanceFormatted
    const currentBal = new Map<string, number>();
    for (const p of portfolios) {
      for (const token of p.tokens) {
        currentBal.set(`${p.wallet.id}-${token.symbol.toUpperCase()}`, token.balanceFormatted);
      }
    }

    // Group ALL transactions by wallet+token
    const groups = new Map<string, typeof transactions>();
    for (const tx of transactions) {
      const key = `${tx.wallet_id}-${(tx.token_symbol || '').toUpperCase()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(tx);
    }

    for (const [groupKey, txs] of groups) {
      const sorted = [...txs].sort((a, b) => {
        const da = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const db = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return db - da;
      });
      let running = currentBal.get(groupKey) || 0;
      for (const tx of sorted) {
        map.set(`${tx.hash}-${tx.token_address}`, running);
        const amount = parseFloat(tx.value || '0');
        if (tx.type === 'receive') running -= amount;
        else if (tx.type === 'send') running += amount;
      }
    }
    return map;
  }, [transactions, portfolios]);

  const totalValue = portfolios?.reduce((sum, p) => sum + p.totalValueUsd, 0) ?? 0;

  // Prepare export data
  const exportData = useMemo(() => ({
    totalValue,
    totalReceived,
    totalSent,
    dateFrom: dateRange.from.toLocaleDateString('ru-RU'),
    dateTo: dateRange.to.toLocaleDateString('ru-RU'),
    exportedAt: new Date().toLocaleString('ru-RU'),
    tokens: aggregatedTokens.map(t => ({
      symbol: t.symbol,
      name: t.name,
      balance: t.balanceFormatted.toLocaleString('ru-RU', { maximumFractionDigits: 6 }),
      priceUsd: t.priceUsd,
      valueUsd: t.valueUsd,
    })),
    transactions: filteredTxs.map(tx => {
      const bal = txBalanceMap.get(`${tx.hash}-${tx.token_address}`);
      return {
        timestamp: tx.timestamp ? new Date(tx.timestamp).toLocaleString('ru-RU') : '',
        wallet_label: tx.wallet_label || undefined,
        wallet_address: tx.wallet_address,
        chain: tx.chain,
        type: tx.type,
        token_symbol: tx.token_symbol,
        value: parseFloat(tx.value || '0').toFixed(2),
        value_usd: tx.value_usd,
        balance: bal != null ? bal.toFixed(2) : '',
        from_address: tx.from_address,
        to_address: tx.to_address,
        hash: tx.hash,
      };
    }),
  }), [aggregatedTokens, filteredTxs, totalValue, totalReceived, totalSent, dateRange, txBalanceMap]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-600">
        Failed to load portfolio: {error.message}
      </div>
    );
  }

  if (!portfolios || portfolios.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="text-lg text-gray-500">No wallets added yet.</p>
        <p className="mt-1 text-sm text-gray-400">
          Go to <a href="/wallets" className="text-blue-600 hover:underline">Wallets</a> to add one.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Portfolio</h1>
          <p className="mt-1 text-3xl font-bold text-gray-900">
            ${totalValue.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <DateRangeFilter value={dateRange} onChange={setDateRange} />
          <ExportButton exportData={exportData} />
        </div>
      </div>

      {/* Transactions */}
      {txLoading ? (
        <div className="flex items-center justify-center py-10">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : (
        <TransactionTable transactions={filteredTxs} txBalanceMap={txBalanceMap} />
      )}
    </div>
  );
}
