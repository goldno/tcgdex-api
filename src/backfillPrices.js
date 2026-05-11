require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { extractFull } = require('node-7z');
const { path7za }     = require('7zip-bin');
const db = require('./db');

// Ensure the 7zip binary is executable (Railway containers strip execute bits)
try { fs.chmodSync(path7za, 0o755); } catch (_) {}

const ARCHIVE_BASE = 'https://tcgcsv.com/archive/tcgplayer';
const CATEGORY_ID  = 3;
const FETCH_OPTS   = { headers: { 'User-Agent': 'tcgdex-api/1.0' } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function downloadToFile(url, destPath) {
  const res = await fetch(url, FETCH_OPTS);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
}

function extractArchive(archivePath, destDir, targets) {
  return new Promise((resolve, reject) => {
    const stream = extractFull(archivePath, destDir, {
      $bin: path7za,
      $cherryPick: targets,
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
}

async function backfillDate(dateStr, groupIds) {
  const url        = `${ARCHIVE_BASE}/prices-${dateStr}.ppmd.7z`;
  const tmpDir     = fs.mkdtempSync(path.join(os.tmpdir(), 'tcgdex-'));
  const archivePath = path.join(tmpDir, 'archive.7z');

  try {
    process.stdout.write(`[backfill] ${dateStr} — downloading...`);
    await downloadToFile(url, archivePath);
    process.stdout.write(' extracting...');

    // Only pull category 3 (Pokémon) files for our tracked groups
    const targets = groupIds.map(id => `${dateStr}/${CATEGORY_ID}/${id}/prices`);
    await extractArchive(archivePath, tmpDir, targets);
    console.log(' inserting...');

    let saved = 0, skipped = 0;

    for (const groupId of groupIds) {
      const filePath = path.join(tmpDir, dateStr, String(CATEGORY_ID), String(groupId), 'prices');
      if (!fs.existsSync(filePath)) continue;

      const raw    = fs.readFileSync(filePath, 'utf8');
      const data   = JSON.parse(raw);
      const prices = data.results ?? data;

      for (const price of prices) {
        if (price.marketPrice == null) continue;

        const result = await db.query(
          `INSERT INTO price_snapshots
             (product_id, snapshot_date, sub_type_name, market_price, low_price, mid_price, high_price)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (product_id, snapshot_date, sub_type_name) DO NOTHING`,
          [
            price.productId,
            dateStr,
            price.subTypeName,
            price.marketPrice,
            price.lowPrice  ?? null,
            price.midPrice  ?? null,
            price.highPrice ?? null,
          ]
        );

        if (result.rowCount > 0) saved++; else skipped++;
      }
    }

    console.log(`[backfill] ${dateStr} — ${saved} new, ${skipped} already existed.`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function backfill() {
  const { rows: cardRows } = await db.query('SELECT DISTINCT group_id FROM tracked_cards');
  const groupIds = cardRows.map(r => r.group_id);

  if (groupIds.length === 0) {
    console.log('[backfill] No tracked cards — run syncCards first.');
    return;
  }

  // Parse --from / --to flags, e.g. node backfillPrices.js --from 2024-02-08 --to 2025-01-01
  const args     = process.argv.slice(2);
  const fromIdx  = args.indexOf('--from');
  const toIdx    = args.indexOf('--to');
  const fromArg  = fromIdx !== -1 ? args[fromIdx + 1] : undefined;
  const toArg    = toIdx   !== -1 ? args[toIdx   + 1] : undefined;

  let start, end;

  if (fromArg) {
    start = new Date(fromArg);
  } else {
    // Default: day after the earliest per-group max snapshot date.
    // Uses MIN across groups so that newly added groups (with no history)
    // pull us back to the beginning rather than skipping them.
    const { rows: latestRows } = await db.query(`
      SELECT MIN(COALESCE(max_date, '2024-02-07'))::text AS last_date
      FROM (
        SELECT tc.group_id, MAX(ps.snapshot_date) AS max_date
        FROM tracked_cards tc
        LEFT JOIN price_snapshots ps USING (product_id)
        GROUP BY tc.group_id
      ) sub
    `);
    const lastDate = latestRows[0].last_date ?? '2024-02-07';
    start = new Date(lastDate);
    start.setUTCDate(start.getUTCDate() + 1);
  }

  if (toArg) {
    end = new Date(toArg);
  } else {
    // Default: yesterday (today's archive may not be published yet)
    end = new Date();
    end.setUTCDate(end.getUTCDate() - 1);
  }

  if (start > end) {
    console.log('[backfill] Already up to date.');
    return;
  }

  const startStr = start.toISOString().slice(0, 10);
  const endStr   = end.toISOString().slice(0, 10);
  console.log(`[backfill] ${startStr} → ${endStr}  (${groupIds.length} groups)`);

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    try {
      await backfillDate(dateStr, groupIds);
    } catch (err) {
      console.error(`[backfill] ${dateStr} — FAILED: ${err.message}`);
    }
    await sleep(500); // polite gap between archive downloads
  }

  console.log('[backfill] Complete.');
}

backfill()
  .then(() => db.end())
  .catch(err => { console.error(err); process.exit(1); });
