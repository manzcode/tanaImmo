
async function getListingsByCity(city, page, pageSize) {
  const listings = await db.query(
    `SELECT l.id, l.title, l.price, l.city,
            a.id AS agency_id, a.name AS agency_name
     FROM listings l
     LEFT JOIN agencies a ON a.id = l.agency_id
     WHERE l.city = $1
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT $2 OFFSET $3`,
    [city, pageSize, (page - 1) * pageSize],
  );

  if (listings.rows.length === 0) return [];

  // 2. Les photos de TOUTES ces annonces, en UNE requête.
  const listingIds = listings.rows.map((listing) => listing.id);
  const photos = await db.query(
    "SELECT listing_id, url FROM photos WHERE listing_id = ANY($1) ORDER BY id",
    [listingIds],
  );

  // 3. On construit l'objet renvoyé au front : une agence (ou null) et une liste d'URL.
  return listings.rows.map((listing) => ({
    id: listing.id,
    title: listing.title,
    price: listing.price,
    city: listing.city,
    agency: listing.agency_id !== null ? { id: listing.agency_id, name: listing.agency_name } : null,
    photos: photos.rows
      .filter((photo) => photo.listing_id === listing.id)
      .map((photo) => photo.url),
  }));
}

module.exports = { getListingsByCity };
