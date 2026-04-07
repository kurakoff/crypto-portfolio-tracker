import { google } from 'googleapis';
import { config } from '../config/rpc';
import db from '../db/client';

interface ExportRecord {
  id: number;
  spreadsheet_id: string;
  spreadsheet_url: string;
  last_export_at: string;
  rows_exported: number;
}

interface ExportInput {
  tokens?: Array<{ symbol: string; name: string; balance: string; priceUsd: number; valueUsd: number }>;
  transactions?: Array<{
    timestamp: string; wallet_label?: string; wallet_address: string; chain: string;
    type: string; token_symbol: string; value: string; value_usd: number;
    from_address: string; to_address: string; hash: string;
  }>;
}

function getAuth() {
  if (!config.googleServiceAccountEmail || !config.googlePrivateKey) {
    throw new Error('Google Sheets credentials not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env');
  }

  const key = config.googlePrivateKey;

  // Validate PEM structure
  if (!key.includes('-----BEGIN')) {
    throw new Error('GOOGLE_PRIVATE_KEY is invalid — must be a PEM key starting with -----BEGIN PRIVATE KEY-----. If using Coolify/Docker, try base64-encoding the key.');
  }

  try {
    return new google.auth.JWT(
      config.googleServiceAccountEmail,
      undefined,
      key,
      ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
    );
  } catch (err: any) {
    if (err.message?.includes('DECODER') || err.message?.includes('unsupported')) {
      throw new Error(
        'Private key format error (OpenSSL 3.x). Try base64-encoding GOOGLE_PRIVATE_KEY: ' +
        'base64 -w0 your-key.pem, then set that as the env var.'
      );
    }
    throw err;
  }
}

export async function exportToSheets(input?: ExportInput): Promise<{
  spreadsheetUrl: string;
  newRows: number;
  totalRows: number;
}> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  let exportRecord = db.prepare('SELECT * FROM exports ORDER BY id DESC LIMIT 1').get() as ExportRecord | undefined;

  let spreadsheetId: string;

  if (exportRecord) {
    spreadsheetId = exportRecord.spreadsheet_id;
  } else if (config.googleSpreadsheetId) {
    spreadsheetId = config.googleSpreadsheetId;
  } else {
    throw new Error(
      'No spreadsheet configured. Create a Google Sheet, share it with ' +
      config.googleServiceAccountEmail +
      ' as Editor, and click Export.'
    );
  }

  // Verify access
  try {
    await sheets.spreadsheets.get({ spreadsheetId });
  } catch (err: any) {
    if (err.response?.status === 403 || err.response?.status === 404) {
      throw new Error(
        'Cannot access spreadsheet. Make sure you shared it with ' +
        config.googleServiceAccountEmail + ' as Editor'
      );
    }
    throw err;
  }

  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

  // --- Transactions sheet ---
  // Use filtered data from frontend if provided, otherwise fall back to DB
  let txRows: string[][] = [];
  if (input?.transactions && input.transactions.length > 0) {
    txRows = input.transactions.map(tx => [
      tx.timestamp || '',
      `${tx.wallet_label || ''} (${tx.wallet_address?.slice(0, 8)}...)`,
      tx.chain || '',
      tx.type || '',
      tx.token_symbol || '',
      tx.value || '0',
      tx.value_usd ? `$${tx.value_usd.toFixed(2)}` : '',
      tx.from_address || '',
      tx.to_address || '',
      tx.hash || '',
    ]);
  } else {
    const allTxs = db.prepare(`
      SELECT t.*, w.address as wallet_address, w.chain, w.label as wallet_label
      FROM transactions t
      JOIN wallets w ON t.wallet_id = w.id
      ORDER BY t.timestamp DESC
    `).all() as any[];
    txRows = allTxs.map(tx => [
      tx.timestamp || '',
      `${tx.wallet_label || ''} (${tx.wallet_address?.slice(0, 8)}...)`,
      tx.chain || '',
      tx.type || '',
      tx.token_symbol || '',
      tx.value || '0',
      tx.value_usd ? `$${Number(tx.value_usd).toFixed(2)}` : '',
      tx.from_address || '',
      tx.to_address || '',
      tx.hash || '',
    ]);
  }

  const txHeader = ['Date', 'Wallet', 'Chain', 'Type', 'Token', 'Amount', 'USD', 'From', 'To', 'Hash'];

  await ensureSheet(sheets, spreadsheetId, 'Transactions');
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: 'Transactions!A:J' });
  if (txRows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Transactions!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [txHeader, ...txRows] },
    });
  } else {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Transactions!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [txHeader] },
    });
  }

  // --- Portfolio sheet ---
  let portfolioRows: string[][] = [];
  if (input?.tokens && input.tokens.length > 0) {
    portfolioRows = input.tokens.map(t => [
      t.symbol,
      t.name,
      t.balance,
      t.priceUsd ? `$${t.priceUsd.toFixed(6)}` : '',
      t.valueUsd ? `$${t.valueUsd.toFixed(2)}` : '',
    ]);
  }

  const portfolioHeader = ['Token', 'Name', 'Balance', 'Price', 'Value'];
  await ensureSheet(sheets, spreadsheetId, 'Portfolio');
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: 'Portfolio!A:E' });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Portfolio!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [portfolioHeader, ...portfolioRows] },
  });

  // Update export record
  const totalRows = txRows.length;
  if (exportRecord) {
    db.prepare('UPDATE exports SET last_export_at = datetime(\'now\'), rows_exported = ? WHERE id = ?')
      .run(totalRows, exportRecord.id);
  } else {
    db.prepare('INSERT INTO exports (spreadsheet_id, spreadsheet_url, rows_exported) VALUES (?, ?, ?)')
      .run(spreadsheetId, spreadsheetUrl, totalRows);
  }

  return { spreadsheetUrl, newRows: totalRows, totalRows };
}

export function getExportStatus(): ExportRecord | null {
  return (db.prepare('SELECT * FROM exports ORDER BY id DESC LIMIT 1').get() as ExportRecord) || null;
}

export function getSheetConfig(): string | null {
  const record = db.prepare('SELECT spreadsheet_id FROM exports ORDER BY id DESC LIMIT 1').get() as any;
  if (record?.spreadsheet_id) return record.spreadsheet_id;
  if (config.googleSpreadsheetId) return config.googleSpreadsheetId;
  return null;
}

async function ensureSheet(sheets: any, spreadsheetId: string, title: string) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const exists = meta.data.sheets?.some((s: any) => s.properties?.title === title);
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title } } }],
        },
      });
    }
  } catch {}
}
