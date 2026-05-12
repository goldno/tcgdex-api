require('dotenv').config();
const db      = require('./db');
const TCGdex  = require('@tcgdex/sdk').default;
const { Query } = require('@tcgdex/sdk');

const tcgdex = new TCGdex('en');
const sleep  = ms => new Promise(r => setTimeout(r, ms));

let debugCount = 0;

async function lookup(cleanName, collectorNum) {
  const localIds = [...new Set([
    String(collectorNum),
    String(collectorNum).padStart(3, '0'),
  ])];

  // 1. Try name + localId combined
  for (const localId of localIds) {
    try {
      const results = await tcgdex.card.list(
        Query.create()
          .contains('name', cleanName)
          .equal('localId', localId)
      );
      if (results && results.length > 0) return results[0].id;
    } catch (err) {
      if (debugCount < 10) console.error(`  [debug] name+localId error: ${err.message}`);
    }
    await sleep(150);
  }

  // 2. Fallback: search by name only, match localId in JS
  try {
    const results = await tcgdex.card.list(
      Query.create().contains('name', cleanName)
    );
    if (debugCount < 10) {
      console.log(`  [debug] name-only for "${cleanName}" (#${collectorNum}): ${results?.length ?? 0} results`);
      debugCount++;
    }
    if (results && results.length > 0) {
      const match = results.find(r =>
        r.localId === String(collectorNum) ||
        r.localId === String(collectorNum).padStart(3, '0')
      );
      if (match) return match.id;
    }
  } catch (err) {
    if (debugCount < 10) console.error(`  [debug] name-only error: ${err.message}`);
  }
  await sleep(150);

  return null;
}

async function backfillTcgdexIds() {
  const { rows } = await db.query(
    `SELECT product_id, name, collector_number
     FROM tracked_cards
     WHERE tcgdex_id IS NULL AND collector_number > 0
     ORDER BY product_id`
  );

  console.log(`[tcgdex-backfill] ${rows.length} cards to process...`);

  let updated = 0, notFound = 0;

  for (const card of rows) {
    const cleanName = card.name
      .replace(/-\s*\d+\/\d+\s*$/, '')  // strip "- X/Y" suffix
      .replace(/\s*\(.*?\)\s*$/, '')     // strip trailing "(Full Art)", etc.
      .trim();
    const tcgdexId  = await lookup(cleanName, card.collector_number);

    if (tcgdexId) {
      await db.query(
        'UPDATE tracked_cards SET tcgdex_id = $1 WHERE product_id = $2',
        [tcgdexId, card.product_id]
      );
      updated++;
    } else {
      notFound++;
    }

    const done = updated + notFound;
    if (done % 100 === 0) {
      console.log(`[tcgdex-backfill] ${done}/${rows.length} — ${updated} updated, ${notFound} not found`);
    }
  }

  console.log(`[tcgdex-backfill] Done — ${updated} updated, ${notFound} not found`);
}

backfillTcgdexIds()
  .then(() => db.end())
  .catch(err => { console.error(err); process.exit(1); });
