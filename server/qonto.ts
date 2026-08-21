import type Database from 'better-sqlite3';
import { classifyExpense, normalizeVendor } from './classification.js';

const QONTO_API_URL = 'https://thirdparty.qonto.com';
const MAX_PAGES = 500;

type QontoAuth = { authorization: string; mode: 'oauth' | 'api_key' };

type QontoBankAccount = {
  id: string;
  name?: string | null;
  iban?: string | null;
  currency?: string | null;
  balance?: number | null;
  balance_cents?: number | null;
  auth_balance?: number | null;
  auth_balance_cents?: number | null;
  authorized_balance?: number | null;
  authorized_balance_cents?: number | null;
};

type QontoTransaction = {
  id?: string;
  transaction_id?: string;
  amount?: number | null;
  amount_cents?: number | null;
  side?: 'credit' | 'debit';
  operation_type?: string | null;
  currency?: string | null;
  label?: string | null;
  settled_at?: string | null;
  emitted_at?: string | null;
  updated_at?: string | null;
  status?: string | null;
  note?: string | null;
  reference?: string | null;
  category?: string | null;
  cashflow_category?: { name?: string | null } | null;
  cashflow_subcategory?: { name?: string | null } | null;
};

const getAuth = (): QontoAuth | null => {
  const token = process.env.QONTO_ACCESS_TOKEN?.trim();
  if (token) return { authorization: `Bearer ${token}`, mode: 'oauth' };
  const login = process.env.QONTO_API_LOGIN?.trim();
  const secret = process.env.QONTO_API_SECRET?.trim();
  if (login && secret) return { authorization: `${login}:${secret}`, mode: 'api_key' };
  return null;
};

export const isQontoConfigured = () => Boolean(getAuth());

const request = async <T>(path: string, auth: QontoAuth): Promise<T> => {
  const response = await fetch(`${QONTO_API_URL}${path}`, {
    headers: { Authorization: auth.authorization, Accept: 'application/json' },
  });
  if (!response.ok) {
    const requestId = response.headers.get('x-request-id') || response.headers.get('x-qonto-request-id');
    throw new Error(`Qonto a refusé la synchronisation (${response.status})${requestId ? ` · requête ${requestId}` : ''}`);
  }
  return await response.json() as T;
};

const signedCents = (centsValue?: number | null, amountValue?: number | null) => {
  if (typeof centsValue === 'number') return Math.round(centsValue);
  return Math.round((amountValue || 0) * 100);
};

const absoluteCents = (transaction: QontoTransaction) => Math.abs(signedCents(transaction.amount_cents, transaction.amount));

const qontoCategory = (transaction: QontoTransaction) => transaction.cashflow_subcategory?.name
  || transaction.cashflow_category?.name
  || transaction.category
  || null;

