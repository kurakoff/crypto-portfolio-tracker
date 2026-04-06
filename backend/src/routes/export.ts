import { Router, Request, Response } from 'express';
import { exportToSheets, getExportStatus } from '../services/sheets';

const router = Router();

// GET /api/export/status — last export info
router.get('/status', (_req: Request, res: Response) => {
  const status = getExportStatus();
  res.json(status);
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
