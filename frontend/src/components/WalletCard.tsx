import { useState } from 'react';
import type { WalletPortfolio } from '../hooks/usePortfolio';
import { useUpdateWallet } from '../hooks/useWallets';
import { chainBadge } from '../utils/chains';
import { copyToClipboard } from '../utils/clipboard';
import EditableLabel from './EditableLabel';

interface Props {
  portfolio: WalletPortfolio;
  active: boolean;
  onToggle: (id: number) => void;
}

export default function WalletCard({ portfolio, active, onToggle }: Props) {
  const { wallet, totalValueUsd, tokens } = portfolio;
  const badge = chainBadge(wallet.chain);
  const updateMutation = useUpdateWallet();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const visibleTokens = expanded ? tokens : tokens.slice(0, 5);
  const hiddenCount = tokens.length - 5;

  const copyAddress = () => {
    copyToClipboard(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`relative rounded-xl border bg-white p-5 shadow-sm transition-opacity ${active ? 'border-gray-200' : 'border-gray-200 opacity-50'}`}>
      {/* Checkbox temporarily disabled
      <button
        onClick={() => onToggle(wallet.id)}
        title={active ? 'Exclude from totals' : 'Include in totals'}
        className="absolute right-3.5 top-3.5 group"
      >
        <div className={`flex h-5 w-5 items-center justify-center rounded-md border-2 transition-all duration-200 ${
          active
            ? 'border-blue-500 bg-blue-500'
            : 'border-gray-300 bg-white group-hover:border-gray-400'
        }`}>
          {active && (
            <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      </button>
      */}

      <div className="mb-3 flex items-center justify-between pr-6">
        <div className="flex items-center gap-2">
          <span className={`rounded-lg border px-2 py-0.5 text-xs font-bold uppercase ${badge.classes}`}>
            {badge.label}
          </span>
          <EditableLabel
            value={wallet.label || ''}
            placeholder={shortenAddress(wallet.address)}
            onSave={label => updateMutation.mutate({ id: wallet.id, label })}
          />
        </div>
        <span className="text-lg font-bold text-gray-900">
          ${totalValueUsd.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
      <p
        className="mb-3 cursor-pointer font-mono text-xs text-gray-400 hover:text-gray-600 transition-colors"
        onClick={copyAddress}
        title="Click to copy"
      >
        {wallet.address}
        <span className="ml-1.5 text-[10px]">{copied ? 'Copied!' : ''}</span>
      </p>
      <div className="space-y-1.5">
        {visibleTokens.map(token => (
          <div key={token.address} className="flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700">{token.symbol}</span>
            <div className="text-right">
              <span className="text-gray-500">
                {formatBalance(token.balanceFormatted)}
              </span>
              {token.valueUsd > 0 && (
                <span className="ml-2 text-gray-400">
                  {token.valueUsd < 0.01 ? '<$0.01' : `$${token.valueUsd.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`}
                </span>
              )}
            </div>
          </div>
        ))}
        {hiddenCount > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-blue-500 hover:text-blue-700 transition-colors"
          >
            {expanded ? 'Show less' : `+${hiddenCount} more tokens`}
          </button>
        )}
      </div>
    </div>
  );
}

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatBalance(n: number): string {
  if (n === 0) return '0';
  if (n < 0.0001) return '<0.0001';
  if (n < 1) return n.toFixed(6);
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 4 });
}
