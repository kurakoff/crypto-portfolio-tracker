import type { TokenBalance } from '../hooks/usePortfolio';

interface Props {
  tokens: TokenBalance[];
}

export default function TokenTable({ tokens }: Props) {
  const sorted = [...tokens].sort((a, b) => b.valueUsd - a.valueUsd);

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-100 bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Token</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Balance</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Price</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map(token => (
            <tr key={token.address} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  {token.logoUri && (
                    <img src={token.logoUri} alt="" className="h-6 w-6 rounded-full" />
                  )}
                  <div>
                    <p className="font-medium text-gray-900">{token.symbol}</p>
                    <p className="text-xs text-gray-400">{token.name}</p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-right text-gray-600">
                {token.balanceFormatted.toLocaleString(undefined, { maximumFractionDigits: 6 })}
              </td>
              <td className="px-4 py-3 text-right text-gray-500">
                {token.priceUsd > 0
                  ? `$${token.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                  : '-'}
              </td>
              <td className="px-4 py-3 text-right font-medium text-gray-900">
                {token.valueUsd > 0
                  ? `$${token.valueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                  : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
