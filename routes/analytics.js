const express = require('express');
const router  = express.Router();
const db      = require('../src/db');

// Ensure the metrics table exists before any request hits
db.query(`
  CREATE TABLE IF NOT EXISTS card_metrics (
    product_id        TEXT PRIMARY KEY,
    computed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ath               NUMERIC,
    drawdown_pct      NUMERIC,
    drawdown_amt      NUMERIC,
    current_price     NUMERIC,
    floor_price       NUMERIC,
    floor_median      NUMERIC,
    floor_weeks       INTEGER,
    breakout_price    NUMERIC,
    in_band           BOOLEAN,
    qualifies_support BOOLEAN,
    is_deep_value     BOOLEAN,
    tier_label        TEXT,
    tier_band         NUMERIC,
    price_30d_ago     NUMERIC,
    momentum_30d      NUMERIC,
    sparkline         JSONB
  )
`).catch(console.error);

function tcgdexImageUrl(tcgdexId) {
  if (!tcgdexId) return null;
  const [setId, localId] = tcgdexId.split('-');
  if (!setId || !localId) return null;
  const series = setId.replace(/[\d.]+.*$/, '');
  return `https://assets.tcgdex.net/en/${series}/${setId}/${localId}/high.webp`;
}

// Normalize away accents so "Pokémon GO" === "Pokemon GO"
function norm(str) {
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const ERA_RULES = [
  {
    era: 'Scarlet & Violet',
    startsWith: ['sv'],
    contains: ['scarlet', 'violet', 'paldea', 'obsidian flames', 'paradox rift',
      'temporal forces', 'twilight masquerade', 'shrouded fable', 'stellar crown',
      'surging sparks', 'prismatic', 'journey together', '151', 'paldean'],
  },
  {
    era: 'Sword & Shield',
    startsWith: ['swsh'],
    contains: ['sword', 'shield', 'rebel clash', 'darkness ablaze', 'champion',
      'vivid voltage', 'shining fates', 'battle styles', 'chilling reign',
      'evolving skies', 'fusion strike', 'brilliant stars', 'astral radiance',
      'lost origin', 'silver tempest', 'crown zenith', 'pokemon go'],
  },
  {
    era: 'Sun & Moon',
    startsWith: ['sm'],
    contains: ['sun', 'moon', 'guardians rising', 'burning shadows', 'shining legends',
      'crimson invasion', 'ultra prism', 'forbidden light', 'celestial storm',
      'dragon majesty', 'lost thunder', 'team up', 'unbroken bonds', 'unified minds',
      'hidden fates', 'cosmic eclipse'],
  },
  {
    era: 'XY',
    startsWith: ['xy'],
    contains: ['flashfire', 'furious fists', 'phantom forces', 'primal clash',
      'roaring skies', 'ancient origins', 'breakthrough', 'breakpoint',
      'fates collide', 'steam siege', 'generations', 'double crisis', 'evolutions'],
  },
];

function classifyEra(setName) {
  const s = norm(setName);
  for (const rule of ERA_RULES) {
    if (rule.startsWith.some(p => s.startsWith(p))) return rule.era;
    if (rule.contains.some(k => s.includes(k))) return rule.era;
  }
  return 'Classic';
}

function float(v) { return v == null ? null : parseFloat(v); }

// GET /analytics/support-lines[?era=Scarlet & Violet]
router.get('/support-lines', async (req, res) => {
  const { era } = req.query;
  try {
    const { rows } = await db.query(`
      SELECT
        c.product_id, c.name, c.set_name, c.rarity, c.tcgdex_id, c.image_url,
        m.ath, m.drawdown_pct, m.drawdown_amt, m.current_price,
        m.tier_label, m.tier_band, m.floor_median, m.floor_weeks,
        m.breakout_price, m.in_band, m.is_deep_value, m.sparkline, m.computed_at
      FROM card_metrics m
      JOIN tracked_cards c USING (product_id)
      WHERE m.qualifies_support = true
      ORDER BY m.is_deep_value DESC, m.drawdown_pct DESC
    `);

    let results = rows.map(r => ({
      product_id:       r.product_id,
      name:             r.name,
      set_name:         r.set_name,
      rarity:           r.rarity,
      tcgdex_image_url: tcgdexImageUrl(r.tcgdex_id),
      image_url:        r.image_url,
      current_price:    float(r.current_price),
      ath:              float(r.ath),
      drawdown_pct:     float(r.drawdown_pct),
      drawdown_amt:     float(r.drawdown_amt),
      tier_label:       r.tier_label,
      tier_band:        float(r.tier_band),
      floor_median:     float(r.floor_median),
      floor_weeks:      r.floor_weeks,
      breakout_price:   float(r.breakout_price),
      in_band:          r.in_band,
      is_deep_value:    r.is_deep_value,
      sparkline:        r.sparkline,
      computed_at:      r.computed_at,
    }));

    if (era) results = results.filter(r => classifyEra(r.set_name) === era);

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /analytics/momentum[?era=Sword & Shield]
router.get('/momentum', async (req, res) => {
  const { era } = req.query;
  try {
    const { rows } = await db.query(`
      SELECT
        c.product_id, c.name, c.set_name, c.rarity, c.tcgdex_id, c.image_url,
        m.current_price, m.price_30d_ago, m.momentum_30d,
        m.sparkline, m.computed_at
      FROM card_metrics m
      JOIN tracked_cards c USING (product_id)
      WHERE m.momentum_30d IS NOT NULL AND ABS(m.momentum_30d) >= 3
      ORDER BY m.momentum_30d DESC
    `);

    let results = rows.map(r => ({
      product_id:       r.product_id,
      name:             r.name,
      set_name:         r.set_name,
      rarity:           r.rarity,
      tcgdex_image_url: tcgdexImageUrl(r.tcgdex_id),
      image_url:        r.image_url,
      current_price:    float(r.current_price),
      price_30d_ago:    float(r.price_30d_ago),
      momentum_30d:     float(r.momentum_30d),
      sparkline:        r.sparkline,
      computed_at:      r.computed_at,
    }));

    if (era) results = results.filter(r => classifyEra(r.set_name) === era);

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
