import { google } from 'googleapis';
import { webcrypto } from 'crypto';
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
  totalValue?: number;
  totalReceived?: number;
  totalSent?: number;
  dateFrom?: string;
  dateTo?: string;
  exportedAt?: string;
  tokens?: Array<{ symbol: string; name: string; balance: string; priceUsd: number; valueUsd: number }>;
  transactions?: Array<{
    timestamp: string; wallet_label?: string; wallet_address: string; chain: string;
    type: string; token_symbol: string; value: string; value_usd: number;
    from_address: string; to_address: string; hash: string;
  }>;
}

// ---- WebCrypto JWT signing (bypasses OpenSSL DECODER issue) ----

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN .*-----/, '')
    .replace(/-----END .*-----/, '')
    .replace(/[\s\n\r]/g, '');
  const binary = Buffer.from(b64, 'base64');
  return binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
}

function toBase64Url(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString('base64url');
}

async function signJwtWebCrypto(email: string, pem: string, scopes: string[]): Promise<string> {
  const subtle = webcrypto.subtle;
  const der = pemToDer(pem);

  const privateKey = await subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: email,
    scope: scopes.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const input = `${headerB64}.${payloadB64}`;

  const signature = await subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(input)
  );

  return `${input}.${toBase64Url(signature)}`;
}

async function getAccessToken(): Promise<string> {
  const scopes = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'];
  const jwt = await signJwtWebCrypto(config.googleServiceAccountEmail, config.googlePrivateKey, scopes);

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Google OAuth failed: ${err}`);
  }

  const data = (await resp.json()) as { access_token: string };
  return data.access_token;
}

async function getSheetsClient() {
  if (!config.googleServiceAccountEmail || !config.googlePrivateKey) {
    throw new Error('Google Sheets credentials not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env');
  }
  if (!config.googlePrivateKey.includes('-----BEGIN')) {
    throw new Error('GOOGLE_PRIVATE_KEY is invalid — must be a PEM key');
  }

  const token = await getAccessToken();
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: token });
  return google.sheets({ version: 'v4', auth });
}

// ---- Export logic ----

export async function exportToSheets(input?: ExportInput): Promise<{
  spreadsheetUrl: string;
  newRows: number;
  totalRows: number;
}> {
  const sheets = await getSheetsClient();

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

  // Totals row for transactions
  const txTotalReceived = input?.totalReceived ?? 0;
  const txTotalSent = input?.totalSent ?? 0;
  const txTotalsRow = ['', '', '', '', '', '', '', '', '', ''];
  const txReceivedRow = ['', '', '', 'Total Received', '', '', `$${txTotalReceived.toFixed(2)}`, '', '', ''];
  const txSentRow = ['', '', '', 'Total Sent', '', '', `$${txTotalSent.toFixed(2)}`, '', '', ''];

  await ensureSheet(sheets, spreadsheetId, 'Transactions');
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: 'Transactions!A:J' });
  const txValues = txRows.length > 0
    ? [txHeader, ...txRows, txTotalsRow, txReceivedRow, txSentRow]
    : [txHeader];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Transactions!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: txValues },
  });

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

  // Totals row for portfolio
  const portfolioTotal = input?.totalValue ?? 0;
  const portfolioTotalsRow = ['', '', '', '', ''];
  const portfolioSumRow = ['', '', '', 'Total', `$${portfolioTotal.toFixed(2)}`];

  const portfolioHeader = ['Token', 'Name', 'Balance', 'Price', 'Value'];
  await ensureSheet(sheets, spreadsheetId, 'Portfolio');
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: 'Portfolio!A:E' });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Portfolio!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [portfolioHeader, ...portfolioRows, portfolioTotalsRow, portfolioSumRow] },
  });

  // --- Summary sheet ---
  const summaryRows: string[][] = [
    ['Period', input?.dateFrom && input?.dateTo ? `${input.dateFrom} — ${input.dateTo}` : 'All time'],
    ['Portfolio Value', input?.totalValue ? `$${input.totalValue.toFixed(2)}` : ''],
    ['Total Received', input?.totalReceived ? `$${input.totalReceived.toFixed(2)}` : '$0'],
    ['Total Sent', input?.totalSent ? `$${input.totalSent.toFixed(2)}` : '$0'],
    ['Tokens Count', String(portfolioRows.length)],
    ['Transactions Count', String(txRows.length)],
    ['Exported At', input?.exportedAt || new Date().toLocaleString('ru-RU')],
  ];
  await ensureSheet(sheets, spreadsheetId, 'Summary');
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: 'Summary!A:B' });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Summary!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: summaryRows },
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
