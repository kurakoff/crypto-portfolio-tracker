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

function getAuth() {
  if (!config.googleServiceAccountEmail || !config.googlePrivateKey) {
    throw new Error('Google Sheets credentials not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env');
  }
  return new google.auth.JWT(
    config.googleServiceAccountEmail,
    undefined,
    config.googlePrivateKey,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}

export async function exportToSheets(): Promise<{
  spreadsheetUrl: string;
  newRows: number;
  totalRows: number;
}> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // Check if we have an existing export
  let exportRecord = db.prepare('SELECT * FROM exports ORDER BY id DESC LIMIT 1').get() as ExportRecord | undefined;

  let spreadsheetId: string;

  if (exportRecord) {
    spreadsheetId = exportRecord.spreadsheet_id;
  } else if (config.googleSpreadsheetId) {
    spreadsheetId = config.googleSpreadsheetId;
  } else {
    // Create new spreadsheet
    const created = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: 'Crypto Portfolio — Transactions' },
        sheets: [
          { properties: { title: 'Transactions' } },
          { properties: { title: 'Portfolio' } },
        ],
      },
    });
    spreadsheetId = created.data.spreadsheetId!;
  }

  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

  // --- Transactions sheet (incremental) ---
  const lastExportedCount = exportRecord?.rows_exported || 0;

  const allTxs = db.prepare(`
    SELECT t.*, w.address as wallet_address, w.chain, w.label as wallet_label
    FROM transactions t
    JOIN wallets w ON t.wallet_id = w.id
    ORDER BY t.timestamp ASC
  `).all() as any[];

  let newTxRows = 0;

  if (allTxs.length > 0) {
    if (lastExportedCount === 0) {
      // First export — write header + all rows
      const header = ['Date', 'Wallet', 'Chain', 'Type', 'Token', 'Amount', 'From', 'To', 'Hash'];
      const rows = [header, ...allTxs.map(txToRow)];

      await ensureSheet(sheets, spreadsheetId, 'Transactions');
      await sheets.spreadsheets.values.clear({ spreadsheetId, range: 'Transactions!A:I' });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Transactions!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows },
      });
      newTxRows = allTxs.length;
    } else if (allTxs.length > lastExportedCount) {
      // Incremental — append only new rows
      const newTxs = allTxs.slice(lastExportedCount);
      const rows = newTxs.map(txToRow);

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Transactions!A:I',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows },
      });
      newTxRows = newTxs.length;
    }
  }

  // --- Portfolio sheet (full overwrite) ---
  const wallets = db.prepare('SELECT * FROM wallets').all() as any[];
  const portfolioHeader = ['Wallet', 'Chain', 'Label', 'Token', 'Balance'];
  // We write a simple snapshot — balances are in the portfolio_snapshots or just wallet list
  const portfolioRows = [portfolioHeader];
  // Add wallet rows (simplified — just list wallets)
  for (const w of wallets) {
    portfolioRows.push([w.address, w.chain, w.label || '', '', '']);
  }

  await ensureSheet(sheets, spreadsheetId, 'Portfolio');
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: 'Portfolio!A:E' });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Portfolio!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: portfolioRows },
  });

  // Update export record
  const totalRows = allTxs.length;
  if (exportRecord) {
    db.prepare('UPDATE exports SET last_export_at = datetime(?), rows_exported = ? WHERE id = ?')
      .run('now', totalRows, exportRecord.id);
  } else {
    db.prepare('INSERT INTO exports (spreadsheet_id, spreadsheet_url, rows_exported) VALUES (?, ?, ?)')
      .run(spreadsheetId, spreadsheetUrl, totalRows);
  }

  return { spreadsheetUrl, newRows: newTxRows, totalRows };
}

// GET export status
export function getExportStatus(): ExportRecord | null {
  return (db.prepare('SELECT * FROM exports ORDER BY id DESC LIMIT 1').get() as ExportRecord) || null;
}

function txToRow(tx: any): string[] {
  return [
    tx.timestamp || '',
    `${tx.wallet_label || ''} (${tx.wallet_address?.slice(0, 8)}...)`,
    tx.chain || '',
    tx.type || '',
    tx.token_symbol || '',
    tx.value || '0',
    tx.from_address || '',
    tx.to_address || '',
    tx.hash || '',
  ];
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
