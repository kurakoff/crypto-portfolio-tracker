import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/client';
import { signToken, authMiddleware } from '../middleware/auth';

const router = Router();

function getSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password required' });
    return;
  }

  const storedEmail = getSetting('auth_email');
  const storedHash = getSetting('auth_password_hash');

  if (!storedEmail || !storedHash) {
    res.status(500).json({ error: 'Auth not configured' });
    return;
  }

  if (email !== storedEmail || !bcrypt.compareSync(password, storedHash)) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = signToken({ email });
  res.json({ token });
});

// POST /api/auth/change-password (protected)
router.post('/change-password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'Current and new password required' });
    return;
  }

  const storedHash = getSetting('auth_password_hash');
  if (!storedHash || !bcrypt.compareSync(currentPassword, storedHash)) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(newHash, 'auth_password_hash');
  res.json({ ok: true });
});

export default router;
