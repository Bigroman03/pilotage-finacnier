import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, ArrowUpCircle, BarChart3, Building2, CalendarRange, CheckCircle2,
  ChevronRight, CircleDollarSign, Database, Gauge, Landmark, LayoutDashboard, Loader2, PiggyBank,
  Plus, RefreshCw, Scale, Search, Settings2, ShoppingCart, Timer, Trash2, TrendingDown,
  Trophy, WalletCards, XCircle,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type {
  DashboardResponse, ExpenseHierarchy, FinancialKpiResponse, ForecastMonth, PlannedExpense,
  RecurringVendor, VendorRanking,
} from '../shared/types';
import { api, formatDate, formatEUR } from './api';

type Tab = 'dashboard' | 'expenses' | 'vendors' | 'forecast' | 'kpis' | 'connections';

type ExpensesResponse = { totalCents: number; transactionCount: number; hierarchy: ExpenseHierarchy[] };
type VendorsResponse = {
  totalExpenseCents: number;
  recurringMonthlyCents: number;
  recurringCount: number;
  vendors: VendorRanking[];
  recurringVendors: RecurringVendor[];
};
type ForecastResponse = {
  assumptions: { cashBalanceCents: number; stripeMrrCents: number; recurringQontoCents: number };
  months: ForecastMonth[];
  plannedExpenses: PlannedExpense[];
};
type ConnectionsResponse = {
  qonto: { configured: boolean; lastRun: { status: string; completed_at: string | null; imported_count: number; message: string | null } | null };
  stripe: { configured: boolean; lastRun: { status: string; completed_at: string | null; imported_count: number; message: string | null } | null };
};

const tabs: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Vue d’ensemble', icon: LayoutDashboard },
  { id: 'expenses', label: 'Toutes les dépenses', icon: ShoppingCart },
  { id: 'vendors', label: 'Fournisseurs', icon: Building2 },
  { id: 'forecast', label: 'Prévisionnel', icon: CalendarRange },
  { id: 'kpis', label: 'KPI’s', icon: Gauge },
  { id: 'connections', label: 'Connexions', icon: Settings2 },
];

