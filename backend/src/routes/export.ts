import { Router, Request, Response } from 'express';
import { exportToSheets, getExportStatus, getSheetConfig } from '../services/sheets';
import db from '../db/client';
import { config } from '../config/rpc';

const router = Router();

// GET /api/export/status — last export info + config
router.get('/status', (_req: Request, res: Response) => {
  const status = getExportStatus();
  const sheetConfig = getSheetConfig();
  res.json({
    ...status,
    configured: !!sheetConfig,
    serviceAccountEmail: config.googleServiceAccountEmail,
  });
});

// POST /api/export/configure — save spreadsheet ID
router.post('/configure', (req: Request, res: Response) => {
  const { spreadsheetUrl } = req.body;
  if (!spreadsheetUrl) {
    res.status(400).json({ error: 'spreadsheetUrl is required' });
    return;
  }

  // Extract spreadsheet ID from URL or raw ID
  let spreadsheetId = spreadsheetUrl;
  const match = spreadsheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) spreadsheetId = match[1];

  // Save to exports table (will be used as the target)
  const existing = db.prepare('SELECT * FROM exports ORDER BY id DESC LIMIT 1').get() as any;
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

  if (existing) {
    db.prepare('UPDATE exports SET spreadsheet_id = ?, spreadsheet_url = ? WHERE id = ?')
      .run(spreadsheetId, url, existing.id);
  } else {
    db.prepare('INSERT INTO exports (spreadsheet_id, spreadsheet_url, rows_exported) VALUES (?, ?, 0)')
      .run(spreadsheetId, url);
  }

  res.json({ ok: true, spreadsheetId, spreadsheetUrl: url });
});

// POST /api/export/sheets — run export
router.post('/sheets', async (_req: Request, res: Response) => {
  try {
    const result = await exportToSheets();
    res.json(result);
  } catch (err: any) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Failed to export', details: err.message });
  }
});

export default router;
