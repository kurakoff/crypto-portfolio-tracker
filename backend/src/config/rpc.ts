import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function parsePrivateKey(): string {
  let raw = process.env.GOOGLE_PRIVATE_KEY || '';
  if (!raw) return '';

  // Remove surrounding quotes if present
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1);
  }

  // If base64-encoded (no BEGIN marker), decode first
  if (raw.length > 100 && !raw.includes('BEGIN')) {
    try {
      raw = Buffer.from(raw, 'base64').toString('utf-8');
    } catch {}
  }

  // Replace literal \n with real newlines
  raw = raw.replace(/\\n/g, '\n');

  // Remove carriage returns
  raw = raw.replace(/\r/g, '');

  // Rebuild PEM from scratch to guarantee correct format
  const beginMatch = raw.match(/-----BEGIN ([A-Z ]+)-----/);
  const endMatch = raw.match(/-----END ([A-Z ]+)-----/);
  if (beginMatch && endMatch) {
    // Extract pure base64 content between markers
    const startIdx = raw.indexOf(beginMatch[0]) + beginMatch[0].length;
    const endIdx = raw.indexOf(endMatch[0]);
    const base64Content = raw.slice(startIdx, endIdx).replace(/[\s\n]/g, '');

    // Rebuild with proper 64-char line wrapping
    const lines: string[] = [];
    for (let i = 0; i < base64Content.length; i += 64) {
      lines.push(base64Content.slice(i, i + 64));
    }

    const rebuilt = `-----BEGIN ${beginMatch[1]}-----\n${lines.join('\n')}\n-----END ${endMatch[1]}-----\n`;

    console.log(`[config] Private key parsed: ${beginMatch[1]}, ${base64Content.length} base64 chars, ${lines.length} lines`);
    return rebuilt;
  }

  console.warn('[config] Could not parse GOOGLE_PRIVATE_KEY PEM structure');
  return raw;
}

export const config = {
  ethRpcUrl: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
  bscRpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
  tronApiUrl: process.env.TRON_API_URL || 'https://api.trongrid.io',
  solRpcUrl: process.env.SOL_RPC_URL || 'https://api.mainnet-beta.solana.com',
  coingeckoBaseUrl: process.env.COINGECKO_BASE_URL || 'https://api.coingecko.com/api/v3',
  googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
  googlePrivateKey: parsePrivateKey(),
  googleSpreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || '',
  moralisApiKey: process.env.MORALIS_API_KEY || '',
  port: parseInt(process.env.PORT || '3001', 10),
};
