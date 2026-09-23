# Réponses – Test technique TanàImmo

**Échelle de gravité utilisée**

- **Critique** : faille de sécurité ou panne très probable dès le lancement.
- **Élevée** : bug visible par les utilisateurs, ou perte d'argent ou de données possible.
- **Moyenne** : comportement faux dans certains cas, ou coût de performance.
- **Faible** : qualité du code, avertissement, confort.

---

## Partie 1 – Revue de code

### Extrait A – Composant React `ListingList` (corrigé sur papier)

| # | Problème | Gravité | Correction proposée |
|---|---|---|---|
| A1 | `useEffect` sans tableau de dépendances : l'effet s'exécute après **chaque** rendu. `setListings` provoque un nouveau rendu, donc un nouvel appel API, à l'infini. Chaque visiteur envoie des requêtes en boucle : pendant un pic de trafic, c'est une attaque contre notre propre API. | Critique | Ajouter `[city]` : l'appel n'est refait que si la ville change. |
| A2 | Aucune gestion d'erreur. `fetch` ne rejette pas sur un 4xx/5xx et il n'y a pas de `.catch`. Sur une panne réseau, `loading` reste à `true` pour toujours. Sur un 500, `data` est un objet d'erreur et `listings.map` plante : écran blanc. | Élevée | Vérifier `response.ok`, ajouter un `.catch` avec un état `error` et un message pour l'utilisateur, remettre `loading` à `false` dans tous les cas. |
| A3 | Condition de course : si `city` change vite, l'ancienne réponse peut arriver après la nouvelle et afficher les annonces de la mauvaise ville. Il y a aussi des mises à jour d'état après le démontage du composant. | Moyenne | `AbortController` : annuler la requête précédente dans la fonction de nettoyage de l'effet. |
| A4 | `city` n'est pas encodé dans l'URL : une ville avec un espace, un accent ou un `&` casse la requête ou ajoute des paramètres (`city=a&page=999`). | Moyenne | `encodeURIComponent(city)` (ou `URLSearchParams`). |
| A5 | `l.price.toLocaleString()` plante si le prix est `null` (« prix sur demande ») : tout le composant tombe. Sans locale, le format dépend du navigateur. | Moyenne | Tester `price == null`, formater avec `Intl.NumberFormat("fr-FR")`. |
| A6 | Pas de `key` sur les `<li>` : avertissement React et mises à jour de la liste moins fiables. | Faible | `key={listing.id}`. |

Avec la correction de l'extrait B, l'API renvoie maintenant `{ data, pagination }` : le composant lit donc `body.data`.

```jsx
import { useEffect, useState } from "react";

const priceFormatter = new Intl.NumberFormat("fr-FR");

export function ListingList({ city }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!city) return;

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/listings?city=${encodeURIComponent(city)}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((body) => setListings(body.data))
      .catch((err) => {
        if (err.name !== "AbortError") setError("Impossible de charger les annonces.");
      })
      .finally(() => {
        // Si la requête a été annulée, une nouvelle requête est déjà en cours : on ne touche à rien.
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort(); // Nettoyage : ville changée ou composant démonté.
  }, [city]);

  if (loading) return <p>Chargement…</p>;
  if (error) return <p role="alert">{error}</p>;
  if (listings.length === 0) return <p>Aucune annonce pour cette ville.</p>;

  return (
    <ul>
      {listings.map((listing) => (
        <li key={listing.id}>
          {listing.title} –{" "}
          {listing.price == null ? "Prix sur demande" : `${priceFormatter.format(listing.price)} Ar`}
        </li>
      ))}
    </ul>
  );
}
```

### Extrait B – Route `GET /api/listings` (corrigé dans `src/listings/`)

