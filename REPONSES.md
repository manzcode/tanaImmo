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