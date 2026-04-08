import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT NOT NULL,
      chain TEXT NOT NULL CHECK(chain IN ('ethereum', 'bsc', 'tron', 'solana')),
      label TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(address, chain)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      hash TEXT NOT NULL,
      block_number INTEGER,
      timestamp TEXT,
      from_address TEXT,
      to_address TEXT,
      value TEXT,
      token_symbol TEXT,
      token_address TEXT,
      type TEXT DEFAULT 'transfer',
      value_usd REAL DEFAULT 0,
      UNIQUE(wallet_id, hash, token_address)
    );

    CREATE TABLE IF NOT EXISTS exports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spreadsheet_id TEXT NOT NULL,
      spreadsheet_url TEXT NOT NULL,
      last_export_at TEXT DEFAULT (datetime('now')),
      rows_exported INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_wallet ON transactions(wallet_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);
    CREATE INDEX IF NOT EXISTS idx_snapshots_wallet ON portfolio_snapshots(wallet_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_created ON portfolio_snapshots(created_at);
  `);

  // Settings table for auth
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Seed default auth credentials
  const existing = db.prepare('SELECT key FROM settings WHERE key = ?').get('auth_email');
  if (!existing) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('auth_email', 'denis@directline.pro');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('auth_password_hash', hash);
  }

  // Migration: add value_usd column if missing
  try {
    db.exec(`ALTER TABLE transactions ADD COLUMN value_usd REAL DEFAULT 0`);
  } catch {
    // Column already exists
  }

  // Migration: add comment column if missing
  try {
    db.exec(`ALTER TABLE transactions ADD COLUMN comment TEXT DEFAULT ''`);
  } catch {
    // Column already exists
  }
}