const useRemote = <T,>(path: string, refreshKey = 0) => {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<T>(path).then((result) => { if (active) { setData(result); setError(''); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Erreur inconnue'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, refreshKey]);
  return { data, error, loading };
};

const Loading = () => <div className="state"><Loader2 className="spin" /> Chargement…</div>;
const ErrorState = ({ message }: { message: string }) => <div className="state state-error"><XCircle /> {message}</div>;
const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;

const KpiCard = ({ icon: Icon, label, value, detail, tone }: {
  icon: typeof WalletCards; label: string; value: string; detail: string; tone?: 'good' | 'bad';
}) => <div className={`card kpi ${tone || ''}`}><div className="kpi-head"><span>{label}</span><Icon size={18} /></div><strong>{value}</strong><small>{detail}</small></div>;

const Dashboard = ({ refreshKey }: { refreshKey: number }) => {
  const { data, error, loading } = useRemote<DashboardResponse>('/api/dashboard', refreshKey);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error} />;
  const chart = data.topCategories.map((row) => ({ name: row.name, value: row.valueCents }));
  const cashflowChart = data.cashflowMonths.map((month) => ({
    name: month.label,
    gains: month.inflowsCents,
    pertes: month.outflowsCents,
  }));
  return <div className="page-stack">
    {(!data.connections.qonto || !data.connections.stripe) && <div className="notice"><Settings2 size={18} /><span>Connecte Qonto et Stripe dans l’onglet Connexions pour alimenter toutes les données réelles.</span></div>}
    <div className="kpi-grid">
      <KpiCard icon={WalletCards} label="Trésorerie Qonto" value={formatEUR(data.kpis.cashBalanceCents)} detail="Solde actuel des comptes EUR" />
      <KpiCard icon={TrendingDown} label="Dépenses du mois" value={formatEUR(data.kpis.currentMonthExpensesCents)} detail="Toutes dépenses Qonto catégorisées" tone="bad" />
      <KpiCard icon={Building2} label="Abonnements fournisseurs" value={formatEUR(data.kpis.recurringMonthlyCents)} detail="Estimation mensuelle automatique" />
      <KpiCard icon={CalendarRange} label="Dépenses prévues à 30 jours" value={formatEUR(data.kpis.plannedNext30DaysCents)} detail="Ajouts manuels mensuels et uniques" />
      <KpiCard icon={CircleDollarSign} label="MRR Stripe HT" value={formatEUR(data.kpis.stripeMrrCents)} detail={`${data.kpis.activeStripeSubscriptions} abonnement(s) actif(s) · hors taxes`} tone="good" />
    </div>
    <section className="card chart-card"><div className="section-title"><div><h2>Gains et pertes</h2><p>Comparatif mensuel des encaissements et décaissements constatés sur Qonto</p></div></div>
      <ResponsiveContainer width="100%" height={330}><BarChart data={cashflowChart} barGap={7}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" /><YAxis tickFormatter={(value) => `${Math.round(value / 100)} €`} /><Tooltip formatter={(value) => formatEUR(Number(value))} /><Legend /><Bar dataKey="gains" name="Gains / encaissements" fill="#2f765d" radius={[6, 6, 0, 0]} /><Bar dataKey="pertes" name="Pertes / décaissements" fill="#d87a53" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer>
    </section>
    <div className="two-columns">
      <section className="card chart-card"><div className="section-title"><div><h2>Dépenses par grande catégorie</h2><p>Mois en cours</p></div></div>
        {chart.length ? <ResponsiveContainer width="100%" height={310}><BarChart data={chart} layout="vertical" margin={{ left: 20, right: 20 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={(value) => `${Math.round(value / 100)} €`} /><YAxis type="category" dataKey="name" width={145} tick={{ fontSize: 11 }} /><Tooltip formatter={(value) => formatEUR(Number(value))} /><Bar dataKey="value" name="Dépenses" fill="#d87a53" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer> : <Empty>Aucune dépense synchronisée.</Empty>}
      </section>
      <section className="card"><div className="section-title"><div><h2>Prochaines dépenses prévues</h2><p>Échéances saisies manuellement</p></div></div>
        {data.upcomingPlanned.length ? <div className="compact-list">{data.upcomingPlanned.map((expense) => <div key={expense.id} className="compact-row"><div><strong>{expense.label}</strong><span>{expense.vendor} · {expense.kind === 'monthly' ? 'Mensuelle' : 'Unique'}</span></div><div className="right"><strong>{formatEUR(expense.amountCents)}</strong><span>{formatDate(expense.startDate)}</span></div></div>)}</div> : <Empty>Aucune dépense future enregistrée.</Empty>}
      </section>
    </div>
    <section className="card"><div className="section-title"><div><h2>Dernières dépenses Qonto</h2><p>Importées et classées automatiquement</p></div></div>
      {data.recentExpenses.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Fournisseur</th><th>Catégorie</th><th>Libellé</th><th className="amount">Montant</th></tr></thead><tbody>{data.recentExpenses.map((expense) => <tr key={expense.id}><td>{formatDate(expense.date)}</td><td><strong>{expense.vendor}</strong></td><td><span className="tag">{expense.category}</span></td><td>{expense.label}</td><td className="amount expense">−{formatEUR(expense.amountCents)}</td></tr>)}</tbody></table></div> : <Empty>Aucune dépense synchronisée.</Empty>}
    </section>
  </div>;
};

const Expenses = ({ refreshKey }: { refreshKey: number }) => {
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return `/api/expenses?${params}`;
  }, [search, from, to]);
  const { data, error, loading } = useRemote<ExpensesResponse>(path, refreshKey);
  return <div className="page-stack">
    <div className="toolbar card"><div className="search-box"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un fournisseur, libellé…" /></div><label>Du <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Au <input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label></div>
    {loading ? <Loading /> : error || !data ? <ErrorState message={error} /> : <>
      <div className="summary-line"><strong>{formatEUR(data.totalCents)}</strong><span>{data.transactionCount} dépense(s) · classement catégorie → sous-catégorie → fournisseur → opération</span></div>
      {data.hierarchy.length ? <div className="hierarchy">{data.hierarchy.map((category, categoryIndex) => <details className="card hierarchy-level category" key={category.category} open={categoryIndex < 3}><summary><span className="summary-label"><ChevronRight size={18} /><span><strong>{category.category}</strong><small>{category.transactionCount} opération(s)</small></span></span><strong>{formatEUR(category.totalCents)}</strong></summary><div className="hierarchy-content">{category.subcategories.map((subcategory) => <details className="hierarchy-level subcategory" key={subcategory.subcategory}><summary><span className="summary-label"><ChevronRight size={16} /><span><strong>{subcategory.subcategory}</strong><small>{subcategory.transactionCount} opération(s)</small></span></span><strong>{formatEUR(subcategory.totalCents)}</strong></summary><div className="hierarchy-content">{subcategory.vendors.map((vendor) => <details className="hierarchy-level vendor" key={vendor.vendor}><summary><span className="summary-label"><ChevronRight size={15} /><span><strong>{vendor.vendor}</strong><small>{vendor.transactionCount} opération(s)</small></span></span><strong>{formatEUR(vendor.totalCents)}</strong></summary><div className="table-wrap nested"><table><thead><tr><th>Date</th><th>Libellé</th><th>Type</th><th>Statut</th><th className="amount">Montant</th></tr></thead><tbody>{vendor.transactions.map((transaction) => <tr key={transaction.id}><td>{formatDate(transaction.date)}</td><td>{transaction.label}</td><td>{transaction.operationType}</td><td><span className="tag subtle">{transaction.status}</span></td><td className="amount expense">−{formatEUR(transaction.amountCents)}</td></tr>)}</tbody></table></div></details>)}</div></details>)}</div></details>)}</div> : <Empty>Aucune dépense ne correspond aux filtres.</Empty>}
    </>}
  </div>;
};

const Vendors = ({ refreshKey }: { refreshKey: number }) => {
  const { data, error, loading } = useRemote<VendorsResponse>('/api/vendors', refreshKey);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error} />;
  const topChart = data.vendors.slice(0, 10).map((vendor) => ({ name: vendor.vendor, value: vendor.totalCents }));
  return <div className="page-stack">
    <div className="three-columns">
      <KpiCard icon={Building2} label="Total fournisseurs" value={formatEUR(data.totalExpenseCents)} detail={`${data.vendors.length} fournisseur(s) classé(s)`} />
      <KpiCard icon={RefreshCw} label="Coût récurrent mensuel" value={formatEUR(data.recurringMonthlyCents)} detail={`${data.recurringCount} abonnement(s) détecté(s)`} />
      <KpiCard icon={Trophy} label="Premier fournisseur" value={data.vendors[0]?.vendor || '—'} detail={data.vendors[0] ? formatEUR(data.vendors[0].totalCents) : 'Aucune dépense'} />
    </div>
    <section className="card chart-card"><div className="section-title"><div><h2>Top dépenses fournisseurs</h2><p>Classement cumulé sur tout l’historique Qonto synchronisé</p></div></div>
      {topChart.length ? <ResponsiveContainer width="100%" height={Math.max(330, topChart.length * 42)}><BarChart data={topChart} layout="vertical" margin={{ left: 25, right: 25 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={(value) => `${Math.round(value / 100)} €`} /><YAxis type="category" dataKey="name" width={155} tick={{ fontSize: 11 }} /><Tooltip formatter={(value) => formatEUR(Number(value))} /><Bar dataKey="value" name="Dépenses cumulées" fill="#d87a53" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer> : <Empty>Aucun fournisseur synchronisé.</Empty>}
    </section>
    <section className="card"><div className="section-title"><div><h2>Classement complet</h2><p>Montant cumulé, poids dans les dépenses et fréquence.</p></div></div>
      {data.vendors.length ? <div className="table-wrap"><table><thead><tr><th>Rang</th><th>Fournisseur</th><th>Hiérarchie</th><th className="amount">Dépenses</th><th className="amount">Part</th><th className="amount">Opérations</th><th>Dernière dépense</th><th>Récurrent</th></tr></thead><tbody>{data.vendors.map((vendor) => <tr key={vendor.vendor}><td><span className={`rank rank-${vendor.rank}`}>{vendor.rank}</span></td><td><strong>{vendor.vendor}</strong></td><td><span className="tag">{vendor.category}</span><small className="block">{vendor.subcategory}</small></td><td className="amount"><strong>{formatEUR(vendor.totalCents)}</strong><small className="block">Moy. {formatEUR(vendor.averageTransactionCents)}</small></td><td className="amount">{vendor.sharePercent.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %</td><td className="amount">{vendor.transactionCount} sur {vendor.activeMonths} mois</td><td>{formatDate(vendor.lastSeenAt)}</td><td>{vendor.recurring ? <span className="confidence high">Oui · {formatEUR(vendor.estimatedMonthlyCents || 0)}/mois</span> : <span className="tag subtle">Non détecté</span>}</td></tr>)}</tbody></table></div> : <Empty>Aucun fournisseur synchronisé.</Empty>}
    </section>
    <section className="card"><div className="section-title"><div><h2>Abonnements et fournisseurs mensuels</h2><p>Détection automatique sur au moins deux mois distincts ; les montants restent à valider.</p></div></div>
      {data.recurringVendors.length ? <div className="table-wrap"><table><thead><tr><th>Fournisseur</th><th>Hiérarchie</th><th className="amount">Mensuel estimé</th><th className="amount">Moyenne/opération</th><th className="amount">Occurrences</th><th>Dernière dépense</th><th>Confiance</th></tr></thead><tbody>{data.recurringVendors.map((vendor) => <tr key={vendor.vendor}><td><strong>{vendor.vendor}</strong></td><td><span className="tag">{vendor.category}</span><small className="block">{vendor.subcategory}</small></td><td className="amount"><strong>{formatEUR(vendor.estimatedMonthlyCents)}</strong></td><td className="amount">{formatEUR(vendor.averageTransactionCents)}</td><td className="amount">{vendor.occurrences} sur {vendor.activeMonths} mois</td><td>{formatDate(vendor.lastSeenAt)}</td><td><span className={`confidence ${vendor.confidence}`}>{vendor.confidence === 'high' ? 'Élevée' : 'Moyenne'}</span></td></tr>)}</tbody></table></div> : <Empty>Pas encore assez d’historique pour identifier les abonnements fournisseurs.</Empty>}
    </section>
  </div>;
};

const expenseDefaults = { label: '', vendor: '', amount: '', category: 'Logiciels & abonnements', subcategory: 'Abonnement', kind: 'monthly' as 'monthly' | 'one_off', startDate: new Date().toISOString().slice(0, 10), endDate: '', notes: '' };

const Forecast = ({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) => {
  const { data, error, loading } = useRemote<ForecastResponse>('/api/forecast?months=12', refreshKey);
  const [form, setForm] = useState(expenseDefaults);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setFormError('');
    try {
      await api('/api/planned-expenses', { method: 'POST', body: JSON.stringify({ label: form.label, vendor: form.vendor, amountCents: Math.round(Number(form.amount.replace(',', '.')) * 100), category: form.category, subcategory: form.subcategory, kind: form.kind, startDate: form.startDate, endDate: form.kind === 'monthly' && form.endDate ? form.endDate : null, notes: form.notes || null, active: true }) });
      setForm(expenseDefaults); onChanged();
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : 'Erreur'); }
    finally { setSaving(false); }
  };
  const remove = async (id: number) => { if (!window.confirm('Supprimer cette dépense prévue ?')) return; await api(`/api/planned-expenses/${id}`, { method: 'DELETE' }); onChanged(); };
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error} />;
  const chart = data.months.map((month) => ({ ...month, expenses: month.totalExpensesCents, balance: month.projectedBalanceCents, income: month.stripeMrrCents }));
  return <div className="page-stack">
    <div className="three-columns"><KpiCard icon={WalletCards} label="Solde de départ" value={formatEUR(data.assumptions.cashBalanceCents)} detail="Trésorerie Qonto actuelle" /><KpiCard icon={CircleDollarSign} label="MRR HT utilisé" value={formatEUR(data.assumptions.stripeMrrCents)} detail="Hypothèse mensuelle Stripe hors taxes" tone="good" /><KpiCard icon={Building2} label="Fournisseurs récurrents" value={formatEUR(data.assumptions.recurringQontoCents)} detail="Base mensuelle détectée dans Qonto" /></div>
    <section className="card chart-card"><div className="section-title"><div><h2>Prévision à 12 mois</h2><p>Solde projeté = trésorerie + MRR Stripe HT − fournisseurs récurrents − dépenses ajoutées.</p></div></div><ResponsiveContainer width="100%" height={330}><AreaChart data={chart}><defs><linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2f765d" stopOpacity={0.35} /><stop offset="95%" stopColor="#2f765d" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" /><YAxis tickFormatter={(value) => `${Math.round(value / 100)} €`} /><Tooltip formatter={(value) => formatEUR(Number(value))} /><Area type="monotone" dataKey="balance" name="Trésorerie projetée" stroke="#2f765d" strokeWidth={3} fill="url(#forecastFill)" /><Area type="monotone" dataKey="expenses" name="Dépenses prévues" stroke="#d87a53" fill="transparent" /></AreaChart></ResponsiveContainer></section>
    <div className="two-columns forecast-layout"><section className="card"><div className="section-title"><div><h2>Ajouter une dépense future</h2><p>Mensuelle ou unique, avec sa date de démarrage.</p></div></div><form className="expense-form" onSubmit={submit}><label>Nom de la dépense<input required minLength={2} value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="Ex. Abonnement logiciel CRM" /></label><label>Fournisseur<input required minLength={2} value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} placeholder="Ex. HubSpot" /></label><div className="form-row"><label>Montant TTC (€)<input required inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="99,00" /></label><label>Type<select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as 'monthly' | 'one_off' })}><option value="monthly">Mensuelle</option><option value="one_off">Unique</option></select></label></div><div className="form-row"><label>Catégorie<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>Logiciels & abonnements</option><option>Marketing & acquisition</option><option>Infrastructure & hébergement</option><option>Prestataires & honoraires</option><option>Personnel</option><option>Locaux & fonctionnement</option><option>Banque & finance</option><option>Déplacements & repas</option><option>Taxes & administrations</option><option>Assurances</option><option>Autres dépenses</option></select></label><label>Sous-catégorie<input required value={form.subcategory} onChange={(event) => setForm({ ...form, subcategory: event.target.value })} /></label></div><div className="form-row"><label>{form.kind === 'monthly' ? 'À partir du' : 'Date prévue'}<input required type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>{form.kind === 'monthly' && <label>Jusqu’au (facultatif)<input type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label>}</div><label>Notes<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Contexte ou hypothèse…" /></label>{formError && <p className="form-error">{formError}</p>}<button className="button primary" disabled={saving}>{saving ? <Loader2 className="spin" size={17} /> : <Plus size={17} />} Ajouter au prévisionnel</button></form></section>
      <section className="card"><div className="section-title"><div><h2>Dépenses ajoutées</h2><p>{data.plannedExpenses.length} dépense(s) future(s)</p></div></div>{data.plannedExpenses.length ? <div className="planned-list">{data.plannedExpenses.map((expense) => <div className="planned-row" key={expense.id}><div className="planned-icon">{expense.kind === 'monthly' ? <RefreshCw size={18} /> : <CircleDollarSign size={18} />}</div><div className="planned-info"><strong>{expense.label}</strong><span>{expense.vendor} · {expense.category}</span><small>{expense.kind === 'monthly' ? `Tous les mois à partir du ${formatDate(expense.startDate)}` : `Le ${formatDate(expense.startDate)}`}{expense.endDate ? ` jusqu’au ${formatDate(expense.endDate)}` : ''}</small></div><strong>{formatEUR(expense.amountCents)}</strong><button className="icon-button danger" onClick={() => void remove(expense.id)} aria-label="Supprimer"><Trash2 size={17} /></button></div>)}</div> : <Empty>Aucune dépense future ajoutée.</Empty>}</section></div>
    <section className="card"><div className="section-title"><div><h2>Détail mensuel du prévisionnel</h2><p>Les postes automatiques Qonto et les ajouts manuels sont séparés.</p></div></div><div className="table-wrap"><table><thead><tr><th>Mois</th><th className="amount">Fournisseurs Qonto</th><th className="amount">Ajouts mensuels</th><th className="amount">Dépenses uniques</th><th className="amount">Total dépenses</th><th className="amount">MRR Stripe HT</th><th className="amount">Solde projeté</th></tr></thead><tbody>{data.months.map((month) => <tr key={month.key}><td><strong>{month.label}</strong></td><td className="amount">{formatEUR(month.recurringQontoCents)}</td><td className="amount">{formatEUR(month.plannedMonthlyCents)}</td><td className="amount">{formatEUR(month.plannedOneOffCents)}</td><td className="amount expense"><strong>{formatEUR(month.totalExpensesCents)}</strong></td><td className="amount income">{formatEUR(month.stripeMrrCents)}</td><td className="amount"><strong>{formatEUR(month.projectedBalanceCents)}</strong></td></tr>)}</tbody></table></div></section>
  </div>;
};

