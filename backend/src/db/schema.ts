import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT NOT NULL,
      chain TEXT NOT NULL CHECK(chain IN ('ethereum', 'bsc', 'arbitrum', 'tron', 'solana')),
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

  // Migration: add last_synced_at column to wallets
  try {
    db.exec(`ALTER TABLE wallets ADD COLUMN last_synced_at TEXT`);
  } catch {
    // Column already exists
  }

  // Migration: add fee columns
  try {
    db.exec(`ALTER TABLE transactions ADD COLUMN fee_native REAL DEFAULT 0`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE transactions ADD COLUMN fee_usd REAL DEFAULT 0`);
  } catch {
    // Column already exists
  }

  // Migration: clean up approve() transactions with absurd USD values
  db.exec(`DELETE FROM transactions WHERE value_usd > 1000000000`);

  // Migration: widen wallets.chain CHECK constraint to allow new chains (e.g. arbitrum).
  // SQLite can't ALTER a CHECK constraint, so rebuild the table when it's outdated.
  try {
    const walletsSql = (db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='wallets'")
      .get() as { sql: string } | undefined)?.sql || '';
    if (walletsSql && !walletsSql.includes('arbitrum')) {
      // Rebuild requires FK enforcement off (transactions reference wallets ON DELETE CASCADE)
      db.pragma('foreign_keys = OFF');
      db.exec(`
        BEGIN;
        CREATE TABLE wallets_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          address TEXT NOT NULL,
          chain TEXT NOT NULL CHECK(chain IN ('ethereum', 'bsc', 'arbitrum', 'tron', 'solana')),
          label TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          last_synced_at TEXT,
          UNIQUE(address, chain)
        );
        INSERT INTO wallets_new (id, address, chain, label, created_at, last_synced_at)
          SELECT id, address, chain, label, created_at, last_synced_at FROM wallets;
        DROP TABLE wallets;
        ALTER TABLE wallets_new RENAME TO wallets;
        COMMIT;
      `);
      db.pragma('foreign_keys = ON');
      console.log('[schema] Migrated wallets table — arbitrum chain now allowed');
    }
  } catch (err) {
    console.error('[schema] wallets CHECK migration failed:', err);
  }

  // Address labels table
  db.exec(`
    CREATE TABLE IF NOT EXISTS address_labels (
      chain TEXT NOT NULL,
      address TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (chain, address)
    );
  `);
}
