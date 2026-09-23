const { randomUUID } = require("node:crypto");
const { setTimeout: sleep } = require("node:timers/promises");

const CRM_URL = "https://crm.example.com/v1/leads";
const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 5000;

/**
 * Crée un lead dans le CRM.
 * Réessaie sur 429, 5xx, timeout ou réseau coupé. Abandonne tout de suite sur les autres 4xx.
 */
async function createLead(lead) {
  // Même clé pour toutes les tentatives : le CRM reconnaît un réessai et ne crée pas de doublon.
  const idempotencyKey = randomUUID();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await sendRequest(lead, idempotencyKey);

    if (response?.ok) return response.json();

    // null = timeout ou réseau coupé → on peut réessayer.
    const canRetry = response === null || response.status === 429 || response.status >= 500;
    const reason = response === null ? "timeout ou réseau" : `HTTP ${response.status}`;

    // Jamais le token dans les messages : seulement le statut et le nombre de tentatives.
    if (!canRetry || attempt === MAX_ATTEMPTS) {
      throw new Error(`Lead non créé (${reason}) après ${attempt} tentative(s)`);
    }

    const delayMs = getDelay(response, attempt);
    console.warn(`[crm] Tentative ${attempt} échouée (${reason}), nouvel essai dans ${delayMs} ms`);
    await sleep(delayMs);
  }
}

/** Un seul appel HTTP. Renvoie la réponse, ou null si timeout (5 s) ou réseau coupé. */
async function sendRequest(lead, idempotencyKey) {
  const token = process.env.CRM_API_TOKEN;
  if (!token) throw new Error("CRM_API_TOKEN manquant");

  try {
    return await fetch(CRM_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(lead),
      signal: AbortSignal.timeout(TIMEOUT_MS), // annule l'appel après 5 s
    });
  } catch {
    return null;
  }
}

/** Combien de temps attendre avant la prochaine tentative. */
function getDelay(response, attempt) {
  // 429 : le CRM dit lui-même combien de secondes attendre.
  const retryAfter = Number(response?.headers.get("Retry-After"));
  if (response?.status === 429 && retryAfter > 0) return retryAfter * 1000;

  // Sinon, backoff exponentiel : 500 ms, puis 1 s, puis 2 s...
  return 500 * 2 ** (attempt - 1);
}

module.exports = { createLead };
