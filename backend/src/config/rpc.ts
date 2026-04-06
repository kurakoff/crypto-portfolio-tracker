import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const config = {
  ethRpcUrl: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
  bscRpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
  tronApiUrl: process.env.TRON_API_URL || 'https://api.trongrid.io',
  solRpcUrl: process.env.SOL_RPC_URL || 'https://api.mainnet-beta.solana.com',
  coingeckoBaseUrl: process.env.COINGECKO_BASE_URL || 'https://api.coingecko.com/api/v3',
  googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
  googlePrivateKey: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  googleSpreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || '',
  port: parseInt(process.env.PORT || '3001', 10),
};
