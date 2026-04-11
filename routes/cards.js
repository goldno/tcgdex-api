const express = require('express');
const router = express.Router();
const db = require('../src/db');

// Builds a high-res TCGDex image URL from a tcgdex_id like "sv03-215"
// Format: https://assets.tcgdex.net/en/{series}/{setId}/{localId}/high.webp
function tcgdexImageUrl(tcgdexId) {
  if (!tcgdexId) return null;
  const [setId, localId] = tcgdexId.split('-');
  if (!setId || !localId) return null;
  const series = setId.replace(/[\d.]+.*$/, ''); // strip numbers, e.g. "sv03" → "sv"
  return `https://assets.tcgdex.net/en/${series}/${setId}/${localId}/high.webp`;
}

function addImageUrl(card) {
  return { ...card, tcgdex_image_url: tcgdexImageUrl(card.tcgdex_id) };
}

// GET /cards?search=charizard
router.get('/', async (req, res) => {
  const { search } = req.query;
  try {
    let query, params;
    if (search) {
      query = `
        SELECT c.*,
          p.market_price AS latest_price,
          p.sub_type_name AS latest_price_type
        FROM tracked_cards c
        LEFT JOIN LATERAL (
          SELECT market_price, sub_type_name
          FROM price_snapshots
          WHERE product_id = c.product_id
          ORDER BY snapshot_date DESC,
            CASE sub_type_name WHEN 'Holofoil' THEN 0 WHEN 'Normal' THEN 1 ELSE 2 END
          LIMIT 1
        ) p ON true
        WHERE c.name ILIKE $1
        ORDER BY c.set_name, c.collector_number
        LIMIT 50`;
      params = [`%${search}%`];
    } else {
      query = `
        SELECT c.*,
          p.market_price AS latest_price,
          p.sub_type_name AS latest_price_type
        FROM tracked_cards c
        LEFT JOIN LATERAL (
          SELECT market_price, sub_type_name
          FROM price_snapshots
          WHERE product_id = c.product_id
          ORDER BY snapshot_date DESC,
            CASE sub_type_name WHEN 'Holofoil' THEN 0 WHEN 'Normal' THEN 1 ELSE 2 END
          LIMIT 1
        ) p ON true
        ORDER BY c.set_name, c.collector_number`;
      params = [];
    }
    const { rows } = await db.query(query, params);
    res.json(rows.map(addImageUrl));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /cards/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM tracked_cards WHERE product_id = $1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Card not found' });
    res.json(addImageUrl(rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
