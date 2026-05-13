require('dotenv').config();
const db = require('./db');

const VARIANT_PRIORITY = ['Holofoil', 'Normal', 'Reverse Holofoil'];

function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function isoWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 3 - (d.getUTCDay() + 6) % 7);
  const week1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const weekNum = 1 + Math.round(
    ((d - week1) / 86400000 - 3 + (week1.getUTCDay() + 6) % 7) / 7
  );
  return `${d.getUTCFullYear()}-W${weekNum}`;
}

function pickVariant(athMap, productId) {
  const variants = athMap[productId];
  if (!variants) return null;
  let best = null, bestCnt = 0, bestPri = 999;
  for (const [variant, { cnt }] of Object.entries(variants)) {
    if (cnt < 7) continue;
    const pri = VARIANT_PRIORITY.indexOf(variant);
    if (cnt > bestCnt || (cnt === bestCnt && pri !== -1 && pri < bestPri)) {
      best = variant; bestCnt = cnt; bestPri = pri;
    }
  }
  return best;
}

function getTier(current) {
  if (current >= 200) return { label: '$200+',    minDrawdown: 0.15, minFloorWeeks: 6, band: 0.03 };
  if (current >= 50)  return { label: '$50–$200', minDrawdown: 0.15, minFloorWeeks: 6, band: 0.08 };
  if (current >= 10)  return { label: '$10–$50',  minDrawdown: 0.20, minFloorWeeks: 3, band: 0.08 };
  return null;
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split('T')[0];
}

