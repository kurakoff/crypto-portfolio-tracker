/**
 * Portfolio snapshots: the last known balances of a wallet, stored in SQLite.
 * Written by whoever fetched fresh balances (portfolio route, background
 * sync), read by the portfolio route when the live source is unavailable or
 * too expensive to call on every request.
 */
import db from '../db/client';
import type { WalletPortfolio } from '../routes/portfolio';

export function saveSnapshot(walletId: number, portfolio: WalletPortfolio): void {
  try {
    db.prepare(`INSERT INTO portfolio_snapshots (wallet_id, data) VALUES (?, ?)`)
      .run(walletId, JSON.stringify(portfolio));
    // Keep only the latest 5 snapshots per wallet
    db.prepare(
      `DELETE FROM portfolio_snapshots WHERE wallet_id = ? AND id NOT IN (
        SELECT id FROM portfolio_snapshots WHERE wallet_id = ? ORDER BY created_at DESC LIMIT 5
      )`
    ).run(walletId, walletId);
  } catch (err) {
    console.error('[snapshot] save error:', err);
  }
}

export function loadSnapshot(walletId: number): { portfolio: WalletPortfolio; createdAt: string } | null {
  try {
    const row = db.prepare(
      `SELECT data, created_at FROM portfolio_snapshots WHERE wallet_id = ? ORDER BY created_at DESC LIMIT 1`
    ).get(walletId) as { data: string; created_at: string } | undefined;
    if (row) return { portfolio: JSON.parse(row.data), createdAt: row.created_at };
  } catch (err) {
    console.error('[snapshot] load error:', err);
  }
  return null;
}
