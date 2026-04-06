const CHAIN_BADGES: Record<string, { label: string; classes: string }> = {
  ethereum: { label: 'ETH', classes: 'border-blue-200 bg-blue-50 text-blue-700' },
  bsc:      { label: 'BSC', classes: 'border-yellow-200 bg-yellow-50 text-yellow-700' },
  tron:     { label: 'TRX', classes: 'border-red-200 bg-red-50 text-red-700' },
  solana:   { label: 'SOL', classes: 'border-purple-200 bg-purple-50 text-purple-700' },
};

const DEFAULT_BADGE = { label: '???', classes: 'border-gray-200 bg-gray-50 text-gray-600' };

export function chainBadge(chain: string) {
  return CHAIN_BADGES[chain] || DEFAULT_BADGE;
}
