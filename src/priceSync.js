// Fetches today's TCGPlayer market prices from TCGCSV for all tracked cards
// and saves them as a daily snapshot.
//
// Runs automatically on a daily cron via index.js.
// Can also be run manually: node src/priceSync.js
require('dotenv').config();
const db = require('./db');

const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer/3';
const FETCH_OPTS  = { headers: { 'User-Agent': 'tcgdex-api/1.0' } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function syncPrices() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`[priceSync] Running for ${today}...`);

  // Load all tracked cards and build lookup structures
  const { rows: cards } = await db.query(
    'SELECT product_id, group_id FROM tracked_cards'
  );

  if (cards.length === 0) {
    console.log('[priceSync] No tracked cards — run syncCards first.');
    return;
  }

  const trackedIds = new Set(cards.map(c => c.product_id));
  const groupIds   = [...new Set(cards.map(c => c.group_id))];

  let saved   = 0;
  let skipped = 0;

  for (const groupId of groupIds) {
    await sleep(100);
    const res = await fetch(`${TCGCSV_BASE}/${groupId}/prices`, FETCH_OPTS);
    if (!res.ok) {
      console.log(`[priceSync] Failed for group ${groupId} — HTTP ${res.status}`);
      continue;
    }

    const data   = await res.json();
    const prices = data.results ?? data;

    for (const price of prices) {
      if (!trackedIds.has(price.productId)) continue;
      if (price.marketPrice == null)        continue;

      const result = await db.query(
        `INSERT INTO price_snapshots
           (product_id, snapshot_date, sub_type_name, market_price, low_price, mid_price, high_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (product_id, snapshot_date, sub_type_name) DO NOTHING`,
        [
          price.productId,
          today,
          price.subTypeName,
          price.marketPrice,
          price.lowPrice  ?? null,
          price.midPrice  ?? null,
          price.highPrice ?? null,
        ]
      );

      if (result.rowCount > 0) saved++;
      else skipped++;
    }
  }

  console.log(`[priceSync] Done — ${saved} new snapshots, ${skipped} already existed.`);
  await sendNotification(today, saved, skipped);
}

async function sendNotification(date, saved, skipped) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'TCGDex API <onboarding@resend.dev>',
        to: ['goldno@hotmail.com'],
        subject: `Price sync complete — ${date}`,
        html: `<p><strong>${date}</strong> sync finished.</p>
               <p>${saved} new snapshots saved, ${skipped} already existed.</p>`,
      }),
    });
  } catch (err) {
    console.error('[priceSync] Email notification failed:', err.message);
  }
}

// Allow running directly for testing: node src/priceSync.js
if (require.main === module) {
  require('dotenv').config();
  syncPrices()
    .then(() => db.end())
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = syncPrices;
