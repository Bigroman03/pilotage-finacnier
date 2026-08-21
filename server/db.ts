import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

let database: Database.Database | null = null;

export const getDatabase = () => {
  if (database) return database;

  const dataDirectory = resolve(process.env.DATA_DIR || './data');
  mkdirSync(dataDirectory, { recursive: true });
  database = new Database(resolve(dataDirectory, 'pilotage.db'));
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  migrate(database);
  return database;
};

const migrate = (db: Database.Database) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bank_accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      iban TEXT,
      currency TEXT NOT NULL DEFAULT 'EUR',
      balance_cents INTEGER NOT NULL DEFAULT 0,
      authorized_balance_cents INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      external_id TEXT NOT NULL,
      bank_account_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'qonto',
      date TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('credit', 'debit')),
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EUR',
      vendor TEXT NOT NULL,
      label TEXT NOT NULL,
      reference TEXT,
      note TEXT,
      qonto_category TEXT,
      operation_type TEXT NOT NULL,
      status TEXT NOT NULL,
      category TEXT NOT NULL,
      subcategory TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source, external_id, bank_account_id),
      FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_side_status ON transactions(side, status);
    CREATE INDEX IF NOT EXISTS idx_transactions_vendor ON transactions(vendor);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category, subcategory);

    CREATE TABLE IF NOT EXISTS planned_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      vendor TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      category TEXT NOT NULL,
      subcategory TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('monthly', 'one_off')),
      start_date TEXT NOT NULL,
      end_date TEXT,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_planned_expenses_dates ON planned_expenses(start_date, end_date);

    CREATE TABLE IF NOT EXISTS vendor_overrides (
      vendor TEXT PRIMARY KEY,
      display_name TEXT,
      category TEXT,
      subcategory TEXT,
      recurring_status TEXT NOT NULL DEFAULT 'auto' CHECK (recurring_status IN ('auto', 'monthly', 'not_recurring')),
      monthly_override_cents INTEGER,
      notes TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stripe_metrics (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mrr_cents INTEGER NOT NULL DEFAULT 0,
      arr_cents INTEGER NOT NULL DEFAULT 0,
      active_subscriptions INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EUR',
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      imported_count INTEGER NOT NULL DEFAULT 0,
      message TEXT
    );
  `);
};

export const closeDatabase = () => {
  database?.close();
  database = null;
};

