import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function parsePrivateKey(): string {
  let raw = process.env.GOOGLE_PRIVATE_KEY || '';
  if (!raw) return '';

  // If base64-encoded (no BEGIN marker), decode first
  if (raw.length > 100 && !raw.includes('BEGIN')) {
    try {
      raw = Buffer.from(raw, 'base64').toString('utf-8');
    } catch {}
  }

  // Replace literal \n with real newlines
  raw = raw.replace(/\\n/g, '\n');

  // Ensure proper PEM structure
  if (raw.includes('BEGIN') && !raw.includes('\n')) {
    // All on one line — split PEM markers from body
    raw = raw
      .replace(/-----BEGIN (.*?)-----/, '-----BEGIN $1-----\n')
      .replace(/-----END (.*?)-----/, '\n-----END $1-----\n');
  }

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
