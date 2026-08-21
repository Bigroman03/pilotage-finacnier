export const EXPENSE_CATEGORIES = [
  'Logiciels & abonnements',
  'Marketing & acquisition',
  'Infrastructure & hébergement',
  'Prestataires & honoraires',
  'Personnel',
  'Locaux & fonctionnement',
  'Banque & finance',
  'Déplacements & repas',
  'Taxes & administrations',
  'Assurances',
  'Autres dépenses',
] as const;

type ClassificationRule = {
  category: string;
  subcategory: string;
  keywords: RegExp;
};

const RULES: ClassificationRule[] = [
  { category: 'Infrastructure & hébergement', subcategory: 'Hébergement & cloud', keywords: /ovh|cloudflare|aws|amazon web|google cloud|azure|vercel|netlify|heroku|railway|render\.com|digitalocean/i },
  { category: 'Infrastructure & hébergement', subcategory: 'Domaines & technique web', keywords: /gandi|namecheap|godaddy|ionos|o2switch|infomaniak|hostinger/i },
  { category: 'Logiciels & abonnements', subcategory: 'IA & productivité', keywords: /openai|chatgpt|anthropic|claude|notion|airtable|slack|microsoft|office 365|google workspace|dropbox|zoom|mistral/i },
  { category: 'Logiciels & abonnements', subcategory: 'Création & design', keywords: /canva|adobe|figma|envato|creative cloud|capcut|runway/i },
  { category: 'Logiciels & abonnements', subcategory: 'CRM & automatisation', keywords: /hubspot|brevo|sendinblue|mailchimp|zapier|make\.com|pipedrive|calendly|typeform/i },
  { category: 'Marketing & acquisition', subcategory: 'Publicité en ligne', keywords: /meta|facebook|instagram|google ads|linkedin|tiktok ads|bing ads/i },
  { category: 'Marketing & acquisition', subcategory: 'Communication & contenu', keywords: /imprimerie|printing|podcast|studio|communication|community manager|photographe|vid[eé]aste/i },
  { category: 'Prestataires & honoraires', subcategory: 'Conseil & freelances', keywords: /malt|fiverr|upwork|consult|freelance|prestation|sous-trait/i },
  { category: 'Prestataires & honoraires', subcategory: 'Comptabilité & juridique', keywords: /expert.?comptable|comptab|avocat|notaire|legalstart|legalplace|indy|dougs/i },
  { category: 'Personnel', subcategory: 'Salaires & charges', keywords: /urssaf|salaire|paie|payfit|personnel|cotisation/i },
  { category: 'Locaux & fonctionnement', subcategory: 'Loyer & charges', keywords: /loyer|bail|cowork|wework|électricit[eé]|edf|engie|eau|internet|orange|free pro|bouygues|sfr/i },
  { category: 'Locaux & fonctionnement', subcategory: 'Fournitures & matériel', keywords: /amazon|bureau vallée|office depot|ikea|materiel|fourniture/i },
  { category: 'Banque & finance', subcategory: 'Frais bancaires', keywords: /qonto|frais banc|commission|cotisation carte|agios/i },
  { category: 'Banque & finance', subcategory: 'Paiement & transaction', keywords: /stripe|paypal|sumup|mollie/i },
  { category: 'Déplacements & repas', subcategory: 'Transport', keywords: /sncf|ratp|uber|bolt|taxi|totalenergies|esso|shell|parking|autoroute|vinci/i },
  { category: 'Déplacements & repas', subcategory: 'Repas & hébergement', keywords: /restaurant|deliveroo|uber eats|hotel|airbnb|booking\.com/i },
  { category: 'Taxes & administrations', subcategory: 'Impôts & taxes', keywords: /dgfip|imp[oô]t|tva|tr[eé]sor public|taxe|cfe/i },
  { category: 'Assurances', subcategory: 'Assurances professionnelles', keywords: /assurance|axa|allianz|maif|macif|mma|generali/i },
];

const QONTO_CATEGORY_MAP: Record<string, [string, string]> = {
  software: ['Logiciels & abonnements', 'Logiciels'],
  subscription: ['Logiciels & abonnements', 'Abonnements'],
  marketing: ['Marketing & acquisition', 'Marketing'],
  advertising: ['Marketing & acquisition', 'Publicité'],
  fees: ['Banque & finance', 'Frais bancaires'],
  bank_fees: ['Banque & finance', 'Frais bancaires'],
  insurance: ['Assurances', 'Assurances professionnelles'],
  taxes: ['Taxes & administrations', 'Impôts & taxes'],
  rent: ['Locaux & fonctionnement', 'Loyer & charges'],
  office_supply: ['Locaux & fonctionnement', 'Fournitures & matériel'],
  transport: ['Déplacements & repas', 'Transport'],
  restaurant: ['Déplacements & repas', 'Repas & hébergement'],
  hotel: ['Déplacements & repas', 'Repas & hébergement'],
  salary: ['Personnel', 'Salaires & charges'],
};

export const normalizeVendor = (label: string) => {
  const cleaned = label
    .toLocaleUpperCase('fr-FR')
    .replace(/\b(CB|CARTE|PRLV|PRELEVEMENT|SEPA|VIR|VIREMENT|FACTURE|PAIEMENT)\b/g, ' ')
    .replace(/\b\d{2}[\/.-]\d{2}([\/.-]\d{2,4})?\b/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/[^A-ZÀ-ÖØ-Ý0-9&' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'FOURNISSEUR INCONNU';
};

export const classifyExpense = (input: {
  label: string;
  reference?: string | null;
  note?: string | null;
  qontoCategory?: string | null;
}) => {
  const searchable = [input.label, input.reference, input.note].filter(Boolean).join(' ');
  const keywordRule = RULES.find((rule) => rule.keywords.test(searchable));
  if (keywordRule) return { category: keywordRule.category, subcategory: keywordRule.subcategory };

  const qontoKey = input.qontoCategory?.toLocaleLowerCase('fr-FR').replace(/[ -]/g, '_') || '';
  const qontoMapping = QONTO_CATEGORY_MAP[qontoKey];
  if (qontoMapping) return { category: qontoMapping[0], subcategory: qontoMapping[1] };

  return { category: 'Autres dépenses', subcategory: input.qontoCategory || 'Non catégorisé' };
};

