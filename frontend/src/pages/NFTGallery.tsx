import { usePortfolio } from '../hooks/usePortfolio';
import NFTCard from '../components/NFTCard';

export default function NFTGallery() {
  const { data: portfolios, isLoading, error } = usePortfolio();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800 bg-red-950/50 p-6 text-red-400">
        Failed to load NFTs: {error.message}
      </div>
    );
  }

  const allNfts = portfolios?.flatMap(p =>
    p.nfts.map(nft => ({
      ...nft,
      walletLabel: p.wallet.label || p.wallet.address.slice(0, 8),
      chain: p.wallet.chain,
    }))
  ) || [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">NFT Gallery</h1>

      {allNfts.length === 0 ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-10 text-center">
          <p className="text-gray-500">No NFTs found across your wallets.</p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {allNfts.map((nft, i) => (
            <div key={`${nft.contractAddress}-${nft.tokenId}-${i}`}>
              <NFTCard nft={nft} />
              <p className="mt-1 text-center text-xs text-gray-600">
                {nft.walletLabel} ({nft.chain === 'ethereum' ? 'ETH' : 'SOL'})
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
