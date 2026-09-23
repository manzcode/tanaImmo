const express = require("express");
const { getListingsByCity } = require("../services/listingService");

const router = express.Router();
const PAGE_SIZE = 20;

router.get("/api/listings", async (req, res, next) => {
  const { city } = req.query;
  const page = Number(req.query.page ?? 1);

  // On valide les paramètres avant de toucher la base.
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
    next(error); // Erreur SQL : Express répond 500, le serveur ne plante pas.
  }
});

module.exports = router;
