const { db } = require("../db");

async function markBookingAsPaid(bookingId) {
  const result = await db.query(
    "UPDATE bookings SET status = 'paid' WHERE id = $1 AND status = 'pending_payment'",
    [bookingId],
  );
  return result.rowCount === 1;
}

module.exports = { markBookingAsPaid };
