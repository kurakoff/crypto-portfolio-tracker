import { useState, useMemo, useCallback } from 'react';
import { usePortfolio } from '../hooks/usePortfolio';
import { useTransactions } from '../hooks/useTransactions';
import WalletCard from '../components/WalletCard';
import TokenTable from '../components/TokenTable';
import TransactionTable from '../components/TransactionTable';
import ExportButton from '../components/ExportButton';
import DateRangeFilter, { makePresetRange, type DateRange } from '../components/DateRangeFilter';

export default function Dashboard() {
  const { data: portfolios, isLoading, error } = usePortfolio();
  const { data: transactions, isLoading: txLoading } = useTransactions();
  const [dateRange, setDateRange] = useState<DateRange>(() => makePresetRange(28));
  const [disabledWallets, setDisabledWallets] = useState<Set<number>>(new Set());

  const toggleWallet = useCallback((id: number) => {
    setDisabledWallets(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Active portfolios (checkbox enabled)
  const activePortfolios = useMemo(() => {
    if (!portfolios) return [];
    return portfolios.filter(p => !disabledWallets.has(p.wallet.id));
  }, [portfolios, disabledWallets]);

  // Active wallet IDs for transaction filtering
  const activeWalletIds = useMemo(() => {
    return new Set(activePortfolios.map(p => p.wallet.id));
  }, [activePortfolios]);

  // Aggregate tokens only from active wallets
  const aggregatedTokens = useMemo(() => {
    const allTokens = activePortfolios.flatMap(p => p.tokens);
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
  }, [activePortfolios]);

  // Filter transactions by date range + active wallets
  const filteredTxs = useMemo(() => {
    if (!transactions) return [];
    return transactions.filter(tx => {
      if (!tx.timestamp) return false;
      if (!activeWalletIds.has(tx.wallet_id)) return false;
      const ts = new Date(tx.timestamp).getTime();
      return ts >= dateRange.from.getTime() && ts <= dateRange.to.getTime();
    });
  }, [transactions, dateRange, activeWalletIds]);

  // Transaction totals
  const totalReceived = useMemo(() =>
    filteredTxs.filter(tx => tx.type === 'receive').reduce((sum, tx) => sum + (tx.value_usd || 0), 0),
    [filteredTxs]);
  const totalSent = useMemo(() =>
    filteredTxs.filter(tx => tx.type === 'send').reduce((sum, tx) => sum + (tx.value_usd || 0), 0),
    [filteredTxs]);

  // Prepare export data
  const exportData = useMemo(() => ({
    totalValue: activePortfolios.reduce((sum, p) => sum + p.totalValueUsd, 0),
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
    transactions: filteredTxs.map(tx => ({
      timestamp: tx.timestamp ? new Date(tx.timestamp).toLocaleString('ru-RU') : '',
      wallet_label: tx.wallet_label || undefined,
      wallet_address: tx.wallet_address,
      chain: tx.chain,
      type: tx.type,
      token_symbol: tx.token_symbol,
      value: tx.value,
      value_usd: tx.value_usd,
      from_address: tx.from_address,
      to_address: tx.to_address,
      hash: tx.hash,
    })),
  }), [aggregatedTokens, filteredTxs, activePortfolios, totalReceived, totalSent, dateRange]);

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

  const totalValue = activePortfolios.reduce((sum, p) => sum + p.totalValueUsd, 0);

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

      {/* Wallet Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {portfolios.map(p => (
          <WalletCard
            key={p.wallet.id}
            portfolio={p}
            active={!disabledWallets.has(p.wallet.id)}
            onToggle={toggleWallet}
          />
        ))}
      </div>

      {/* All Tokens Table */}
      <TokenTable tokens={aggregatedTokens} totalValue={totalValue} />

      {/* Transactions */}
      {txLoading ? (
        <div className="flex items-center justify-center py-10">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : (
        <TransactionTable transactions={filteredTxs} />
      )}
    </div>
  );
}
