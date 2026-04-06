import type { NFTItem } from '../hooks/usePortfolio';

interface Props {
  nft: NFTItem;
}

export default function NFTCard({ nft }: Props) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900 transition-transform hover:scale-[1.02]">
      <div className="aspect-square bg-gray-800">
        {nft.imageUrl ? (
          <img
            src={nft.imageUrl}
            alt={nft.name}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={e => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-gray-600">
            No Image
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-medium text-white">{nft.name}</p>
        <p className="text-xs text-gray-500">{nft.standard}</p>
      </div>
    </div>
  );
}
