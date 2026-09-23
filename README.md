# TanàImmo – Test technique « Développeur Web React – Maintenance et fiabilité »

Ce dépôt contient :

- le code corrigé des extraits B et C (partie 1) ;
- le connecteur CRM `createLead` et ses tests (partie 2) ;
- les réponses écrites dans [`REPONSES.md`](REPONSES.md) (tableaux de la partie 1, partie 3).

## Lancer les tests

Prérequis : Node.js 20 ou plus (testé avec Node 22) et npm.

```bash
npm install
npm test
```

Résultat attendu :

```
PASS test/crmClient.test.js
  ✓ 429 puis succès : attend le Retry-After, réessaie, puis renvoie le lead
  ✓ 500 trois fois : abandonne après 3 tentatives, avec la même clé

Tests:       2 passed, 2 total
```

Les tests utilisent Jest. Ils ne font aucun vrai appel réseau : `fetch` est remplacé par un faux CRM
avec `jest.spyOn`. Ils durent environ 3 secondes, car ils attendent vraiment les délais de réessai
(1 s pour le `Retry-After`, puis 0,5 s + 1 s pour le backoff).

## Structure

```
src/
  routes/
    listings.js          Extrait B corrigé : GET /api/listings
    paymentWebhook.js    Extrait C corrigé : POST /webhooks/payment
  services/
    listingService.js    Requêtes SQL des annonces (2 requêtes au lieu de 1 + 2N)
    paymentService.js    Passage de la réservation à « payée », sans doublon
    crmClient.js         Partie 2 : createLead(lead)
test/
  crmClient.test.js      Tests de la partie 2
REPONSES.md              Partie 1 (tableaux) et partie 3 (incident, alertes)
.env.example             Variables d'environnement, sans vraies valeurs
```

Chaque route gère le HTTP (paramètres, réponse) et appelle un service qui gère le SQL.
Les routes remplacent celles des extraits dans l'application existante. Les modules `db`, `email`
et `crm` viennent de cette application (mêmes noms que dans les extraits) : ils ne sont pas dans ce dépôt.

## Variables d'environnement

| Variable | Utilisée par |
|---|---|
| `CRM_API_TOKEN` | `crmClient.js` : token Bearer du CRM |
| `PAYMENT_WEBHOOK_SECRET` | `paymentWebhook.js` : vérification de la signature |

Les tests n'ont besoin d'aucune variable : ils définissent un faux token eux-mêmes.

## Ce qui est fait

### Partie 1 – Revue de code

- Tableaux problème / gravité / correction pour les extraits A, B et C, dans `REPONSES.md`.
- **Extrait B** : requête SQL paramétrée (plus d'injection), validation de `city` et `page`,
  pagination (20 annonces par page), 2 requêtes SQL au lieu de 1 + 2N, gestion des erreurs.
  La réponse reste un tableau : le composant React de l'extrait A n'a pas besoin de changer.
- **Extrait C** : vérification de la signature HMAC-SHA256, `UPDATE` idempotent
  (`WHERE status = 'pending_payment'`), réponse 200 immédiate, email et CRM envoyés après la réponse.

### Partie 2 – Connecteur CRM

- `POST https://crm.example.com/v1/leads` avec le token Bearer lu dans `CRM_API_TOKEN`.
- Timeout de 5 s par tentative (`AbortSignal.timeout`).
- 3 tentatives maximum. Backoff exponentiel sur 5xx, timeout et réseau coupé (500 ms, puis 1 s).
  Sur 429, attente du délai donné par `Retry-After`.
- Pas de réessai sur les autres erreurs 4xx : réessayer ne changerait rien.
- Même `Idempotency-Key` pour toutes les tentatives d'un lead : pas de doublon dans le CRM.
- Le token n'apparaît jamais dans les logs ni dans les messages d'erreur.
- Tests « 429 puis succès » et « 500 trois fois puis abandon ».

### Partie 3 – Incident et alertes

Dans `REPONSES.md`.

## Hypothèses

- Le prestataire de paiement signe le corps brut en HMAC-SHA256 (hexadécimal) dans l'en-tête
  `X-Payment-Signature`, avec un secret partagé. S'il utilise une autre méthode, seule la vérification change.
- Le CRM accepte l'en-tête `Idempotency-Key`.
- Les noms de tables et de colonnes (`listings`, `agencies`, `photos`, `bookings.status`) viennent des extraits.
- Une annonce peut ne pas avoir d'agence (particulier) : d'où le `LEFT JOIN`.

## Limites et améliorations possibles

- **Webhook** : l'email et le CRM partent après la réponse. Si le serveur redémarre à ce moment-là,
  ils sont perdus. En production, j'utiliserais une file d'attente avec réessais.
- **createLead** peut bloquer jusqu'à environ 17 s dans le pire cas (3 × 5 s + les attentes).
  Il vaut mieux l'appeler en arrière-plan, pas pendant la requête de l'utilisateur.
- Pas de jitter dans le backoff, et le `Retry-After` n'est pas plafonné.
- Pas de tests automatiques pour la partie 1 (non demandés). Je les ajouterais avec une base PostgreSQL de test.
- Pagination par `OFFSET` : simple, mais lente sur les pages lointaines. Une pagination par curseur
  serait meilleure si le nombre d'annonces grandit.
- Vérification du montant payé : à ajouter si l'événement de paiement contient le montant.

## Temps passé

- Partie 1 (revue de code) : 1h00
- Partie 2 (connecteur CRM + tests) : 1h25
- Partie 3 (incident) : 0h40
- **Total : 3h5**

J'ai dépassé les 2h recommandées, principalement sur la Partie 2
(première mise en place de tests avec mocks et fake timers).