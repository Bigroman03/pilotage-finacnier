import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, ArrowUpCircle, BarChart3, Building2, CalendarRange, CheckCircle2,
  ChevronRight, CircleDollarSign, Database, Gauge, Landmark, LayoutDashboard, Loader2, PiggyBank,
  Pencil, Plus, RefreshCw, Scale, Search, Settings2, ShoppingCart, Timer, Trash2, TrendingDown,
  Trophy, Users, WalletCards, XCircle,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type {
  ClientsResponse, DashboardResponse, ExpenseHierarchy, FinancialKpiResponse, ForecastMonth, PlannedExpense,
  RecurringVendor, VendorRanking,
} from '../shared/types';
import { plannedExpenseOccursInMonth } from '../shared/forecast';
import { api, formatDate, formatEUR } from './api';

type Tab = 'dashboard' | 'expenses' | 'vendors' | 'clients' | 'forecast' | 'kpis' | 'connections';

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
  { id: 'clients', label: 'Clients', icon: Users },
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

const euroInputToCents = (value: string) => Math.round(Number(value.replace(',', '.') || 0) * 100);

const FinancialKpiSection = ({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) => {
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
  return <>
    <section><div className="section-title"><div><h2>Indicateurs financiers</h2><p>Les KPI essentiels sont désormais réunis dans la vue d’ensemble.</p></div></div>
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
    </section>
    <div className="two-columns kpi-settings-layout">
      <section className="card"><div className="section-title"><div><h2>Paramètres du BFR</h2><p>Renseigne les montants comptables actuels pour obtenir une estimation utile.</p></div></div><form className="expense-form" onSubmit={save}>
        <label>Créances clients à recevoir (€)<input required min="0" type="number" step="0.01" value={form.receivables} onChange={(event) => setForm({ ...form, receivables: event.target.value })} /></label>
        <label>Stocks et en-cours (€)<input required min="0" type="number" step="0.01" value={form.inventory} onChange={(event) => setForm({ ...form, inventory: event.target.value })} /></label>
        <label>Dettes fournisseurs à payer (€)<input required min="0" type="number" step="0.01" value={form.supplierDebts} onChange={(event) => setForm({ ...form, supplierDebts: event.target.value })} /></label>
        {formError && <p className="form-error">{formError}</p>}<button className="button primary" disabled={saving}>{saving ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />} Mettre à jour le BFR</button>
      </form></section>
      <section className="card kpi-explainer"><div className="section-title"><div><h2>Lecture rapide</h2><p>Les indicateurs à surveiller en priorité.</p></div></div><div className="definition-list"><div><strong>BFR</strong><span>Besoin de trésorerie créé par le décalage entre encaissements clients et paiements fournisseurs.</span></div><div><strong>Burn rate</strong><span>Montant de trésorerie consommé chaque mois lorsque les sorties dépassent les entrées.</span></div><div><strong>Runway</strong><span>Nombre estimé de mois avant épuisement de la trésorerie au rythme de consommation actuel.</span></div><div><strong>Couverture</strong><span>Part des dépenses récurrentes fournisseurs couverte par le MRR HT.</span></div></div><p className="data-caution">Le BFR affiché est simplifié et dépend des montants saisis. Il ne remplace pas le calcul de ton expert-comptable.</p></section>
    </div>
  </>;
};

const Dashboard = ({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) => {
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = `${new Date().getFullYear()}-01-01`;
  const [periodMode, setPeriodMode] = useState<DashboardResponse['period']['mode']>('month');
  const [customDraft, setCustomDraft] = useState({ from: defaultFrom, to: today });
  const [customRange, setCustomRange] = useState(customDraft);
  const dashboardPath = useMemo(() => {
    const params = new URLSearchParams({ period: periodMode });
    if (periodMode === 'custom') { params.set('from', customRange.from); params.set('to', customRange.to); }
    return `/api/dashboard?${params}`;
  }, [periodMode, customRange]);
  const { data, error, loading } = useRemote<DashboardResponse>(dashboardPath, refreshKey);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error} />;
  const chart = data.topCategories.map((row) => ({ name: row.name, value: row.valueCents }));
  const cashflowChart = data.trend.map((point) => ({
    name: point.label,
    gains: point.inflowsCents,
    pertes: point.outflowsCents,
    caHt: point.revenueHtCents,
  }));
  return <div className="page-stack">
    <section className="card dashboard-period-bar"><div><span className="eyebrow">Période analysée</span><strong>{data.period.label}</strong></div><div className="period-actions"><div className="period-segmented">{([['day', 'Journalier'], ['week', 'Hebdomadaire'], ['month', 'Mensuel'], ['year', 'Annuel'], ['custom', 'Personnalisé']] as const).map(([value, label]) => <button key={value} className={periodMode === value ? 'active' : ''} onClick={() => setPeriodMode(value)}>{label}</button>)}</div>{periodMode === 'custom' && <div className="custom-period"><label>Du<input type="date" value={customDraft.from} max={customDraft.to} onChange={(event) => setCustomDraft({ ...customDraft, from: event.target.value })} /></label><label>Au<input type="date" value={customDraft.to} min={customDraft.from} onChange={(event) => setCustomDraft({ ...customDraft, to: event.target.value })} /></label><button className="button primary" onClick={() => setCustomRange(customDraft)}>Appliquer</button></div>}</div></section>
    {(!data.connections.qonto || !data.connections.stripe) && <div className="notice"><Settings2 size={18} /><span>Connecte Qonto et Stripe dans l’onglet Connexions pour alimenter toutes les données réelles.</span></div>}
    <div className="kpi-grid dashboard-kpis">
      <KpiCard icon={WalletCards} label="Trésorerie Qonto" value={formatEUR(data.kpis.cashBalanceCents)} detail="Solde actuel des comptes EUR" />
      <KpiCard icon={CircleDollarSign} label="Chiffre d’affaires HT" value={formatEUR(data.kpis.revenueHtCents)} detail={`Factures Stripe payées · ${data.period.label.toLowerCase()}`} tone="good" />
      <KpiCard icon={TrendingDown} label="Dépenses de la période" value={formatEUR(data.kpis.periodExpensesCents)} detail="Toutes dépenses Qonto catégorisées" tone="bad" />
      <KpiCard icon={Building2} label="Abonnements fournisseurs" value={formatEUR(data.kpis.recurringMonthlyCents)} detail="Estimation mensuelle automatique" />
      <KpiCard icon={CalendarRange} label="Dépenses prévues à 30 jours" value={formatEUR(data.kpis.plannedNext30DaysCents)} detail="Ajouts manuels mensuels et uniques" />
      <KpiCard icon={CircleDollarSign} label="MRR Stripe HT" value={formatEUR(data.kpis.stripeMrrCents)} detail={`${data.kpis.activeStripeSubscriptions} abonnement(s) actif(s) · hors taxes`} tone="good" />
    </div>
    <section className="card chart-card"><div className="section-title"><div><h2>Gains, pertes et chiffre d’affaires HT</h2><p>{data.period.label} · regroupement {data.period.bucket === 'day' ? 'journalier' : data.period.bucket === 'week' ? 'hebdomadaire' : data.period.bucket === 'month' ? 'mensuel' : 'annuel'}</p></div></div>
      <ResponsiveContainer width="100%" height={330}><BarChart data={cashflowChart} barGap={4}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" /><YAxis tickFormatter={(value) => `${Math.round(value / 100)} €`} /><Tooltip formatter={(value) => formatEUR(Number(value))} /><Legend /><Bar dataKey="gains" name="Encaissements Qonto" fill="#2f765d" radius={[6, 6, 0, 0]} /><Bar dataKey="caHt" name="CA HT Stripe" fill="#5c79a9" radius={[6, 6, 0, 0]} /><Bar dataKey="pertes" name="Décaissements Qonto" fill="#d87a53" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer>
    </section>
    <section className="card chart-card"><div className="section-title"><div><h2>Dépenses par grande catégorie</h2><p>{data.period.label}</p></div></div>
        {chart.length ? <ResponsiveContainer width="100%" height={310}><BarChart data={chart} layout="vertical" margin={{ left: 20, right: 20 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={(value) => `${Math.round(value / 100)} €`} /><YAxis type="category" dataKey="name" width={145} tick={{ fontSize: 11 }} /><Tooltip formatter={(value) => formatEUR(Number(value))} /><Bar dataKey="value" name="Dépenses" fill="#d87a53" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer> : <Empty>Aucune dépense synchronisée.</Empty>}
    </section>
    <FinancialKpiSection refreshKey={refreshKey} onChanged={onChanged} />
    <section className="card"><div className="section-title"><div><h2>Dernières dépenses Qonto de la période</h2><p>{data.period.label} · importées et classées automatiquement</p></div></div>
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
  const pieHead = data.vendors.slice(0, 8).map((vendor) => ({ name: vendor.vendor, value: vendor.totalCents }));
  const otherVendorsCents = data.vendors.slice(8).reduce((sum, vendor) => sum + vendor.totalCents, 0);
  const pieData = otherVendorsCents > 0 ? [...pieHead, { name: 'Autres fournisseurs', value: otherVendorsCents }] : pieHead;
  const pieColors = ['#1f5b45', '#2f765d', '#55937a', '#83b09b', '#d87a53', '#e69a74', '#efb595', '#cab578', '#b7bdb7'];
  return <div className="page-stack">
    <div className="three-columns">
      <KpiCard icon={Building2} label="Total fournisseurs" value={formatEUR(data.totalExpenseCents)} detail={`${data.vendors.length} fournisseur(s) classé(s)`} />
      <KpiCard icon={RefreshCw} label="Coût récurrent mensuel" value={formatEUR(data.recurringMonthlyCents)} detail={`${data.recurringCount} abonnement(s) détecté(s)`} />
      <KpiCard icon={Trophy} label="Premier fournisseur" value={data.vendors[0]?.vendor || '—'} detail={data.vendors[0] ? formatEUR(data.vendors[0].totalCents) : 'Aucune dépense'} />
    </div>
    <section className="card chart-card"><div className="section-title"><div><h2>Répartition des coûts fournisseurs</h2><p>Du plus gros coût au plus petit sur tout l’historique Qonto synchronisé</p></div></div>
      {pieData.length ? <div className="vendor-pie-layout"><ResponsiveContainer width="100%" height={390}><PieChart><Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={72} outerRadius={142} paddingAngle={1.5}>{pieData.map((entry, index) => <Cell key={entry.name} fill={pieColors[index % pieColors.length]} />)}</Pie><Tooltip formatter={(value) => formatEUR(Number(value))} /></PieChart></ResponsiveContainer><ol className="pie-ranking">{pieData.map((vendor, index) => <li key={vendor.name}><span><i style={{ background: pieColors[index % pieColors.length] }} />{vendor.name}</span><strong>{formatEUR(vendor.value)}</strong></li>)}</ol></div> : <Empty>Aucun fournisseur synchronisé.</Empty>}
    </section>
    <section className="card"><div className="section-title"><div><h2>Classement complet</h2><p>Montant cumulé, poids dans les dépenses et fréquence.</p></div></div>
      {data.vendors.length ? <div className="table-wrap"><table><thead><tr><th>Rang</th><th>Fournisseur</th><th>Hiérarchie</th><th className="amount">Dépenses</th><th className="amount">Part</th><th className="amount">Opérations</th><th>Dernière dépense</th><th>Récurrent</th></tr></thead><tbody>{data.vendors.map((vendor) => <tr key={vendor.vendor}><td><span className={`rank rank-${vendor.rank}`}>{vendor.rank}</span></td><td><strong>{vendor.vendor}</strong></td><td><span className="tag">{vendor.category}</span><small className="block">{vendor.subcategory}</small></td><td className="amount"><strong>{formatEUR(vendor.totalCents)}</strong><small className="block">Moy. {formatEUR(vendor.averageTransactionCents)}</small></td><td className="amount">{vendor.sharePercent.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %</td><td className="amount">{vendor.transactionCount} sur {vendor.activeMonths} mois</td><td>{formatDate(vendor.lastSeenAt)}</td><td>{vendor.recurring ? <span className="confidence high">Oui · {formatEUR(vendor.estimatedMonthlyCents || 0)}/mois</span> : <span className="tag subtle">Non détecté</span>}</td></tr>)}</tbody></table></div> : <Empty>Aucun fournisseur synchronisé.</Empty>}
    </section>
    <section className="card"><div className="section-title"><div><h2>Abonnements et fournisseurs mensuels</h2><p>Détection automatique sur au moins deux mois distincts ; les montants restent à valider.</p></div></div>
      {data.recurringVendors.length ? <div className="table-wrap"><table><thead><tr><th>Fournisseur</th><th>Hiérarchie</th><th className="amount">Mensuel estimé</th><th className="amount">Moyenne/opération</th><th className="amount">Occurrences</th><th>Dernière dépense</th><th>Confiance</th></tr></thead><tbody>{data.recurringVendors.map((vendor) => <tr key={vendor.vendor}><td><strong>{vendor.vendor}</strong></td><td><span className="tag">{vendor.category}</span><small className="block">{vendor.subcategory}</small></td><td className="amount"><strong>{formatEUR(vendor.estimatedMonthlyCents)}</strong></td><td className="amount">{formatEUR(vendor.averageTransactionCents)}</td><td className="amount">{vendor.occurrences} sur {vendor.activeMonths} mois</td><td>{formatDate(vendor.lastSeenAt)}</td><td><span className={`confidence ${vendor.confidence}`}>{vendor.confidence === 'high' ? 'Élevée' : 'Moyenne'}</span></td></tr>)}</tbody></table></div> : <Empty>Pas encore assez d’historique pour identifier les abonnements fournisseurs.</Empty>}
    </section>
  </div>;
};

const Clients = ({ refreshKey }: { refreshKey: number }) => {
  const { data, error, loading } = useRemote<ClientsResponse>('/api/clients', refreshKey);
  const [search, setSearch] = useState('');
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error} />;
  const needle = search.trim().toLocaleLowerCase('fr-FR');
  const filtered = data.clients.filter((client) => !needle || [client.name, client.email || '', ...client.offers.map((offer) => offer.productName)]
    .some((value) => value.toLocaleLowerCase('fr-FR').includes(needle)));
  const topChart = data.clients.slice(0, 10).map((client) => ({ name: client.name, value: client.lifetimeSpendHtCents }));
  return <div className="page-stack">
    <div className="kpi-grid clients-kpis">
      <KpiCard icon={Users} label="Clients mensuels" value={String(data.summary.activeClientCount)} detail={`${data.summary.activeSubscriptionCount} abonnement(s) actif(s)`} />
      <KpiCard icon={CircleDollarSign} label="MRR total HT" value={formatEUR(data.summary.totalMrrHtCents)} detail="Abonnements Stripe actifs" tone="good" />
      <KpiCard icon={ShoppingCart} label="Panier mensuel moyen HT" value={formatEUR(data.summary.averageMonthlyBasketHtCents)} detail="MRR HT ÷ clients mensuels" />
      <KpiCard icon={PiggyBank} label="CA encaissé HT" value={formatEUR(data.summary.lifetimeSpendHtCents)} detail={`${data.summary.paidInvoiceCount} facture(s) payée(s)`} />
      <KpiCard icon={Scale} label="Facture moyenne HT" value={formatEUR(data.summary.averageInvoiceHtCents)} detail="CA HT ÷ factures payées" />
    </div>
    <div className="notice security"><Database size={18} /><span>Les noms et emails clients restent dans la base SQLite locale. Ils ne sont jamais enregistrés dans GitHub.</span></div>
    {!data.clients.length && <div className="notice"><CircleDollarSign size={18} /><span>{data.sync.lastRun?.status === 'error' ? data.sync.lastRun.message : 'Aucun abonnement actif importé. Lance « Synchroniser maintenant » dans Connexions. La permission Stripe Subscriptions en lecture est indispensable.'}</span></div>}
    <section className="card chart-card"><div className="section-title"><div><h2>Top clients par chiffre d’affaires</h2><p>Classement sur les factures Stripe payées, montants hors taxes</p></div></div>
      {topChart.length ? <ResponsiveContainer width="100%" height={Math.max(330, topChart.length * 42)}><BarChart data={topChart} layout="vertical" margin={{ left: 25, right: 25 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tickFormatter={(value) => `${Math.round(value / 100)} €`} /><YAxis type="category" dataKey="name" width={155} tick={{ fontSize: 11 }} /><Tooltip formatter={(value) => formatEUR(Number(value))} /><Bar dataKey="value" name="CA encaissé HT" fill="#2f765d" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer> : <Empty>Les clients apparaîtront ici après la synchronisation des abonnements Stripe actifs.</Empty>}
    </section>
    <section className="card"><div className="section-title"><div><h2>Classement clients</h2><p>Offres actives, MRR HT et historique des factures payées.</p></div></div>
      <div className="toolbar client-toolbar"><div className="search-box"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un client ou une offre…" /></div></div>
      {filtered.length ? <div className="table-wrap"><table className="clients-table"><thead><tr><th>Rang</th><th>Client</th><th>Offre(s) active(s)</th><th className="amount">MRR HT</th><th className="amount">CA encaissé HT</th><th className="amount">Panier facture HT</th><th>Dernier paiement</th></tr></thead><tbody>{filtered.map((client) => <tr key={client.id}><td><span className={`rank rank-${client.rank}`}>{client.rank}</span></td><td><strong>{client.name}</strong>{client.email && <small className="block">{client.email}</small>}<small className="block">{client.activeSubscriptionCount} abonnement(s)</small></td><td><div className="offer-list">{client.offers.map((offer) => <span className="tag" key={`${offer.subscriptionId}-${offer.priceId}`}>{offer.productName}<small>{offer.quantity > 1 ? ` × ${offer.quantity}` : ''} · {offer.interval === 'year' ? 'annuel' : offer.interval === 'month' ? 'mensuel' : offer.interval}</small></span>)}</div></td><td className="amount income"><strong>{formatEUR(client.currentMrrHtCents)}</strong></td><td className="amount"><strong>{formatEUR(client.lifetimeSpendHtCents)}</strong><small className="block">{client.paidInvoiceCount} facture(s)</small></td><td className="amount">{formatEUR(client.averageInvoiceHtCents)}</td><td>{formatDate(client.lastPaidAt)}</td></tr>)}</tbody></table></div> : <Empty>Aucun client ne correspond à la recherche.</Empty>}
    </section>
  </div>;
};

const expenseDefaults = {
  label: '', vendor: '', amount: '', taxMode: 'ht' as PlannedExpense['taxMode'], vatRate: '20',
  category: 'Logiciels & abonnements', subcategory: 'Abonnement', kind: 'monthly' as PlannedExpense['kind'],
  startDate: new Date().toISOString().slice(0, 10), endDate: '', notes: '', active: true,
};

const expenseKindLabel = (kind: PlannedExpense['kind']) => ({
  monthly: 'Mensuelle', quarterly: 'Trimestrielle', yearly: 'Annuelle', one_off: 'Unique',
}[kind]);

const Forecast = ({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) => {
  const [horizon, setHorizon] = useState<6 | 12 | 24>(12);
  const { data, error, loading } = useRemote<ForecastResponse>(`/api/forecast?months=${horizon}`, refreshKey);
  const [form, setForm] = useState(expenseDefaults);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [costFilter, setCostFilter] = useState<'all' | 'included' | 'discussing'>('all');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [showCalendarDiscussions, setShowCalendarDiscussions] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setFormError('');
    try {
      await api(editingId ? `/api/planned-expenses/${editingId}` : '/api/planned-expenses', {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify({
          label: form.label, vendor: form.vendor,
          enteredAmountCents: Math.round(Number(form.amount.replace(',', '.')) * 100),
          taxMode: form.taxMode, vatRateBasisPoints: form.taxMode === 'no_vat' ? 0 : Math.round(Number(form.vatRate.replace(',', '.')) * 100),
          category: form.category, subcategory: form.subcategory, kind: form.kind, startDate: form.startDate,
          endDate: form.kind !== 'one_off' && form.endDate ? form.endDate : null,
          notes: form.notes || null, active: form.active,
        }),
      });
      setForm(expenseDefaults); setEditingId(null); setShowEditor(false); onChanged();
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : 'Erreur'); }
    finally { setSaving(false); }
  };
  const edit = (expense: PlannedExpense) => {
    setEditingId(expense.id);
    setForm({
      label: expense.label, vendor: expense.vendor, amount: String(expense.enteredAmountCents / 100),
      taxMode: expense.taxMode, vatRate: String(expense.vatRateBasisPoints / 100), category: expense.category,
      subcategory: expense.subcategory, kind: expense.kind, startDate: expense.startDate, endDate: expense.endDate || '',
      notes: expense.notes || '', active: expense.active,
    });
    setShowEditor(true);
  };
  const openNew = () => { setEditingId(null); setForm(expenseDefaults); setFormError(''); setShowEditor(true); };
  const cancelEdit = () => { setEditingId(null); setForm(expenseDefaults); setFormError(''); setShowEditor(false); };
  const setDecision = async (expense: PlannedExpense, active: boolean) => {
    await api(`/api/planned-expenses/${expense.id}`, { method: 'PUT', body: JSON.stringify({
      label: expense.label, vendor: expense.vendor, enteredAmountCents: expense.enteredAmountCents,
      taxMode: expense.taxMode, vatRateBasisPoints: expense.vatRateBasisPoints, category: expense.category,
      subcategory: expense.subcategory, kind: expense.kind, startDate: expense.startDate, endDate: expense.endDate,
      notes: expense.notes, active,
    }) });
    onChanged();
  };
  const remove = async (id: number) => { if (!window.confirm('Supprimer cette dépense prévue ?')) return; await api(`/api/planned-expenses/${id}`, { method: 'DELETE' }); onChanged(); };
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error} />;
  const enteredCents = Math.round(Number(form.amount.replace(',', '.') || 0) * 100);
  const vatBasisPoints = Math.round(Number(form.vatRate.replace(',', '.') || 0) * 100);
  const previewHtCents = form.taxMode === 'ttc' ? Math.round(enteredCents / (1 + vatBasisPoints / 10_000)) : enteredCents;
  const includedExpenses = data.plannedExpenses.filter((expense) => expense.active);
  const discussingExpenses = data.plannedExpenses.filter((expense) => !expense.active);
  const visibleExpenses = data.plannedExpenses.filter((expense) => costFilter === 'all'
    || (costFilter === 'included' ? expense.active : !expense.active));
  const currentMonth = data.months[0];
  const horizonMonth = data.months[data.months.length - 1];
  const selectedMonthKey = selectedMonth && data.months.some((month) => month.key === selectedMonth)
    ? selectedMonth : data.months[0]?.key;
  const selectedMonthData = data.months.find((month) => month.key === selectedMonthKey)!;
  const calendarCostsFor = (monthKey: string) => data.plannedExpenses.filter((expense) =>
    (expense.active || showCalendarDiscussions) && plannedExpenseOccursInMonth(expense, monthKey, true));
  const selectedMonthCosts = calendarCostsFor(selectedMonthKey);
  const renderCostTable = (expenses: PlannedExpense[]) => expenses.length ? <div className="table-wrap"><table className="future-costs-table simplified"><thead><tr><th>Coût / fournisseur</th><th>Catégorie</th><th>Récurrence</th><th>Échéance</th><th className="amount">Montant HT</th><th>Statut</th><th>Actions</th></tr></thead><tbody>{expenses.map((expense) => <tr key={expense.id}><td><strong>{expense.label}</strong><small className="block">{expense.vendor}</small>{expense.notes && <small className="block">{expense.notes}</small>}</td><td><span className="tag">{expense.category}</span><small className="block">{expense.subcategory}</small></td><td>{expenseKindLabel(expense.kind)}</td><td>{expense.kind === 'one_off' ? formatDate(expense.startDate) : `Dès le ${formatDate(expense.startDate)}`}{expense.endDate && <small className="block">Fin le {formatDate(expense.endDate)}</small>}</td><td className="amount expense"><strong>{formatEUR(expense.amountCents)}</strong><small className="block">hors taxes</small></td><td><button className={`status-button ${expense.active ? 'included' : 'discussing'}`} onClick={() => void setDecision(expense, !expense.active)}>{expense.active ? 'Inclus' : 'À discuter'}</button></td><td><div className="row-actions"><button className="icon-button" onClick={() => edit(expense)} aria-label="Modifier"><Pencil size={17} /></button><button className="icon-button danger" onClick={() => void remove(expense.id)} aria-label="Supprimer"><Trash2 size={17} /></button></div></td></tr>)}</tbody></table></div> : <Empty>Aucun coût ne correspond à ce filtre.</Empty>;
  return <div className="page-stack">
    <section className="card forecast-command-bar"><div><span className="eyebrow">Projection budgétaire</span><h2>Planifier les prochains coûts</h2><p>Choisis l’horizon, explore les mois et gère toutes les dépenses depuis une liste unique.</p></div><div className="forecast-command-actions"><div className="period-segmented">{([6, 12, 24] as const).map((months) => <button key={months} className={horizon === months ? 'active' : ''} onClick={() => setHorizon(months)}>{months} mois</button>)}</div><button className="button primary" onClick={openNew}><Plus size={17} /> Ajouter un coût</button></div></section>
    <div className="forecast-summary-grid">
      <article className="card forecast-summary-item"><span>Trésorerie actuelle</span><strong>{formatEUR(data.assumptions.cashBalanceCents)}</strong><small>Solde Qonto</small></article>
      <article className="card forecast-summary-item"><span>Revenus mensuels HT</span><strong className="income">{formatEUR(data.assumptions.stripeMrrCents)}</strong><small>MRR Stripe utilisé</small></article>
      <article className="card forecast-summary-item"><span>Coûts prévus ce mois</span><strong className="expense">{formatEUR(currentMonth?.totalExpensesCents || 0)}</strong><small>Récurrents et futurs inclus</small></article>
      <article className="card forecast-summary-item"><span>Trésorerie à {horizon} mois</span><strong>{formatEUR(horizonMonth?.projectedBalanceCents || 0)}</strong><small>Projection après dépenses</small></article>
    </div>
    <section className="card budget-calendar"><div className="section-title"><div><h2>Agenda budgétaire sur {horizon} mois</h2><p>Clique sur un mois pour explorer ses échéances, puis sur une dépense pour la modifier.</p></div><button className={`button ${showCalendarDiscussions ? 'discussion' : 'secondary'}`} onClick={() => setShowCalendarDiscussions((value) => !value)}>{showCalendarDiscussions ? 'Masquer' : 'Afficher'} les coûts à discuter</button></div>
      <div className="calendar-legend"><span><i className="legend-dot income-dot" /> Revenus HT</span><span><i className="legend-dot expense-dot" /> Dépenses HT</span><span><i className="legend-dot discussion-dot" /> À discuter · hors total</span></div>
      <div className="budget-month-grid">{data.months.map((month) => {
        const costs = calendarCostsFor(month.key);
        const netCents = month.stripeMrrCents - month.totalExpensesCents;
        return <article key={month.key} className={`budget-month ${selectedMonthKey === month.key ? 'selected' : ''} ${netCents < 0 ? 'negative' : 'positive'}`} role="button" tabIndex={0} onClick={() => setSelectedMonth(month.key)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedMonth(month.key); }}>
          <div className="budget-month-head"><strong>{month.label}</strong><span className={netCents >= 0 ? 'income' : 'expense'}>{netCents >= 0 ? '+' : '−'}{formatEUR(Math.abs(netCents))}</span></div>
          <div className="budget-month-bars"><div className="income-bar" style={{ width: `${Math.min(100, month.stripeMrrCents ? 35 + month.stripeMrrCents / Math.max(month.stripeMrrCents, month.totalExpensesCents) * 65 : 0)}%` }} /><div className="expense-bar" style={{ width: `${Math.min(100, month.totalExpensesCents ? 35 + month.totalExpensesCents / Math.max(month.stripeMrrCents, month.totalExpensesCents) * 65 : 0)}%` }} /></div>
          <div className="budget-month-totals"><span>Revenus <strong>{formatEUR(month.stripeMrrCents)}</strong></span><span>Dépenses <strong>{formatEUR(month.totalExpensesCents)}</strong></span></div>
          <div className="calendar-cost-chips">{costs.slice(0, 3).map((expense) => <button type="button" key={expense.id} className={`calendar-cost ${expense.active ? expense.kind : 'discussing'}`} onClick={(event) => { event.stopPropagation(); edit(expense); }}><span>{expense.label}</span><strong>{formatEUR(expense.amountCents)}</strong></button>)}{costs.length > 3 && <span className="more-costs">+{costs.length - 3} autre(s)</span>}{!costs.length && <span className="no-costs">Aucune échéance manuelle</span>}</div>
          <div className="budget-month-balance"><span>Trésorerie projetée</span><strong>{formatEUR(month.projectedBalanceCents)}</strong></div>
        </article>;
      })}</div>
      <div className="calendar-month-detail"><div className="calendar-detail-head"><div><span>Mois sélectionné</span><h3>{selectedMonthData.label}</h3></div><div><span>Résultat prévisionnel</span><strong className={selectedMonthData.stripeMrrCents - selectedMonthData.totalExpensesCents >= 0 ? 'income' : 'expense'}>{formatEUR(selectedMonthData.stripeMrrCents - selectedMonthData.totalExpensesCents)}</strong></div></div>
        <div className="calendar-detail-list">
          {selectedMonthData.recurringQontoCents > 0 && <div className="calendar-detail-row automatic"><div><strong>Fournisseurs récurrents Qonto</strong><span>Détection automatique · inclus dans la projection</span></div><strong>{formatEUR(selectedMonthData.recurringQontoCents)}</strong></div>}
          {selectedMonthCosts.map((expense) => <button type="button" className={`calendar-detail-row ${expense.active ? '' : 'discussing'}`} key={expense.id} onClick={() => edit(expense)}><div><strong>{expense.label}</strong><span>{expense.vendor} · {expenseKindLabel(expense.kind)}{expense.active ? '' : ' · à discuter'}</span></div><strong>{formatEUR(expense.amountCents)} HT</strong><Pencil size={16} /></button>)}
          {!selectedMonthCosts.length && selectedMonthData.recurringQontoCents === 0 && <Empty>Aucune dépense prévue pour ce mois.</Empty>}
        </div>
      </div>
    </section>
    <section className="card"><div className="section-title forecast-costs-header"><div><h2>Coûts futurs</h2><p>{includedExpenses.length} inclus · {discussingExpenses.length} à discuter · tous les montants sont affichés en HT</p></div><div className="cost-filter-tabs">{([['all', 'Tous'], ['included', 'Inclus'], ['discussing', 'À discuter']] as const).map(([value, label]) => <button key={value} className={costFilter === value ? 'active' : ''} onClick={() => setCostFilter(value)}>{label}</button>)}</div></div>{renderCostTable(visibleExpenses)}</section>
    {showEditor && <div className="forecast-modal-backdrop" role="presentation"><section className="card future-cost-editor forecast-modal" role="dialog" aria-modal="true" aria-label={editingId ? 'Modifier le coût futur' : 'Ajouter un coût futur'}><div className="section-title"><div><h2>{editingId ? 'Modifier le coût futur' : 'Ajouter un coût futur'}</h2><p>Le montant retenu dans toutes les projections est automatiquement converti en hors taxes.</p></div><button className="icon-button" onClick={cancelEdit} aria-label="Fermer"><XCircle size={22} /></button></div>
      <form className="expense-form" onSubmit={submit}>
        <div className="form-grid-3">
          <label>Nom du coût<input required minLength={2} value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="Ex. Abonnement logiciel CRM" /></label>
          <label>Fournisseur<input required minLength={2} value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} placeholder="Ex. HubSpot" /></label>
          <label>Type / récurrence<select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as PlannedExpense['kind'] })}><option value="monthly">Mensuelle</option><option value="quarterly">Trimestrielle</option><option value="yearly">Annuelle</option><option value="one_off">Unique</option></select></label>
          <label>Montant saisi (€)<input required inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="120,00" /></label>
          <label>Nature du montant<select value={form.taxMode} onChange={(event) => setForm({ ...form, taxMode: event.target.value as PlannedExpense['taxMode'] })}><option value="ht">Montant HT</option><option value="ttc">Montant TTC</option><option value="no_vat">Pas de TVA</option><option value="reverse_charge">TVA autoliquidée</option></select></label>
          <label>Taux de TVA (%)<input required min="0" max="100" step="0.1" type="number" disabled={form.taxMode === 'ht' || form.taxMode === 'no_vat'} value={form.vatRate} onChange={(event) => setForm({ ...form, vatRate: event.target.value })} /></label>
          <label>Catégorie<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>Logiciels & abonnements</option><option>Marketing & acquisition</option><option>Infrastructure & hébergement</option><option>Prestataires & honoraires</option><option>Personnel</option><option>Locaux & fonctionnement</option><option>Banque & finance</option><option>Déplacements & repas</option><option>Taxes & administrations</option><option>Assurances</option><option>Autres dépenses</option></select></label>
          <label>Sous-catégorie<input required value={form.subcategory} onChange={(event) => setForm({ ...form, subcategory: event.target.value })} /></label>
          <label>{form.kind === 'one_off' ? 'Date prévue' : 'Première échéance'}<input required type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>
          {form.kind !== 'one_off' && <label>Dernière échéance (facultatif)<input type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label>}
          <label>Décision<select value={form.active ? 'included' : 'discussing'} onChange={(event) => setForm({ ...form, active: event.target.value === 'included' })}><option value="included">Inclure dans le prévisionnel</option><option value="discussing">Mettre de côté · à discuter</option></select></label>
        </div>
        <label>Notes<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Contexte, hypothèse ou détail fiscal…" /></label>
        <div className="tax-preview"><span>Montant retenu dans le prévisionnel</span><strong>{formatEUR(previewHtCents)} HT</strong><small>{form.taxMode === 'ttc' ? `Conversion du TTC avec ${form.vatRate || '0'} % de TVA` : form.taxMode === 'reverse_charge' ? 'TVA autoliquidée : coût conservé hors taxes' : form.taxMode === 'no_vat' ? 'Aucune TVA applicable : montant conservé tel quel' : 'Montant déjà saisi hors taxes'}</small></div>
        {formError && <p className="form-error">{formError}</p>}
        <div className="form-actions"><button className="button primary" disabled={saving}>{saving ? <Loader2 className="spin" size={17} /> : editingId ? <Pencil size={17} /> : <Plus size={17} />}{editingId ? ' Enregistrer les modifications' : ' Ajouter au prévisionnel'}</button><button type="button" className="button secondary" onClick={cancelEdit}><XCircle size={17} /> Annuler</button></div>
      </form>
    </section></div>}
  </div>;
};

