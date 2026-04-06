import { usePortfolio } from '../hooks/usePortfolio';
import { useTransactions } from '../hooks/useTransactions';
import WalletCard from '../components/WalletCard';
import TokenTable from '../components/TokenTable';
import TransactionTable from '../components/TransactionTable';
import ExportButton from '../components/ExportButton';

export default function Dashboard() {
  const { data: portfolios, isLoading, error } = usePortfolio();
  const { data: transactions, isLoading: txLoading } = useTransactions();

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

  const totalValue = portfolios.reduce((sum, p) => sum + p.totalValueUsd, 0);
  const allTokens = portfolios.flatMap(p => p.tokens);

  // Aggregate tokens by address
  const tokenMap = new Map<string, typeof allTokens[0]>();
  for (const token of allTokens) {
    const key = `${token.address}`;
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
  const aggregatedTokens = Array.from(tokenMap.values());

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Portfolio</h1>
          <p className="mt-1 text-3xl font-bold text-gray-900">
            ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <ExportButton />
      </div>

      {/* Wallet Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {portfolios.map(p => (
          <WalletCard key={p.wallet.id} portfolio={p} />
        ))}
      </div>

      {/* All Tokens Table */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">All Tokens</h2>
        <TokenTable tokens={aggregatedTokens} />
      </div>

      {/* Transactions */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Recent Transactions</h2>
        {txLoading ? (
          <div className="flex items-center justify-center py-10">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : (
          <TransactionTable transactions={transactions || []} />
        )}
      </div>
    </div>
  );
}
