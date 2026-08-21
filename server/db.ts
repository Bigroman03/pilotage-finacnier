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
      kind TEXT NOT NULL CHECK (kind IN ('monthly', 'quarterly', 'yearly', 'one_off')),
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

    CREATE TABLE IF NOT EXISTS stripe_metric_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mrr_cents INTEGER NOT NULL,
      arr_cents INTEGER NOT NULL,
      active_subscriptions INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EUR',
      synced_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_stripe_metric_history_synced_at ON stripe_metric_history(synced_at DESC);

    CREATE TABLE IF NOT EXISTS stripe_customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      currency TEXT NOT NULL DEFAULT 'EUR',
      active_subscription_count INTEGER NOT NULL DEFAULT 0,
      current_mrr_ht_cents INTEGER NOT NULL DEFAULT 0,
      lifetime_spend_ht_cents INTEGER NOT NULL DEFAULT 0,
      paid_invoice_count INTEGER NOT NULL DEFAULT 0,
      first_paid_at TEXT,
      last_paid_at TEXT,
      synced_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_stripe_customers_spend ON stripe_customers(lifetime_spend_ht_cents DESC);

    CREATE TABLE IF NOT EXISTS stripe_customer_offers (
      customer_id TEXT NOT NULL,
      subscription_id TEXT NOT NULL,
      price_id TEXT NOT NULL,
      product_id TEXT,
      product_name TEXT NOT NULL,
      interval TEXT NOT NULL,
      interval_count INTEGER NOT NULL DEFAULT 1,
      quantity INTEGER NOT NULL DEFAULT 1,
      monthly_mrr_ht_cents INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(customer_id, subscription_id, price_id),
      FOREIGN KEY (customer_id) REFERENCES stripe_customers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_stripe_customer_offers_customer ON stripe_customer_offers(customer_id);

    CREATE TABLE IF NOT EXISTS financial_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      receivables_cents INTEGER NOT NULL DEFAULT 0 CHECK (receivables_cents >= 0),
      inventory_cents INTEGER NOT NULL DEFAULT 0 CHECK (inventory_cents >= 0),
      supplier_debts_cents INTEGER NOT NULL DEFAULT 0 CHECK (supplier_debts_cents >= 0),
      updated_at TEXT NOT NULL
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

  const plannedColumns = new Set((db.prepare('PRAGMA table_info(planned_expenses)').all() as Array<{ name: string }>).map((column) => column.name));
  if (!plannedColumns.has('entered_amount_cents')) db.exec('ALTER TABLE planned_expenses ADD COLUMN entered_amount_cents INTEGER');
  if (!plannedColumns.has('tax_mode')) db.exec("ALTER TABLE planned_expenses ADD COLUMN tax_mode TEXT NOT NULL DEFAULT 'ht'");
  if (!plannedColumns.has('vat_rate_basis_points')) db.exec('ALTER TABLE planned_expenses ADD COLUMN vat_rate_basis_points INTEGER NOT NULL DEFAULT 2000');

  const plannedTableSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='planned_expenses'").get() as { sql: string }).sql;
  if (!plannedTableSql.includes("'quarterly'")) db.transaction(() => {
    db.exec(`
      ALTER TABLE planned_expenses RENAME TO planned_expenses_legacy;
      CREATE TABLE planned_expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        vendor TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        category TEXT NOT NULL,
        subcategory TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('monthly', 'quarterly', 'yearly', 'one_off')),
        start_date TEXT NOT NULL,
        end_date TEXT,
        notes TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        entered_amount_cents INTEGER,
        tax_mode TEXT NOT NULL DEFAULT 'ht',
        vat_rate_basis_points INTEGER NOT NULL DEFAULT 2000
      );
      INSERT INTO planned_expenses(id, label, vendor, amount_cents, category, subcategory, kind, start_date,
        end_date, notes, active, created_at, updated_at, entered_amount_cents, tax_mode, vat_rate_basis_points)
      SELECT id, label, vendor, amount_cents, category, subcategory, kind, start_date, end_date, notes, active,
        created_at, updated_at, entered_amount_cents, tax_mode, vat_rate_basis_points FROM planned_expenses_legacy;
      DROP TABLE planned_expenses_legacy;
      CREATE INDEX idx_planned_expenses_dates ON planned_expenses(start_date, end_date);
    `);
  })();
};

export const closeDatabase = () => {
  database?.close();
  database = null;
};
