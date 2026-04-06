import type { WalletPortfolio } from '../hooks/usePortfolio';
import { chainBadge } from '../utils/chains';

interface Props {
  portfolio: WalletPortfolio;
}

export default function WalletCard({ portfolio }: Props) {
  const { wallet, totalValueUsd, tokens } = portfolio;
  const badge = chainBadge(wallet.chain);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`rounded-lg border px-2 py-0.5 text-xs font-bold uppercase ${badge.classes}`}>
            {badge.label}
          </span>
          <span className="text-sm font-medium text-gray-900">
            {wallet.label || shortenAddress(wallet.address)}
          </span>
        </div>
        <span className="text-lg font-bold text-gray-900">
          ${totalValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
      <p className="mb-3 font-mono text-xs text-gray-400">{wallet.address}</p>
      <div className="space-y-1.5">
        {tokens.slice(0, 5).map(token => (
          <div key={token.address} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              {token.logoUri && (
                <img src={token.logoUri} alt="" className="h-5 w-5 rounded-full" />
              )}
              <span className="font-medium text-gray-700">{token.symbol}</span>
            </div>
            <div className="text-right">
              <span className="text-gray-500">
                {token.balanceFormatted.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </span>
              {token.valueUsd > 0 && (
                <span className="ml-2 text-gray-400">
                  ${token.valueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              )}
            </div>
          </div>
        ))}
        {tokens.length > 5 && (
          <p className="text-xs text-gray-400">+{tokens.length - 5} more tokens</p>
        )}
      </div>
    </div>
  );
}

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
