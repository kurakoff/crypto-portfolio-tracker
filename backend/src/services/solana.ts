import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { config } from '../config/rpc';
import { METAPLEX_METADATA_PROGRAM_ID } from '../config/constants';
import { cache } from '../cache/memory-cache';
import type { TokenBalance, NFTItem } from '../routes/portfolio';

let connection: Connection;

function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(config.solRpcUrl, 'confirmed');
  }
  return connection;
}

export async function getSolanaPortfolio(address: string): Promise<{
  nativeBalance: number;
  tokens: TokenBalance[];
  nfts: NFTItem[];
}> {
  const conn = getConnection();
  const pubkey = new PublicKey(address);

  // 1. Native SOL balance
  const lamports = await conn.getBalance(pubkey);
  const nativeBalance = lamports / LAMPORTS_PER_SOL;

  const nativeToken: TokenBalance = {
    address: 'native',
    symbol: 'SOL',
    name: 'Solana',
    decimals: 9,
    balance: lamports.toString(),
    balanceFormatted: nativeBalance,
  };

  // 2. All SPL tokens in one call
  const tokenAccounts = await conn.getParsedTokenAccountsByOwner(pubkey, {
    programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
  });

  // Also fetch Token-2022 accounts
  let token2022Accounts: typeof tokenAccounts = { context: tokenAccounts.context, value: [] };
  try {
    token2022Accounts = await conn.getParsedTokenAccountsByOwner(pubkey, {
      programId: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
    });
  } catch {
    // Token-2022 may not be available
  }

  const allAccounts = [...tokenAccounts.value, ...token2022Accounts.value];

  const tokens: TokenBalance[] = [nativeToken];
  const nfts: NFTItem[] = [];

  for (const account of allAccounts) {
    const parsed = account.account.data.parsed;
    const info = parsed.info;
    const mint = info.mint;
    const amount = info.tokenAmount;

    if (amount.uiAmount === 0) continue;

    // NFT detection: decimals=0, amount=1
    if (amount.decimals === 0 && amount.uiAmount === 1) {
      const metadata = await getMetaplexMetadata(conn, mint);
      nfts.push({
        contractAddress: mint,
        tokenId: mint,
        name: metadata?.name || `SPL NFT ${mint.slice(0, 8)}`,
        imageUrl: metadata?.image || '',
        standard: 'SPL',
      });
      continue;
    }

    // Regular SPL token
    tokens.push({
      address: mint,
      symbol: '', // will be enriched from metadata
      name: '',
      decimals: amount.decimals,
      balance: amount.amount,
      balanceFormatted: amount.uiAmount,
    });
  }

  // Enrich SPL token metadata
  await enrichSplTokenMetadata(conn, tokens);

  return { nativeBalance, tokens, nfts };
}

async function enrichSplTokenMetadata(conn: Connection, tokens: TokenBalance[]): Promise<void> {
  for (const token of tokens) {
    if (token.address === 'native') continue;
    if (token.symbol) continue;

    const cacheKey = `sol:meta:${token.address}`;
    const cached = cache.get<{ symbol: string; name: string }>(cacheKey);
    if (cached) {
      token.symbol = cached.symbol;
      token.name = cached.name;
      continue;
    }

    const metadata = await getMetaplexMetadata(conn, token.address);
    if (metadata) {
      token.symbol = metadata.symbol || token.address.slice(0, 6);
      token.name = metadata.name || 'Unknown SPL Token';
      cache.set(cacheKey, { symbol: token.symbol, name: token.name }, 24 * 60 * 60 * 1000);
    } else {
      token.symbol = token.address.slice(0, 6);
      token.name = 'Unknown SPL Token';
    }
  }
}

interface MetaplexData {
  name: string;
  symbol: string;
  uri: string;
  image?: string;
}

async function getMetaplexMetadata(conn: Connection, mint: string): Promise<MetaplexData | null> {
  const cacheKey = `metaplex:${mint}`;
  const cached = cache.get<MetaplexData>(cacheKey);
  if (cached) return cached;

  try {
    const metadataProgramId = new PublicKey(METAPLEX_METADATA_PROGRAM_ID);
    const mintPubkey = new PublicKey(mint);

    // Derive metadata PDA
    const [metadataPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('metadata'),
        metadataProgramId.toBuffer(),
        mintPubkey.toBuffer(),
      ],
      metadataProgramId
    );

    const accountInfo = await conn.getAccountInfo(metadataPDA);
    if (!accountInfo?.data) return null;

    const metadata = parseMetaplexMetadata(accountInfo.data);

    // Fetch image from URI
    if (metadata.uri) {
      try {
        const uri = metadata.uri.startsWith('ipfs://')
          ? `https://ipfs.io/ipfs/${metadata.uri.slice(7)}`
          : metadata.uri;
        const resp = await fetch(uri);
        const json = (await resp.json()) as { image?: string };
        metadata.image = json.image || '';
      } catch {}
    }

    cache.set(cacheKey, metadata, 300_000); // 5 min
    return metadata;
  } catch {
    return null;
  }
}

function parseMetaplexMetadata(data: Buffer): MetaplexData {
  // Metaplex metadata account layout:
  // 1 byte: key
  // 32 bytes: update authority
  // 32 bytes: mint
  // 4 bytes: name length + name (borsh string)
  // 4 bytes: symbol length + symbol (borsh string)
  // 4 bytes: uri length + uri (borsh string)
  let offset = 1 + 32 + 32;

  const nameLen = data.readUInt32LE(offset);
  offset += 4;
  const name = data.subarray(offset, offset + nameLen).toString('utf8').replace(/\0/g, '').trim();
  offset += nameLen;

  const symbolLen = data.readUInt32LE(offset);
  offset += 4;
  const symbol = data.subarray(offset, offset + symbolLen).toString('utf8').replace(/\0/g, '').trim();
  offset += symbolLen;

  const uriLen = data.readUInt32LE(offset);
  offset += 4;
  const uri = data.subarray(offset, offset + uriLen).toString('utf8').replace(/\0/g, '').trim();

  return { name, symbol, uri };
}
