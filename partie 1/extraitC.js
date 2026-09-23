import crypto from "node:crypto";

export async function markBookingAsPaid(bookingId) {
  const result = await db.query(
    "UPDATE bookings SET status = 'paid' WHERE id = $1 AND status = 'pending_payment'",
    [bookingId],
  );
  return result.rowCount === 1;
}

// express.raw() garde le corps brut (Buffer) : la signature est calculée sur ces octets exacts.
// Si l'app utilise déjà app.use(express.json()), il faut déclarer cette route AVANT.
app.post("/webhooks/payment", express.raw({ type: "application/json" }), async (req, res, next) => {
  // 1. L'appel vient-il vraiment du prestataire ? On recalcule la signature et on compare.
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const expected = crypto.createHmac("sha256", process.env.PAYMENT_WEBHOOK_SECRET).update(body).digest();
  const received = Buffer.from(req.get("X-Payment-Signature") ?? "", "hex");

  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    return res.status(401).json({ error: "Signature invalide" });
  }

  // 2. Enregistrer le paiement : une seule requête SQL, très rapide.
  let event;
  let isFirstTime;
  try {
    event = JSON.parse(body.toString("utf8"));
    // Les autres événements : 200, pour que le prestataire ne les renvoie pas.
    if (event.type !== "payment.succeeded") return res.sendStatus(200);

    isFirstTime = await markBookingAsPaid(event.booking_id);
  } catch (error) {
    return next(error); // 500 : rien n'est enregistré, le prestataire réessaiera.
  }

  // 3. On répond tout de suite, sans attendre l'email ni le CRM (moins de 10 s garanti).
  res.sendStatus(200);

  // 4. Doublon : l'email et le CRM ont déjà été faits la première fois.
  if (!isFirstTime) {
    console.warn(`[webhook] Réservation ${event.booking_id} déjà payée ou introuvable : rien à faire`);
    return;
  }

  // 5. Après la réponse, en parallèle. Une erreur ici est seulement écrite dans les logs.
  sendEmail(event.customer_email, "Paiement confirmé", buildReceipt(event)).catch((error) =>
    console.error(`[webhook] Email non envoyé (réservation ${event.booking_id}) :`, error.message),
  );
  crm.notifyPayment(event).catch((error) =>
    console.error(`[webhook] CRM non notifié (réservation ${event.booking_id}) :`, error.message),
  );
});

export default router;