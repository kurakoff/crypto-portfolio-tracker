import { useState } from 'react';
import { useWallets, useDeleteWallet } from '../hooks/useWallets';
import AddWalletModal from '../components/AddWalletModal';
import { chainBadge } from '../utils/chains';

export default function WalletManager() {
  const [modalOpen, setModalOpen] = useState(false);
  const { data: wallets, isLoading } = useWallets();
  const deleteMutation = useDeleteWallet();

  return (
    <>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Wallets</h1>
        <button
          onClick={() => setModalOpen(true)}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Add Wallet
        </button>
      </div>

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
                    {wallet.label && (
                      <span className="text-sm font-medium text-gray-900">{wallet.label}</span>
                    )}
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

      </div>
      <AddWalletModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