export const syncQonto = async (db: Database.Database) => {
  const auth = getAuth();
  if (!auth) throw new Error('Connexion Qonto non configurée.');
  const startedAt = new Date().toISOString();
  const run = db.prepare("INSERT INTO sync_runs(source, status, started_at) VALUES ('qonto', 'running', ?)").run(startedAt);

  try {
    const organizationPayload = await request<{ organization?: { bank_accounts?: QontoBankAccount[] } }>('/v2/organization', auth);
    const accounts = organizationPayload.organization?.bank_accounts || [];
    const now = new Date().toISOString();
    const saveAccount = db.prepare(`INSERT INTO bank_accounts(id, name, iban, currency, balance_cents, authorized_balance_cents, updated_at)
      VALUES (@id, @name, @iban, @currency, @balanceCents, @authorizedBalanceCents, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, iban=excluded.iban, currency=excluded.currency,
      balance_cents=excluded.balance_cents, authorized_balance_cents=excluded.authorized_balance_cents, updated_at=excluded.updated_at`);
    accounts.forEach((account) => saveAccount.run({
      id: account.id,
      name: account.name || 'Compte Qonto',
      iban: account.iban || null,
      currency: account.currency || 'EUR',
      balanceCents: signedCents(account.balance_cents, account.balance),
      authorizedBalanceCents: signedCents(
        account.auth_balance_cents ?? account.authorized_balance_cents,
        account.auth_balance ?? account.authorized_balance ?? account.balance,
      ),
      updatedAt: now,
    }));

    const upsert = db.prepare(`INSERT INTO transactions(
      id, external_id, bank_account_id, source, date, side, amount_cents, currency, vendor, label, reference,
      note, qonto_category, operation_type, status, category, subcategory, raw_json, created_at, updated_at
    ) VALUES (
      @id, @externalId, @bankAccountId, 'qonto', @date, @side, @amountCents, @currency, @vendor, @label, @reference,
      @note, @qontoCategory, @operationType, @status, @category, @subcategory, @rawJson, @createdAt, @updatedAt
    ) ON CONFLICT(source, external_id, bank_account_id) DO UPDATE SET
      date=excluded.date, side=excluded.side, amount_cents=excluded.amount_cents, currency=excluded.currency,
      vendor=excluded.vendor, label=excluded.label, reference=excluded.reference, note=excluded.note,
      qonto_category=excluded.qonto_category, operation_type=excluded.operation_type, status=excluded.status,
      category=excluded.category, subcategory=excluded.subcategory, raw_json=excluded.raw_json, updated_at=excluded.updated_at`);

    let importedCount = 0;
    for (const account of accounts) {
      let page = 1;
      while (page <= MAX_PAGES) {
        const params = new URLSearchParams({ bank_account_id: account.id, page: String(page), per_page: '100', sort_by: 'settled_at:desc' });
        params.append('status[]', 'completed');
        params.append('status[]', 'pending');
        const payload = await request<{ transactions?: QontoTransaction[]; meta?: { next_page?: number | null; total_pages?: number | null } }>(`/v2/transactions?${params}`, auth);
        const transactions = payload.transactions || [];
        const savePage = db.transaction(() => transactions.forEach((transaction) => {
          const externalId = transaction.id || transaction.transaction_id;
          if (!externalId) return;
          const label = transaction.label?.trim() || transaction.reference?.trim() || 'Opération Qonto';
          const categoryFromQonto = qontoCategory(transaction);
          const classification = classifyExpense({ label, reference: transaction.reference, note: transaction.note, qontoCategory: categoryFromQonto });
          upsert.run({
            id: `qonto:${account.id}:${externalId}`,
            externalId,
            bankAccountId: account.id,
            date: transaction.settled_at || transaction.emitted_at || transaction.updated_at || now,
            side: transaction.side === 'credit' ? 'credit' : 'debit',
            amountCents: absoluteCents(transaction),
            currency: transaction.currency || account.currency || 'EUR',
            vendor: normalizeVendor(label),
            label,
            reference: transaction.reference || null,
            note: transaction.note || null,
            qontoCategory: categoryFromQonto,
            operationType: transaction.operation_type || 'other',
            status: transaction.status || 'completed',
            category: classification.category,
            subcategory: classification.subcategory,
            rawJson: JSON.stringify(transaction),
            createdAt: now,
            updatedAt: now,
          });
          importedCount += 1;
        }));
        savePage();
        const nextPage = payload.meta?.next_page;
        if (!nextPage && (!payload.meta?.total_pages || page >= payload.meta.total_pages)) break;
        page = nextPage || page + 1;
      }
    }

    db.prepare("UPDATE sync_runs SET status='success', completed_at=?, imported_count=?, message=? WHERE id=?")
      .run(new Date().toISOString(), importedCount, `Connexion ${auth.mode} · ${accounts.length} compte(s)`, run.lastInsertRowid);
    return { importedCount, accountCount: accounts.length, authMode: auth.mode };
  } catch (error) {
    db.prepare("UPDATE sync_runs SET status='error', completed_at=?, message=? WHERE id=?")
      .run(new Date().toISOString(), error instanceof Error ? error.message : 'Erreur inconnue', run.lastInsertRowid);
    throw error;
  }
};