const euroInputToCents = (value: string) => Math.round(Number(value.replace(',', '.') || 0) * 100);

const FinancialKpis = ({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) => {
  const { data, error, loading } = useRemote<FinancialKpiResponse>('/api/kpis', refreshKey);
  const [form, setForm] = useState({ receivables: '0', inventory: '0', supplierDebts: '0' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  useEffect(() => {
    if (!data) return;
    setForm({
      receivables: String(data.settings.receivablesCents / 100),
      inventory: String(data.settings.inventoryCents / 100),
      supplierDebts: String(data.settings.supplierDebtsCents / 100),
    });
  }, [data]);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setFormError('');
    try {
      await api('/api/kpis/settings', { method: 'PUT', body: JSON.stringify({
        receivablesCents: euroInputToCents(form.receivables),
        inventoryCents: euroInputToCents(form.inventory),
        supplierDebtsCents: euroInputToCents(form.supplierDebts),
      }) });
      onChanged();
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : 'Erreur'); }
    finally { setSaving(false); }
  };
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error} />;
  const metrics = data.metrics;
  const coverage = metrics.recurringCoveragePercent === null ? '—' : `${metrics.recurringCoveragePercent.toLocaleString('fr-FR')} %`;
  const runway = metrics.runwayMonths === null ? 'Pas de burn' : `${metrics.runwayMonths.toLocaleString('fr-FR')} mois`;
  return <div className="page-stack">
    <div className="notice"><Activity size={18} /><span>Les flux Qonto représentent les mouvements bancaires réellement encaissés et décaissés. Le MRR et l’ARR proviennent séparément de Stripe et sont affichés hors taxes.</span></div>
    <div className="kpi-grid financial-grid">
      <KpiCard icon={CircleDollarSign} label="MRR HT" value={formatEUR(metrics.mrrHtCents)} detail="Revenu récurrent mensuel Stripe hors taxes" tone="good" />
      <KpiCard icon={ArrowUpCircle} label="ARR HT" value={formatEUR(metrics.arrHtCents)} detail="MRR HT × 12" tone="good" />
      <KpiCard icon={Scale} label="BFR simplifié" value={formatEUR(metrics.bfrCents)} detail="Créances + stocks − dettes fournisseurs" />
      <KpiCard icon={Activity} label="Flux net du mois" value={formatEUR(metrics.currentMonthNetCents)} detail={`${formatEUR(metrics.currentMonthInflowsCents)} encaissés · ${formatEUR(metrics.currentMonthOutflowsCents)} décaissés`} tone={metrics.currentMonthNetCents >= 0 ? 'good' : 'bad'} />
      <KpiCard icon={TrendingDown} label="Burn rate" value={formatEUR(metrics.burnRateCents)} detail="Déficit mensuel moyen sur les mois terminés" tone={metrics.burnRateCents > 0 ? 'bad' : 'good'} />
      <KpiCard icon={Timer} label="Runway" value={runway} detail="Trésorerie ÷ burn rate mensuel" />
      <KpiCard icon={PiggyBank} label="Dépenses moyennes" value={formatEUR(metrics.averageMonthlyOutflowsCents)} detail="Décaissements mensuels moyens Qonto" />
      <KpiCard icon={Gauge} label="Couverture des charges fixes" value={coverage} detail={`${formatEUR(metrics.recurringCostsCents)} de fournisseurs récurrents`} />
    </div>
    <div className="two-columns kpi-settings-layout">
      <section className="card"><div className="section-title"><div><h2>Paramètres du BFR</h2><p>Renseigne les montants comptables actuels pour obtenir une estimation utile.</p></div></div><form className="expense-form" onSubmit={save}>
        <label>Créances clients à recevoir (€)<input required min="0" type="number" step="0.01" value={form.receivables} onChange={(event) => setForm({ ...form, receivables: event.target.value })} /></label>
        <label>Stocks et en-cours (€)<input required min="0" type="number" step="0.01" value={form.inventory} onChange={(event) => setForm({ ...form, inventory: event.target.value })} /></label>
        <label>Dettes fournisseurs à payer (€)<input required min="0" type="number" step="0.01" value={form.supplierDebts} onChange={(event) => setForm({ ...form, supplierDebts: event.target.value })} /></label>
        {formError && <p className="form-error">{formError}</p>}<button className="button primary" disabled={saving}>{saving ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />} Mettre à jour le BFR</button>
      </form></section>
      <section className="card kpi-explainer"><div className="section-title"><div><h2>Lecture rapide</h2><p>Les indicateurs à surveiller en priorité.</p></div></div><div className="definition-list"><div><strong>BFR</strong><span>Besoin de trésorerie créé par le décalage entre encaissements clients et paiements fournisseurs.</span></div><div><strong>Burn rate</strong><span>Montant de trésorerie consommé chaque mois lorsque les sorties dépassent les entrées.</span></div><div><strong>Runway</strong><span>Nombre estimé de mois avant épuisement de la trésorerie au rythme de consommation actuel.</span></div><div><strong>Couverture</strong><span>Part des dépenses récurrentes fournisseurs couverte par le MRR HT.</span></div></div><p className="data-caution">Le BFR affiché est simplifié et dépend des montants saisis. Il ne remplace pas le calcul de ton expert-comptable.</p></section>
    </div>
  </div>;
};

