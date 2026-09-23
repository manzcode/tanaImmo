const PAGE_SIZE = 20;

export async function getListingsByCity(city, page, pageSize) {
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

app.get("/api/listings", async (req, res, next) => {
  const { city } = req.query;
  const page = Number(req.query.page ?? 1);

  if (typeof city !== "string" || city.trim() === "" || city.length > 100) {
    return res.status(400).json({ error: "Le paramètre city est obligatoire" });
  }
  if (!Number.isInteger(page) || page < 1 || page > 100) {
    return res.status(400).json({ error: "Le paramètre page doit être un entier entre 1 et 100" });
  }

  try {
    const listings = await getListingsByCity(city.trim(), page, PAGE_SIZE);
    res.json(listings);
  } catch (error) {
    next(error); 
  }
});