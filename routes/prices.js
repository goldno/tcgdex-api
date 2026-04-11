const express = require('express');
const router = express.Router();
const db = require('../src/db');

// GET /cards/:id/prices
router.get('/:id/prices', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT snapshot_date, sub_type_name, market_price, low_price, mid_price, high_price
       FROM price_snapshots
       WHERE product_id = $1
       ORDER BY snapshot_date DESC, sub_type_name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