const Connections = ({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) => {
  const { data, error, loading } = useRemote<ConnectionsResponse>('/api/connections', refreshKey);
  const [syncing, setSyncing] = useState<'qonto' | 'stripe' | null>(null);
  const [message, setMessage] = useState('');
  const sync = useCallback(async (source: 'qonto' | 'stripe') => { setSyncing(source); setMessage(''); try { await api(`/api/sync/${source}`, { method: 'POST' }); setMessage(`${source === 'qonto' ? 'Qonto' : 'Stripe'} synchronisé avec succès.`); onChanged(); } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Erreur'); } finally { setSyncing(null); } }, [onChanged]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error} />;
  const ConnectionCard = ({ source, icon: Icon, configured, lastRun }: { source: 'qonto' | 'stripe'; icon: typeof Landmark; configured: boolean; lastRun: ConnectionsResponse['qonto']['lastRun'] }) => <section className="card connection-card"><div className="connection-logo"><Icon size={28} /></div><div className="connection-main"><div className="section-title"><div><h2>{source === 'qonto' ? 'Qonto' : 'Stripe'}</h2><p>{source === 'qonto' ? 'Comptes, soldes, transactions, catégories et fournisseurs.' : 'MRR HT et abonnements actifs en lecture seule.'}</p></div><span className={`status ${configured ? 'connected' : 'disconnected'}`}>{configured ? <CheckCircle2 size={15} /> : <XCircle size={15} />}{configured ? 'Configuré' : 'Non configuré'}</span></div><div className="connection-meta"><span>Dernière synchronisation : <strong>{formatDate(lastRun?.completed_at || null)}</strong></span>{lastRun && <span>{lastRun.imported_count} élément(s) · {lastRun.message}</span>}</div><button className="button primary" disabled={!configured || syncing !== null} onClick={() => void sync(source)}>{syncing === source ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />} Synchroniser maintenant</button></div></section>;
  return <div className="page-stack"><div className="notice security"><Database size={18} /><span>Les clés ne sont jamais envoyées au navigateur. Le serveur écoute seulement sur <code>127.0.0.1</code> par défaut.</span></div>{message && <div className="notice">{message}</div>}<div className="connections-grid"><ConnectionCard source="qonto" icon={Landmark} configured={data.qonto.configured} lastRun={data.qonto.lastRun} /><ConnectionCard source="stripe" icon={CircleDollarSign} configured={data.stripe.configured} lastRun={data.stripe.lastRun} /></div><section className="card setup"><div className="section-title"><div><h2>Configuration locale</h2><p>Copie <code>.env.example</code> vers <code>.env</code>, sans jamais commiter ce dernier.</p></div></div><ol><li><strong>Qonto recommandé :</strong> renseigner <code>QONTO_ACCESS_TOKEN</code> avec OAuth et le scope <code>organization.read</code>.</li><li><strong>Qonto alternatif :</strong> renseigner <code>QONTO_API_LOGIN</code> et <code>QONTO_API_SECRET</code> pour une seule entreprise.</li><li><strong>Stripe :</strong> renseigner une Restricted API Key <code>rk_live_…</code> dans <code>STRIPE_RESTRICTED_KEY</code>, avec les lectures Subscriptions, Prices et Products uniquement.</li><li>Redémarrer l’application puis lancer chaque synchronisation.</li></ol></section></div>;
};

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);
  const active = tabs.find((item) => item.id === tab)!;
  return <div className="app-shell"><aside><div className="brand"><div className="brand-mark"><BarChart3 /></div><div><strong>Pilotage</strong><span>Bien-être Connect</span></div></div><nav>{tabs.map((item) => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon size={19} />{item.label}</button>)}</nav><div className="sidebar-foot"><Landmark size={16} /><span>Qonto + Stripe<br />Lecture seule</span></div></aside><main><header><div><span className="eyebrow">Pilotage financier</span><h1>{active.label}</h1></div><button className="button secondary" onClick={refresh}><RefreshCw size={17} /> Actualiser</button></header><div className="content">{tab === 'dashboard' && <Dashboard refreshKey={refreshKey} />}{tab === 'expenses' && <Expenses refreshKey={refreshKey} />}{tab === 'vendors' && <Vendors refreshKey={refreshKey} />}{tab === 'forecast' && <Forecast refreshKey={refreshKey} onChanged={refresh} />}{tab === 'kpis' && <FinancialKpis refreshKey={refreshKey} onChanged={refresh} />}{tab === 'connections' && <Connections refreshKey={refreshKey} onChanged={refresh} />}</div></main></div>;
}
