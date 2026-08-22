import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Database,
  LayoutDashboard,
  Megaphone,
  Search,
  Sparkles,
  TrendingDown,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import type { DashboardResponse } from '../shared/types';
import App from './App';
import { api, formatEUR } from './api';
import './suite.css';

type SuitePage = 'suite' | 'finance' | 'seo' | 'practitioners' | 'data' | 'acquisition';

type ModuleDefinition = {
  id: SuitePage;
  label: string;
  shortLabel: string;
  description: string;
  status: 'active' | 'ready' | 'planned';
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
};

const modules: ModuleDefinition[] = [
  {
    id: 'finance',
    label: 'Finance',
    shortLabel: 'Prévisions financières',
    description: 'Trésorerie, Qonto, Stripe, dépenses, fournisseurs, clients, KPI et prévisionnel 12 mois.',
    status: 'active',
    icon: WalletCards,
  },
  {
    id: 'seo',
    label: 'Référencement naturel',
    shortLabel: 'SEO & visibilité',
    description: 'Suivi des positions, pages, mots-clés, trafic organique et opportunités de contenu.',
    status: 'ready',
    icon: Search,
  },
  {
    id: 'practitioners',
    label: 'CRM praticiens',
    shortLabel: 'Réseau praticiens',
    description: 'Pilotage de la base praticiens, enrichissement, statut RPPS, qualification et suivi CRM.',
    status: 'ready',
    icon: UsersRound,
  },
  {
    id: 'data',
    label: 'Data & scraping',
    shortLabel: 'Base de données',
    description: 'Contrôle des imports, enrichissements, sources, doublons et qualité des données praticiens.',
    status: 'planned',
    icon: Database,
  },
  {
    id: 'acquisition',
    label: 'Acquisition',
    shortLabel: 'Marketing & croissance',
    description: 'Suivi des canaux, contenus, campagnes et indicateurs d’acquisition de Bien-être Connect.',
    status: 'planned',
    icon: Megaphone,
  },
];

const pageFromHash = (): SuitePage => {
  const value = window.location.hash.replace('#', '') as SuitePage;
  return ['finance', 'seo', 'practitioners', 'data', 'acquisition'].includes(value) ? value : 'suite';
};

const goTo = (page: SuitePage) => {
  window.location.hash = page === 'suite' ? '' : page;
};

const statusLabel = (status: ModuleDefinition['status']) => {
  if (status === 'active') return 'Connecté';
  if (status === 'ready') return 'À connecter';
  return 'À venir';
};