const FinancialKpis = () => <div className="card empty-tab"><Empty>Les KPI financiers sont désormais affichés dans la Vue d’ensemble.</Empty></div>;

const LegacyFinancialKpis = ({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) => {
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
  const ConnectionCard = ({ source, icon: Icon, configured, lastRun }: { source: 'qonto' | 'stripe'; icon: typeof Landmark; configured: boolean; lastRun: ConnectionsResponse['qonto']['lastRun'] }) => <section className="card connection-card"><div className="connection-logo"><Icon size={28} /></div><div className="connection-main"><div className="section-title"><div><h2>{source === 'qonto' ? 'Qonto' : 'Stripe'}</h2><p>{source === 'qonto' ? 'Comptes, soldes, transactions, catégories et fournisseurs.' : 'MRR HT, clients, offres et factures payées en lecture seule.'}</p></div><span className={`status ${configured ? 'connected' : 'disconnected'}`}>{configured ? <CheckCircle2 size={15} /> : <XCircle size={15} />}{configured ? 'Configuré' : 'Non configuré'}</span></div><div className="connection-meta"><span>Dernière synchronisation : <strong>{formatDate(lastRun?.completed_at || null)}</strong></span>{lastRun && <span>{lastRun.imported_count} élément(s) · {lastRun.message}</span>}</div><button className="button primary" disabled={!configured || syncing !== null} onClick={() => void sync(source)}>{syncing === source ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />} Synchroniser maintenant</button></div></section>;
  return <div className="page-stack"><div className="notice security"><Database size={18} /><span>Les clés ne sont jamais envoyées au navigateur. Le serveur écoute seulement sur <code>127.0.0.1</code> par défaut.</span></div>{message && <div className="notice">{message}</div>}<div className="connections-grid"><ConnectionCard source="qonto" icon={Landmark} configured={data.qonto.configured} lastRun={data.qonto.lastRun} /><ConnectionCard source="stripe" icon={CircleDollarSign} configured={data.stripe.configured} lastRun={data.stripe.lastRun} /></div><section className="card setup"><div className="section-title"><div><h2>Configuration locale</h2><p>Copie <code>.env.example</code> vers <code>.env</code>, sans jamais commiter ce dernier.</p></div></div><ol><li><strong>Qonto recommandé :</strong> renseigner <code>QONTO_ACCESS_TOKEN</code> avec OAuth et le scope <code>organization.read</code>.</li><li><strong>Qonto alternatif :</strong> renseigner <code>QONTO_API_LOGIN</code> et <code>QONTO_API_SECRET</code> pour une seule entreprise.</li><li><strong>Stripe :</strong> renseigner une Restricted API Key <code>rk_live_…</code> dans <code>STRIPE_RESTRICTED_KEY</code>. <strong>Subscriptions: Read</strong> est indispensable ; <strong>Customers, Products et Invoices: Read</strong> enrichissent les noms, offres et chiffres d’affaires.</li><li>Redémarrer l’application puis lancer chaque synchronisation.</li></ol></section></div>;
};

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);
  const active = tabs.find((item) => item.id === tab)!;
  return <div className="app-shell"><aside><div className="brand"><div className="brand-mark"><BarChart3 /></div><div><strong>Pilotage</strong><span>Bien-être Connect</span></div></div><nav>{tabs.map((item) => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon size={19} />{item.label}</button>)}</nav><div className="sidebar-foot"><Landmark size={16} /><span>Qonto + Stripe<br />Lecture seule</span></div></aside><main><header><div><span className="eyebrow">Pilotage financier</span><h1>{active.label}</h1></div><button className="button secondary" onClick={refresh}><RefreshCw size={17} /> Actualiser</button></header><div className="content">{tab === 'dashboard' && <Dashboard refreshKey={refreshKey} onChanged={refresh} />}{tab === 'expenses' && <Expenses refreshKey={refreshKey} />}{tab === 'vendors' && <Vendors refreshKey={refreshKey} />}{tab === 'clients' && <Clients refreshKey={refreshKey} />}{tab === 'forecast' && <Forecast refreshKey={refreshKey} onChanged={refresh} />}{tab === 'kpis' && <FinancialKpis />}{tab === 'connections' && <Connections refreshKey={refreshKey} onChanged={refresh} />}</div></main></div>;
}