| # | Problème | Gravité | Correction proposée |
|---|---|---|---|
| B1 | Injection SQL : `city` est collé directement dans le texte SQL. `?city=' OR '1'='1` renvoie toute la table ; avec `UNION SELECT`, un attaquant peut lire d'autres tables (utilisateurs, paiements). | Critique | Requête paramétrée (`WHERE l.city = $1`) + validation de `city` (obligatoire, texte, 100 caractères maximum). |
| B2 | Problème N+1 : pour N annonces, 1 + 2N requêtes, exécutées l'une après l'autre. Avec 300 annonces à Antananarivo : 601 requêtes pour un seul appel. Sous charge, le pool de connexions sature et toute l'API ralentit. | Critique | `LEFT JOIN agencies` dans la requête principale, puis **une** requête pour les photos (`WHERE listing_id = ANY($1)`), regroupées en JavaScript : 2 requêtes au total. |
| B3 | Pas de pagination : `page` est lu mais jamais utilisé. La route renvoie toutes les annonces de la ville : réponse énorme, lente, coûteuse en mémoire, et de plus en plus lourde avec le temps. | Élevée | `LIMIT` / `OFFSET` avec `page` et `pageSize` validés (taille 50 maximum, page 100 maximum). Réponse `{ data, pagination: { page, pageSize, hasNextPage } }`. Tri stable avec `id` en second critère. |
| B4 | Aucune gestion d'erreur. Avec Express 4, si une requête SQL échoue, la promesse rejetée n'est pas gérée : le client attend sans réponse, et depuis Node 15 une promesse rejetée non gérée arrête le processus. Une seule erreur SQL peut faire tomber l'API. | Élevée | `try/catch` + `next(error)` vers un gestionnaire d'erreurs central : 400 pour un paramètre invalide, 500 avec un message neutre sinon. |
| B5 | `SELECT *` : on renvoie toutes les colonnes, y compris des colonnes internes ou personnelles (téléphone du propriétaire, commission de l'agence…) et celles qui seront ajoutées plus tard. Réponse plus lourde. | Moyenne | Lister les colonnes utiles et construire l'objet renvoyé (`toListing`). |
| B6 | Bug de format : `row.agency` reçoit une **liste** de lignes (le résultat de la requête), pas une agence ; le front devrait écrire `agency[0].name`. `row.photos` est une liste d'objets `{ url }` et pas d'URL. | Moyenne | Construire explicitement `agency: { id, name, phone }` (ou `null`) et `photos: [url, …]`. |

### Extrait C – Webhook `POST /webhooks/payment` (corrigé dans `src/payments/`)

| # | Problème | Gravité | Correction proposée |
|---|---|---|---|
| C1 | Aucune vérification de l'origine de l'appel. N'importe qui peut envoyer `{ "type": "payment.succeeded", "booking_id": 123 }` et obtenir une réservation payée gratuitement. | Critique | Vérifier la signature HMAC-SHA256 du corps **brut** avec le secret partagé (`express.raw()`, comparaison avec `timingSafeEqual`). Sinon, répondre 401. |
| C2 | Traitement trop long avant de répondre : UPDATE + email + CRM (2 à 8 s). On dépasse souvent 10 s : le prestataire considère l'appel en échec et le renvoie, alors que le travail a déjà été fait. | Élevée | Répondre 200 dès que le paiement est enregistré en base (quelques millisecondes). L'email et le CRM deviennent des tâches dans la table `outbox_jobs`, exécutées ensuite par un worker. |
| C3 | Pas d'idempotence : chaque renvoi refait tout. Jusqu'à 6 emails « Paiement confirmé » et 6 notifications CRM pour un seul paiement. | Élevée | Enregistrer `event.id` dans `payment_events` (clé primaire). Si l'événement existe déjà, répondre 200 sans rien refaire. |
| C4 | Pas de gestion d'erreur : si l'email ou le CRM échoue, l'exception n'est pas gérée (pas de réponse, arrêt possible du processus avec Express 4). Le prestataire renvoie l'événement, et l'UPDATE et l'email sont refaits. | Élevée | `try/catch` : on répond 500 **seulement** si l'enregistrement en base a échoué (rien n'est enregistré, donc le renvoi est utile). Les échecs d'email ou de CRM sont gérés par le worker, avec réessais, sans toucher au paiement. |
| C5 | Opérations non atomiques : si le serveur s'arrête entre l'UPDATE et l'email, l'état est partiel (réservation payée sans email) et rien ne permet de reprendre. | Moyenne | Une seule transaction (ACID) : enregistrement de l'événement + mise à jour de la réservation + création des tâches. Tout ou rien. |
| C6 | Aucun contrôle métier : on ne vérifie pas que la réservation existe, qu'elle attend un paiement, ni que le montant est le bon. Un vieil événement peut repasser à « paid » une réservation annulée ou remboursée. | Moyenne | `UPDATE … WHERE id = $1 AND status = 'pending_payment' AND amount = $2 AND currency = $3`. Si aucune ligne n'est modifiée : log d'erreur pour une vérification manuelle. |

---