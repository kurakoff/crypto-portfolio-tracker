import { useState } from 'react';
import { useAddWallet } from '../hooks/useWallets';

interface Props {
  open: boolean;
  onClose: () => void;
}

const CHAINS = [
  {
    id: 'ethereum',
    name: 'Ethereum',
    standard: 'ERC-20',
    color: 'border-blue-300 bg-blue-50 text-blue-700',
    selectedColor: 'border-blue-500 bg-blue-50 ring-2 ring-blue-200',
    placeholder: '0x...',
  },
  {
    id: 'bsc',
    name: 'BNB Smart Chain',
    standard: 'BEP-20',
    color: 'border-yellow-300 bg-yellow-50 text-yellow-700',
    selectedColor: 'border-yellow-500 bg-yellow-50 ring-2 ring-yellow-200',
    placeholder: '0x...',
  },
  {
    id: 'tron',
    name: 'Tron',
    standard: 'TRC-20',
    color: 'border-red-300 bg-red-50 text-red-700',
    selectedColor: 'border-red-500 bg-red-50 ring-2 ring-red-200',
    placeholder: 'T...',
  },
  {
    id: 'solana',
    name: 'Solana',
    standard: 'SPL',
    color: 'border-purple-300 bg-purple-50 text-purple-700',
    selectedColor: 'border-purple-500 bg-purple-50 ring-2 ring-purple-200',
    placeholder: 'Base58 address',
  },
] as const;

export default function AddWalletModal({ open, onClose }: Props) {
  const [address, setAddress] = useState('');
  const [chain, setChain] = useState<string>('ethereum');
  const [label, setLabel] = useState('');
  const addWallet = useAddWallet();

  if (!open) return null;

  const selectedChain = CHAINS.find(c => c.id === chain) || CHAINS[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addWallet.mutate(
      { address, chain, label: label || undefined },
      {
        onSuccess: () => {
          setAddress('');
          setLabel('');
          onClose();
        },
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
        <h2 className="mb-5 text-lg font-semibold text-gray-900">Add Wallet</h2>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Chain selector */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-600">Network</label>
            <div className="grid grid-cols-2 gap-2">
              {CHAINS.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setChain(c.id)}
                  className={`rounded-xl border p-3 text-left transition-all ${
                    chain === c.id ? c.selectedColor : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <div className={`text-sm font-semibold ${chain === c.id ? '' : 'text-gray-800'}`}>
                    {c.name}
                  </div>
                  <div className={`text-xs ${chain === c.id ? 'opacity-70' : 'text-gray-400'}`}>
                    {c.standard}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">Address</label>
            <input
              type="text"
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder={selectedChain.placeholder}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-gray-800 placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              required
            />
          </div>

          {/* Label */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">Label (optional)</label>
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="My main wallet"
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-gray-800 placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {addWallet.isError && (
            <p className="text-sm text-red-600">{addWallet.error.message}</p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addWallet.isPending}
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {addWallet.isPending ? 'Adding...' : 'Add Wallet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