async function computeMetrics() {
  await db.query(`
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
  `);

  console.log('[computeMetrics] Loading data...');

  const d30  = daysAgo(30);
  const d90  = daysAgo(90);
  const d180 = daysAgo(180);

  const [
    { rows: latestPrices },
    { rows: athRows },
    { rows: recentRows },
  ] = await Promise.all([
    // Latest price per card (Holofoil preferred for same-day ties)
    db.query(`
      SELECT DISTINCT ON (product_id)
        product_id, market_price AS latest_price
      FROM price_snapshots
      ORDER BY product_id, snapshot_date DESC,
        CASE sub_type_name WHEN 'Holofoil' THEN 0 WHEN 'Normal' THEN 1 ELSE 2 END
    `),
    // All-time ATH + total count per product/variant
    db.query(`
      SELECT product_id, sub_type_name,
             MAX(market_price) AS ath,
             COUNT(*)::int     AS cnt
      FROM price_snapshots
      GROUP BY product_id, sub_type_name
    `),
    // Last 180 days sorted ASC (used for floor, momentum, sparkline)
    db.query(`
      SELECT product_id, sub_type_name,
             snapshot_date::text AS date,
             market_price
      FROM price_snapshots
      WHERE snapshot_date >= $1
      ORDER BY product_id, sub_type_name, snapshot_date ASC
    `, [d180]),
  ]);

  // Build lookup maps
  const currentPriceMap = {};
  for (const r of latestPrices)
    currentPriceMap[r.product_id] = parseFloat(r.latest_price);

  const athMap = {};
  for (const r of athRows) {
    if (!athMap[r.product_id]) athMap[r.product_id] = {};
    athMap[r.product_id][r.sub_type_name] = { ath: parseFloat(r.ath), cnt: r.cnt };
  }

  const recentMap = {};
  for (const r of recentRows) {
    if (!recentMap[r.product_id]) recentMap[r.product_id] = {};
    if (!recentMap[r.product_id][r.sub_type_name])
      recentMap[r.product_id][r.sub_type_name] = [];
    recentMap[r.product_id][r.sub_type_name].push({
      date: r.date,
      price: parseFloat(r.market_price),
    });
  }

  const productIds = Object.keys(currentPriceMap);
  console.log(`[computeMetrics] Processing ${productIds.length} cards...`);

  let done = 0;
  for (const product_id of productIds) {
    const current = currentPriceMap[product_id];
    if (!current || current <= 0) continue;

    const variant      = pickVariant(athMap, product_id);
    const recentPrices = variant ? (recentMap[product_id]?.[variant] ?? []) : [];
    const ath          = variant ? athMap[product_id][variant].ath : null;

    const drawdown_pct = ath && ath > 0 ? (ath - current) / ath : null;
    const drawdown_amt = ath ? ath - current : null;
    const tier         = getTier(current);

    let floor_price = null, floor_median = null, floor_weeks = null;
    let breakout_price = null, in_band = null;
    let qualifies_support = false, is_deep_value = false;

    if (tier && recentPrices.length >= 7) {
      const { band } = tier;
      const floorVal   = Math.min(...recentPrices.map(r => r.price));
      const band_upper = floorVal * (1 + 2 * band);
      const inBand     = recentPrices.filter(r => r.price >= floorVal * 0.95 && r.price <= band_upper);
      const weeks      = new Set(inBand.map(r => isoWeekKey(r.date)));
      const medVal     = inBand.length > 0 ? median(inBand.map(r => r.price)) : floorVal;

      floor_price    = floorVal;
      floor_median   = medVal;
      floor_weeks    = weeks.size;
      breakout_price = medVal * 1.15;
      in_band        = current >= floorVal * 0.92 && current <= band_upper;

      qualifies_support = (drawdown_pct ?? 0) >= tier.minDrawdown
        && floor_weeks >= tier.minFloorWeeks
        && in_band;

      is_deep_value = current >= 50
        && (drawdown_pct ?? 0) >= 0.40
        && floor_weeks >= 6;
    }

    let price_30d_ago = null, momentum_30d = null;
    if (recentPrices.length > 0) {
      const row30 = recentPrices.find(r => r.date >= d30);
      if (row30 && row30.price > 0) {
        price_30d_ago = row30.price;
        momentum_30d  = (current - price_30d_ago) / price_30d_ago * 100;
      }
    }

    const sparkRows = recentPrices.filter(r => r.date >= d90);
    const sparkline = sparkRows.length > 0
      ? JSON.stringify(sparkRows.map(r => r.price))
      : null;

    await db.query(`
      INSERT INTO card_metrics
        (product_id, ath, drawdown_pct, drawdown_amt, current_price,
         floor_price, floor_median, floor_weeks, breakout_price, in_band,
         qualifies_support, is_deep_value, tier_label, tier_band,
         price_30d_ago, momentum_30d, sparkline, computed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
      ON CONFLICT (product_id) DO UPDATE SET
        ath               = EXCLUDED.ath,
        drawdown_pct      = EXCLUDED.drawdown_pct,
        drawdown_amt      = EXCLUDED.drawdown_amt,
        current_price     = EXCLUDED.current_price,
        floor_price       = EXCLUDED.floor_price,
        floor_median      = EXCLUDED.floor_median,
        floor_weeks       = EXCLUDED.floor_weeks,
        breakout_price    = EXCLUDED.breakout_price,
        in_band           = EXCLUDED.in_band,
        qualifies_support = EXCLUDED.qualifies_support,
        is_deep_value     = EXCLUDED.is_deep_value,
        tier_label        = EXCLUDED.tier_label,
        tier_band         = EXCLUDED.tier_band,
        price_30d_ago     = EXCLUDED.price_30d_ago,
        momentum_30d      = EXCLUDED.momentum_30d,
        sparkline         = EXCLUDED.sparkline,
        computed_at       = NOW()
    `, [
      product_id, ath, drawdown_pct, drawdown_amt, current,
      floor_price, floor_median, floor_weeks, breakout_price, in_band,
      qualifies_support, is_deep_value,
      tier?.label ?? null, tier?.band ?? null,
      price_30d_ago, momentum_30d, sparkline,
    ]);

    done++;
    if (done % 500 === 0)
      console.log(`[computeMetrics] ${done}/${productIds.length}`);
  }

  console.log(`[computeMetrics] Done — ${done} cards computed.`);
}

if (require.main === module) {
  computeMetrics()
    .then(() => db.end())
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = computeMetrics;
