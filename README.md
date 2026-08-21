# Pilotage financier — Bien-être Connect

Application locale de pilotage financier connectée en lecture seule à Qonto et Stripe.

## Fonctionnalités du MVP

- import paginé de tous les comptes et transactions Qonto ;
- répertoire complet des dépenses avec la hiérarchie : catégorie → sous-catégorie → fournisseur → opération ;
- filtres par période et recherche libre ;
- catégorisation automatique à partir du fournisseur et des catégories Qonto ;
- détection des fournisseurs récurrents et estimation de leur coût mensuel ;
- onglet dédié aux fournisseurs et abonnements mensuels ;
- ajout de dépenses futures mensuelles ou uniques ;
- date de début, date de fin facultative, catégorie, fournisseur et notes ;
- prévision des dépenses et de la trésorerie sur douze mois ;
- récupération du MRR et du nombre d’abonnements Stripe actifs ;
- stockage local dans SQLite ;
- aucune clé Qonto ou Stripe dans le navigateur.

## Architecture

- React + Vite pour l’interface ;
- Express pour l’API locale ;
- SQLite avec `better-sqlite3` pour la persistance ;
- API Business Qonto v2 en `GET` uniquement ;
- SDK Stripe officiel v22.4.0, API `2026-07-29.dahlia`, appels de lecture uniquement.

Le serveur écoute sur `127.0.0.1` par défaut. Il n’est donc pas accessible depuis le réseau local sans modification volontaire.

## Installation locale

Prérequis : Node.js 22 ou plus récent.

```bash
npm install
cp .env.example .env
npm run dev
```

Ouvrir ensuite [http://127.0.0.1:5173](http://127.0.0.1:5173).

Les données SQLite sont enregistrées dans `./data/pilotage.db`.

## Connexion Qonto

### Recommandé : OAuth en lecture seule

Créer une application Qonto limitée au scope `organization.read`, puis renseigner `QONTO_ACCESS_TOKEN` dans `.env`.

Le logiciel appelle uniquement `GET /v2/organization` et `GET /v2/transactions`.

### Alternative interne mono-entreprise

Renseigner `QONTO_API_LOGIN` et `QONTO_API_SECRET` dans `.env`.

La clé API Qonto ne permet pas une granularité aussi fine qu’OAuth. L’application reste néanmoins techniquement limitée aux deux routes `GET` listées ci-dessus.

## Connexion Stripe

Créer une **Restricted API Key** Stripe avec uniquement les permissions de lecture nécessaires :

- Subscriptions — Read ;
- Prices — Read ;
- Products — Read ;
- Customers — Read.

Puis renseigner `STRIPE_RESTRICTED_KEY` dans `.env`.

Ne jamais utiliser une clé secrète complète si une clé restreinte suffit, et ne jamais commiter le fichier `.env`.

## Utilisation

1. Aller dans **Connexions** et synchroniser Qonto puis Stripe.
2. Vérifier la hiérarchie dans **Toutes les dépenses**.
3. Contrôler les détections dans **Fournisseurs mensuels**.
4. Ajouter les dépenses futures dans **Prévisionnel** en indiquant si elles sont uniques ou mensuelles et leur date de début.

## Prévisionnel

La projection actuelle applique la formule :

```text
solde projeté = solde Qonto + MRR Stripe − fournisseurs récurrents Qonto − dépenses futures ajoutées
```

Il s’agit d’une aide au pilotage, pas d’une prévision comptable certifiée. Les montants récurrents détectés automatiquement doivent être validés.

## Docker

```bash
cp .env.example .env
docker compose up --build
```

Ouvrir [http://127.0.0.1:3001](http://127.0.0.1:3001). Le volume `pilotage_data` conserve la base SQLite.

## Tests

```bash
npm test
npm run build
```

