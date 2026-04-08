import { useState, useMemo, useCallback, FormEvent } from 'react';
import { useWallets, useDeleteWallet, useUpdateWallet } from '../hooks/useWallets';
import { usePortfolio } from '../hooks/usePortfolio';
import AddWalletModal from '../components/AddWalletModal';
import WalletCard from '../components/WalletCard';
import TokenTable from '../components/TokenTable';
import EditableLabel from '../components/EditableLabel';
import { chainBadge } from '../utils/chains';
import { apiFetch } from '../utils/api';
import { useAuth } from '../context/AuthContext';

export default function WalletManager() {
  const [modalOpen, setModalOpen] = useState(false);
  const { data: wallets, isLoading } = useWallets();
  const { data: portfolios, isLoading: portfolioLoading } = usePortfolio();
  const deleteMutation = useDeleteWallet();
  const updateMutation = useUpdateWallet();
  const [disabledWallets, setDisabledWallets] = useState<Set<number>>(new Set());
  const { logout } = useAuth();

  // Change password state
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [pwdMsg, setPwdMsg] = useState('');
  const [pwdError, setPwdError] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwdMsg('');
    setPwdLoading(true);
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: currentPwd, newPassword: newPwd }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to change password');
      }
      setPwdMsg('Password changed successfully');
      setPwdError(false);
      setCurrentPwd('');
      setNewPwd('');
    } catch (err: unknown) {
      setPwdMsg(err instanceof Error ? err.message : 'Failed');
      setPwdError(true);
    } finally {
      setPwdLoading(false);
    }
  };

  const toggleWallet = useCallback((id: number) => {
    setDisabledWallets(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const activePortfolios = useMemo(() => {
    if (!portfolios) return [];
    return portfolios.filter(p => !disabledWallets.has(p.wallet.id));
  }, [portfolios, disabledWallets]);

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

  const totalValue = activePortfolios.reduce((sum, p) => sum + p.totalValueUsd, 0);

  return (
    <>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-gray-900">Wallets</h1>
          <button
            onClick={() => setModalOpen(true)}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            + Add Wallet
          </button>
        </div>

        {/* Wallet management list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : !wallets || wallets.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-10 text-center shadow-sm">
            <p className="text-gray-500">No wallets added yet.</p>
            <p className="mt-1 text-sm text-gray-400">Click "Add Wallet" to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {wallets.map(wallet => {
              const badge = chainBadge(wallet.chain);
              return (
                <div
                  key={wallet.id}
                  className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-lg border px-2 py-0.5 text-xs font-bold uppercase ${badge.classes}`}>
                        {badge.label}
                      </span>
                      <EditableLabel
                        value={wallet.label || ''}
                        onSave={label => updateMutation.mutate({ id: wallet.id, label })}
                      />
                    </div>
                    <p className="mt-1 font-mono text-xs text-gray-400">{wallet.address}</p>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm('Delete this wallet?')) {
                        deleteMutation.mutate(wallet.id);
                      }
                    }}
                    className="rounded-xl border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Wallet balance cards */}
        {portfolios && portfolios.length > 0 && (
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
        )}

        {/* All Tokens table */}
        {aggregatedTokens.length > 0 && (
          <TokenTable tokens={aggregatedTokens} totalValue={totalValue} />
        )}

        {/* Change Password */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Change Password</h2>
          <form onSubmit={handleChangePassword} className="max-w-sm space-y-3">
            {pwdMsg && (
              <div className={`rounded-lg px-4 py-2 text-sm ${pwdError ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                {pwdMsg}
              </div>
            )}
            <input
              type="password"
              placeholder="Current password"
              value={currentPwd}
              onChange={e => setCurrentPwd(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="password"
              placeholder="New password"
              value={newPwd}
              onChange={e => setNewPwd(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={pwdLoading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {pwdLoading ? 'Saving...' : 'Save'}
            </button>
          </form>
        </div>

        {/* Logout */}
        <div className="flex justify-end">
          <button
            onClick={logout}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Sign Out
          </button>
        </div>
      </div>
      <AddWalletModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
