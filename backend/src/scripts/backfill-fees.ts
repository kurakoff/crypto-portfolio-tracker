/**
 * One-time script: backfill fee_native & fee_usd for send transactions from the last month.
 * Run on server: npx tsx src/scripts/backfill-fees.ts
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// --- DB setup (same as client.ts) ---
const DATA_DIR = process.env.DB_PATH || path.resolve(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const db = new Database(path.join(DATA_DIR, 'portfolio.db'));
db.pragma('journal_mode = WAL');

// Ensure columns exist
try { db.exec('ALTER TABLE transactions ADD COLUMN fee_native REAL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE transactions ADD COLUMN fee_usd REAL DEFAULT 0'); } catch {}

// --- Moralis config ---
const moralisKeys = [
  process.env.MORALIS_API_KEY || '',
  process.env.MORALIS_API_KEY_2 || '',
  process.env.MORALIS_API_KEY_3 || '',
].filter(k => k.length > 0);

let keyIdx = 0;
function moralisHeaders() {
  return { 'X-API-Key': moralisKeys[keyIdx % moralisKeys.length], 'Accept': 'application/json' };
}

const MORALIS_BASE = 'https://deep-index.moralis.io/api/v2.2';
const CHAIN_MAP: Record<string, string> = { ethereum: 'eth', bsc: 'bsc' };

// --- Helpers ---

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchTronFee(hash: string): Promise<number> {
  try {
    const resp = await fetch('https://api.trongrid.io/wallet/gettransactioninfobyid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: hash }),
    });
    const data = await resp.json() as any;
    const energyFee = data.receipt?.energy_fee || 0;
    const netFee = data.receipt?.net_fee || 0;
    return (energyFee + netFee) / 1_000_000;
  } catch {
    return 0;
  }
}

async function fetchMoralisFee(chain: string, hash: string): Promise<number> {
  const mc = CHAIN_MAP[chain];
  if (!mc || moralisKeys.length === 0) return 0;
  try {
    const resp = await fetch(`${MORALIS_BASE}/transaction/${hash}?chain=${mc}`, {
      headers: moralisHeaders(),
    });
    if (resp.status === 429 || resp.status === 401) {
      keyIdx++;
      // retry once with next key
      const resp2 = await fetch(`${MORALIS_BASE}/transaction/${hash}?chain=${mc}`, {
        headers: moralisHeaders(),
      });
      if (!resp2.ok) return 0;
      const data = await resp2.json() as any;
      return parseFloat(data.transaction_fee || '0');
    }
    if (!resp.ok) return 0;
    const data = await resp.json() as any;
    return parseFloat(data.transaction_fee || '0');
  } catch {
    return 0;
  }
}

async function getNativePrice(coinId: string): Promise<number> {
  try {
    const resp = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`);
    const data = await resp.json() as any;
    return data[coinId]?.usd || 0;
  } catch {
    return 0;
  }
}

// --- Main ---

async function main() {
  const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const rows = db.prepare(`
    SELECT t.id, t.hash, w.chain
    FROM transactions t
    JOIN wallets w ON t.wallet_id = w.id
    WHERE t.type = 'send'
      AND (t.fee_native IS NULL OR t.fee_native = 0)
      AND t.timestamp >= ?
    ORDER BY t.timestamp DESC
  `).all(oneMonthAgo) as { id: number; hash: string; chain: string }[];

  console.log(`Found ${rows.length} send txs without fees (last 30 days)`);
  if (rows.length === 0) {
    db.close();
    return;
  }

  // Get native prices
  const prices: Record<string, number> = {};
  for (const coinId of ['ethereum', 'binancecoin', 'tron']) {
    prices[coinId] = await getNativePrice(coinId);
  }
  console.log('Native prices:', prices);

  const COIN_IDS: Record<string, string> = {
    ethereum: 'ethereum',
    bsc: 'binancecoin',
    tron: 'tron',
  };

  const update = db.prepare('UPDATE transactions SET fee_native = ?, fee_usd = ? WHERE id = ?');
  let updated = 0;
  let errors = 0;

  // Process in batches of 5
  for (let i = 0; i < rows.length; i += 5) {
    const batch = rows.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(async (row) => {
        let fee = 0;
        if (row.chain === 'tron') {
          fee = await fetchTronFee(row.hash);
        } else if (row.chain === 'ethereum' || row.chain === 'bsc') {
          fee = await fetchMoralisFee(row.chain, row.hash);
        }
        return { ...row, fee };
      })
    );

    for (const r of results) {
      if (r.fee > 0) {
        const coinId = COIN_IDS[r.chain] || '';
        const nativePrice = prices[coinId] || 0;
        const feeUsd = r.fee * nativePrice;
        update.run(r.fee, feeUsd, r.id);
        updated++;
        console.log(`  [${r.chain}] ${r.hash.slice(0, 16)}... fee=${r.fee.toFixed(4)} ($${feeUsd.toFixed(2)})`);
      } else {
        errors++;
      }
    }

    // Rate limit: small delay between batches
    if (i + 5 < rows.length) {
      await sleep(200);
    }
  }

  console.log(`\nDone: ${updated} updated, ${errors} no fee found, ${rows.length} total`);
  db.close();
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