const FinanceSnapshot = () => {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api<DashboardResponse>('/api/dashboard?period=month')
      .then((result) => {
        if (!active) return;
        setData(result);
        setError('');
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'Données financières indisponibles');
      });
    return () => { active = false; };
  }, []);

  if (!data) {
    return (
      <div className="bec-finance-empty">
        <div>
          <span className="bec-eyebrow">Finance</span>
          <strong>{error ? 'Connexion financière à vérifier' : 'Chargement des indicateurs…'}</strong>
          <p>{error || 'Lecture de la vue d’ensemble du module Pilotage financier.'}</p>
        </div>
        <button type="button" onClick={() => goTo('finance')}>Ouvrir Finance <ArrowUpRight size={15} /></button>
      </div>
    );
  }

  const kpis = [
    { label: 'Trésorerie', value: formatEUR(data.kpis.cashBalanceCents), icon: WalletCards },
    { label: 'CA HT', value: formatEUR(data.kpis.revenueHtCents), icon: CircleDollarSign },
    { label: 'Dépenses', value: formatEUR(data.kpis.periodExpensesCents), icon: TrendingDown },
    { label: 'MRR HT', value: formatEUR(data.kpis.stripeMrrCents), icon: Activity },
  ];

  return (
    <section className="bec-finance-panel">
      <div className="bec-section-heading">
        <div>
          <span className="bec-eyebrow">Finance · {data.period.label}</span>
          <h2>Vue financière rapide</h2>
          <p>Les données proviennent directement du module Pilotage financier.</p>
        </div>
        <button type="button" className="bec-secondary-button" onClick={() => goTo('finance')}>
          Ouvrir Finance <ArrowUpRight size={15} />
        </button>
      </div>
      <div className="bec-kpi-grid">
        {kpis.map(({ label, value, icon: Icon }) => (
          <div className="bec-kpi" key={label}>
            <div className="bec-kpi-top"><span>{label}</span><Icon size={17} /></div>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
};

const SuiteDashboard = () => {
  return (
    <div className="bec-dashboard">
      <section className="bec-hero">
        <div className="bec-hero-copy">
          <span className="bec-eyebrow"><Sparkles size={13} /> Bien-être Connect · Operating system</span>
          <h1>Ma Suite<br /><em>Bien-être Connect</em></h1>
          <p>Un point d’entrée unique pour piloter les finances, le référencement, les praticiens et les données de la plateforme.</p>
        </div>
        <div className="bec-hero-status">
          <span className="bec-live-dot" />
          <div><strong>Suite opérationnelle</strong><small>Finance déjà connecté</small></div>
        </div>
      </section>

      <FinanceSnapshot />

      <section className="bec-modules-section">
        <div className="bec-section-heading">
          <div>
            <span className="bec-eyebrow">Applications</span>
            <h2>Outils de pilotage</h2>
            <p>Chaque module reste spécialisé, mais partage la même porte d’entrée.</p>
          </div>
        </div>
        <div className="bec-module-grid">
          {modules.map(({ id, label, shortLabel, description, status, icon: Icon }, index) => (
            <button
              type="button"
              className={`bec-module-card bec-status-${status}`}
              key={id}
              onClick={() => goTo(id)}
              style={{ animationDelay: `${index * 55}ms` }}
            >
              <div className="bec-module-card-top">
                <span className="bec-module-icon"><Icon size={21} /></span>
                <span className="bec-module-status"><i />{statusLabel(status)}</span>
              </div>
              <div>
                <small>{shortLabel}</small>
                <h3>{label}</h3>
                <p>{description}</p>
              </div>
              <span className="bec-module-open">{status === 'active' ? 'Ouvrir le logiciel' : 'Préparer le module'} <ArrowUpRight size={14} /></span>
            </button>
          ))}
        </div>
      </section>

      <section className="bec-roadmap">
        <div className="bec-roadmap-icon"><BarChart3 size={20} /></div>
        <div>
          <span className="bec-eyebrow">Architecture</span>
          <h2>Une suite, plusieurs logiciels métiers</h2>
          <p>Le dashboard sert de couche commune. Le module Finance conserve son API Express, sa base SQLite et ses connexions Qonto/Stripe. Les prochains modules pourront être branchés sans casser ce socle.</p>
        </div>
      </section>
    </div>
  );
};

const ComingSoon = ({ module }: { module: ModuleDefinition }) => {
  const Icon = module.icon;
  return (
    <div className="bec-placeholder-page">
      <div className="bec-placeholder-card">
        <span className="bec-placeholder-icon"><Icon size={30} /></span>
        <span className="bec-eyebrow">{statusLabel(module.status)}</span>
        <h1>{module.label}</h1>
        <p>{module.description}</p>
        <div className="bec-placeholder-note"><CheckCircle2 size={17} /> Le module est déjà réservé dans l’architecture de Ma Suite Bien-être Connect.</div>
        <button type="button" className="bec-primary-button" onClick={() => goTo('suite')}>Retour au dashboard</button>
      </div>
    </div>
  );
};

const SuiteTopbar = ({ page }: { page: SuitePage }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = page === 'suite' ? 'Dashboard Suite' : modules.find((item) => item.id === page)?.label || 'Dashboard Suite';

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="bec-topbar">
      <div className="bec-suite-switcher" ref={ref}>
        <button type="button" className="bec-switcher-button" onClick={() => setOpen((value) => !value)}>
          <span className="bec-switcher-mark">B</span>
          <span><small>MA SUITE</small><strong>Bien-être Connect</strong></span>
          <ChevronDown size={15} className={open ? 'open' : ''} />
        </button>
        {open && (
          <div className="bec-switcher-menu">
            <button type="button" className={page === 'suite' ? 'active' : ''} onClick={() => { goTo('suite'); setOpen(false); }}>
              <LayoutDashboard size={17} /><span><strong>Dashboard Suite</strong><small>Vue globale</small></span>
            </button>
            <div className="bec-switcher-separator" />
            {modules.map((module) => {
              const Icon = module.icon;
              return (
                <button type="button" key={module.id} className={page === module.id ? 'active' : ''} onClick={() => { goTo(module.id); setOpen(false); }}>
                  <Icon size={17} /><span><strong>{module.label}</strong><small>{statusLabel(module.status)}</small></span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="bec-current-app"><span>Application</span><strong>{current}</strong></div>
    </div>
  );
};

export default function SuiteShell() {
  const [page, setPage] = useState<SuitePage>(() => pageFromHash());

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const module = useMemo(() => modules.find((item) => item.id === page), [page]);

  return (
    <div className="bec-suite-root">
      <SuiteTopbar page={page} />
      {page === 'suite' && <SuiteDashboard />}
      {page === 'finance' && <div className="suite-finance-host"><App /></div>}
      {page !== 'suite' && page !== 'finance' && module && <ComingSoon module={module} />}
    </div>
  );
}
