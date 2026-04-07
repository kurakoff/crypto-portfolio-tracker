import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { initSchema } from './schema';

// Use DB_PATH env var for persistent storage in Docker, fallback to local data/
const DATA_DIR = process.env.DB_PATH || path.resolve(__dirname, '../../data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db: DatabaseType = new Database(path.join(DATA_DIR, 'portfolio.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

initSchema(db);

export default db;
