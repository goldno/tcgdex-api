require('dotenv').config();
const db      = require('./db');
const TCGdex  = require('@tcgdex/sdk').default;
const { Query } = require('@tcgdex/sdk');

const tcgdex      = new TCGdex('en');
const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer/3';
const FETCH_OPTS  = { headers: { 'User-Agent': 'tcgdex-api/1.0' } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Rarity keyword sets per era — matched as case-insensitive substrings against
// the TCGPlayer rarity field (e.g. "Rare Holo EX" matches 'EX', "Rare Ultra" matches 'Ultra')
const XY_RARITIES = ['EX', 'BREAK', 'Full Art', 'Ultra'];
const SM_RARITIES = ['GX', 'Full Art', 'Shining', 'Prism', 'Ultra'];

// SWSH: rarity can't distinguish regular V from Full Art V (both "Ultra Rare", both within set count).
// Match VMAX/VSTAR by name, Full Art variants by URL containing "full-art"
// (covers Full Art V, Alt Arts within set count, Trainer Full Arts),
// and aboveSetCount for Rainbow Rares and Gold cards above the printed total.
const SWSH_SET = { nameContains: ['VMAX', 'VSTAR'], urlContains: ['full-art'], aboveSetCount: true };

// Explicit set configs keyed by TCGCSV group ID.
//
// includeAll: true         — track every product in the set
// minMarketPrice: N        — (used with includeAll) only track if current market price >= N
// rarities: [...]          — track if rarity field contains any keyword (case-insensitive)
// nameContains: [...]      — track if product name contains any keyword (case-insensitive)
// urlContains: [...]       — track if TCGPlayer URL contains any keyword (e.g. 'full-art')
// aboveSetCount: true      — track if collector number exceeds set total
const SET_CONFIGS = {
  // ── XY Era ────────────────────────────────────────────────────────────────
  1451:  { name: 'XY Promos',                              includeAll: true, minMarketPrice: 5 },
  1387:  { name: 'XY Base Set',                            rarities: XY_RARITIES, aboveSetCount: true },
  1464:  { name: 'XY - Flashfire',                         rarities: XY_RARITIES, aboveSetCount: true },
  1481:  { name: 'XY - Furious Fists',                     rarities: XY_RARITIES, aboveSetCount: true },
  1494:  { name: 'XY - Phantom Forces',                    rarities: XY_RARITIES, aboveSetCount: true },
  1509:  { name: 'XY - Primal Clash',                      rarities: XY_RARITIES, aboveSetCount: true },
  1525:  { name: 'Double Crisis',                          rarities: XY_RARITIES, aboveSetCount: true },
  1534:  { name: 'XY - Roaring Skies',                     rarities: XY_RARITIES, aboveSetCount: true },
  1576:  { name: 'XY - Ancient Origins',                   rarities: XY_RARITIES, aboveSetCount: true },
  1661:  { name: 'XY - BREAKthrough',                      rarities: XY_RARITIES, aboveSetCount: true },
  1701:  { name: 'XY - BREAKpoint',                        rarities: XY_RARITIES, aboveSetCount: true },
  1728:  { name: 'Generations',                            rarities: XY_RARITIES, aboveSetCount: true },
  1729:  { name: 'Generations: Radiant Collection',        rarities: XY_RARITIES, aboveSetCount: true },
  1780:  { name: 'XY - Fates Collide',                     rarities: XY_RARITIES, aboveSetCount: true },
  1815:  { name: 'XY - Steam Siege',                       rarities: XY_RARITIES, aboveSetCount: true },
  // Evolutions also includes standard Holofoils ('Rare Holo')
  1842:  { name: 'XY - Evolutions',                        rarities: [...XY_RARITIES, 'Rare Holo'], aboveSetCount: true },

  // ── Sun & Moon Era ────────────────────────────────────────────────────────
  1861:  { name: 'SM Promos',                              includeAll: true, minMarketPrice: 5 },
  1919:  { name: 'SM - Guardians Rising',                  rarities: SM_RARITIES, aboveSetCount: true },
  1938:  { name: 'Alternate Art Promos',                   includeAll: true, minMarketPrice: 5 },
  1957:  { name: 'SM - Burning Shadows',                   rarities: SM_RARITIES, aboveSetCount: true },
  2054:  { name: 'Shining Legends',                        rarities: SM_RARITIES, aboveSetCount: true },
  2071:  { name: 'SM - Crimson Invasion',                  rarities: SM_RARITIES, aboveSetCount: true },
  2178:  { name: 'SM - Ultra Prism',                       rarities: SM_RARITIES, aboveSetCount: true },
  2209:  { name: 'SM - Forbidden Light',                   rarities: SM_RARITIES, aboveSetCount: true },
  2278:  { name: 'SM - Celestial Storm',                   rarities: SM_RARITIES, aboveSetCount: true },
  2295:  { name: 'Dragon Majesty',                         rarities: SM_RARITIES, aboveSetCount: true },
  2328:  { name: 'SM - Lost Thunder',                      rarities: SM_RARITIES, aboveSetCount: true },
  2377:  { name: 'SM - Team Up',                           rarities: SM_RARITIES, aboveSetCount: true },
  2420:  { name: 'SM - Unbroken Bonds',                    rarities: SM_RARITIES, aboveSetCount: true },
  2464:  { name: 'SM - Unified Minds',                     rarities: SM_RARITIES, aboveSetCount: true },
  2480:  { name: 'Hidden Fates',                           rarities: SM_RARITIES, aboveSetCount: true },
  2594:  { name: 'Hidden Fates: Shiny Vault',              includeAll: true },
  2534:  { name: 'SM - Cosmic Eclipse',                    rarities: SM_RARITIES, aboveSetCount: true },

  // ── Sword & Shield Era ────────────────────────────────────────────────────
  2545:  { name: 'SWSH: Sword & Shield Promo Cards',        includeAll: true, minMarketPrice: 5 },
  2585:  { name: 'SWSH01: Sword & Shield Base Set',         ...SWSH_SET },
  2626:  { name: 'SWSH02: Rebel Clash',                     ...SWSH_SET },
  2675:  { name: 'SWSH03: Darkness Ablaze',                 ...SWSH_SET },
  2685:  { name: "Champion's Path",                         ...SWSH_SET },
  2701:  { name: 'SWSH04: Vivid Voltage',                   ...SWSH_SET },
  2754:  { name: 'Shining Fates',                           ...SWSH_SET },
  2781:  { name: 'Shining Fates: Shiny Vault',              includeAll: true },
  2807:  { name: 'SWSH06: Chilling Reign',                  ...SWSH_SET },
  2848:  { name: 'SWSH07: Evolving Skies',                  ...SWSH_SET },
  2867:  { name: 'Celebrations',                            ...SWSH_SET },
  2931:  { name: 'Celebrations: Classic Collection',        includeAll: true },
  2906:  { name: 'SWSH08: Fusion Strike',                   ...SWSH_SET },
  2948:  { name: 'SWSH09: Brilliant Stars',                 ...SWSH_SET },
  3020:  { name: 'SWSH09: Brilliant Stars Trainer Gallery', includeAll: true },
  3040:  { name: 'SWSH10: Astral Radiance',                 ...SWSH_SET },
  3068:  { name: 'SWSH10: Astral Radiance Trainer Gallery', includeAll: true },
  3064:  { name: 'Pokemon GO',                              ...SWSH_SET },
  3118:  { name: 'SWSH11: Lost Origin',                     ...SWSH_SET },
  3172:  { name: 'SWSH11: Lost Origin Trainer Gallery',     includeAll: true },
  3170:  { name: 'SWSH12: Silver Tempest',                  ...SWSH_SET },
  17674: { name: 'SWSH12: Silver Tempest Trainer Gallery',  includeAll: true },
  17688: { name: 'SWSH: Crown Zenith',                      ...SWSH_SET },
  17689: { name: 'SWSH: Crown Zenith Galarian Gallery',     includeAll: true },

  // ── SV & ME Promos ────────────────────────────────────────────────────────
  22872: { name: 'SV: Scarlet & Violet Promo Cards',       includeAll: true, minMarketPrice: 5 },
  24451: { name: 'ME: Mega Evolution Promo',               includeAll: true, minMarketPrice: 5 },
};

// Dynamic SV era discovery — picks up new main-set releases automatically.
// Excludes any group already covered by SET_CONFIGS above.
const DYNAMIC_TRACK_FROM = new Date('2023-01-01');
const EXCLUDE_PATTERN    = /promo|energ|bundle|mcdonald|academy|classic|trick.or.trade|placement|first.partner|first.battle|miscellaneous/i;
const EXPLICIT_IDS       = new Set(Object.keys(SET_CONFIGS).map(Number));

function isMainSvSet(group) {
  if (new Date(group.publishedOn) < DYNAMIC_TRACK_FROM) return false;
  if (EXCLUDE_PATTERN.test(group.name))                  return false;
  if (EXPLICIT_IDS.has(group.groupId))                   return false;
  return true;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseCardNumber(product) {
  if (Array.isArray(product.extendedData)) {
    const field = product.extendedData.find(f => f.name === 'Number');
    if (field?.value) {
      const m = String(field.value).match(/^(\d+)\/(\d+)$/);
      if (m) return { collectorNum: parseInt(m[1]), setTotal: parseInt(m[2]) };
    }
  }
  const m = product.name?.match(/-\s*(\d+)\/(\d+)\s*$/);
  if (m) return { collectorNum: parseInt(m[1]), setTotal: parseInt(m[2]) };
  return null;
}

function getRarity(product) {
  if (Array.isArray(product.extendedData)) {
    const field = product.extendedData.find(f => f.name === 'Rarity');
    return field?.value ?? null;
  }
  return null;
}

// TCGCSV recommendation: presence of 'Number' or 'Rarity' in extendedData
// distinguishes individual cards from sealed products (packs, boxes, etc.)
function isCard(product) {
  if (!Array.isArray(product.extendedData)) return false;
  return product.extendedData.some(f => f.name === 'Number' || f.name === 'Rarity');
}

function matchesRarity(product, rarities) {
  const rarity = getRarity(product);
  if (!rarity) return false;
  const lower = rarity.toLowerCase();
  return rarities.some(r => lower.includes(r.toLowerCase()));
}

async function getProductIdsAbovePrice(groupId, minPrice) {
  await sleep(100);
  const res = await fetch(`${TCGCSV_BASE}/${groupId}/prices`, FETCH_OPTS);
  if (!res.ok) return new Set();
  const data   = await res.json();
  const prices = data.results ?? data;
  return new Set(
    prices.filter(p => p.marketPrice != null && p.marketPrice >= minPrice).map(p => p.productId)
  );
}

async function upsertCard(product, setName, groupId, collectorNum, setTotal, rarity) {
  const cleanName = product.name.replace(/-\s*\d+\/\d+\s*$/, '').trim();
  let tcgdexId = null;

  if (collectorNum != null) {
    try {
      const results = await tcgdex.card.list(
        Query.create()
          .contains('name', cleanName)
          .equal('localId', String(collectorNum))
      );
      if (results && results.length > 0) tcgdexId = results[0].id;
    } catch (_) {}
  }

  await db.query(
    `INSERT INTO tracked_cards
       (product_id, group_id, set_name, name, collector_number, set_total, image_url, tcgplayer_url, rarity, tcgdex_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (product_id) DO UPDATE
       SET name          = EXCLUDED.name,
           image_url     = EXCLUDED.image_url,
           tcgplayer_url = EXCLUDED.tcgplayer_url,
           rarity        = EXCLUDED.rarity,
           tcgdex_id     = COALESCE(tracked_cards.tcgdex_id, EXCLUDED.tcgdex_id)`,
    [
      product.productId,
      groupId,
      setName,
      product.name,
      collectorNum ?? 0,
      setTotal     ?? 0,
      product.imageUrl ?? null,
      product.url      ?? null,
      rarity,
      tcgdexId,
    ]
  );
}

// ── Per-set processor ─────────────────────────────────────────────────────────

async function processSet(groupId, config) {
  await sleep(100);
  const res = await fetch(`${TCGCSV_BASE}/${groupId}/products`, FETCH_OPTS);
  if (!res.ok) {
    console.log(`  SKIP "${config.name}" — HTTP ${res.status}`);
    return 0;
  }

  const products = (await res.json()).results ?? [];
  let pricedIds  = null;

  if (config.includeAll && config.minMarketPrice != null) {
    pricedIds = await getProductIdsAbovePrice(groupId, config.minMarketPrice);
  }

  let count = 0;

  for (const product of products) {
    const parsed       = parseCardNumber(product);
    const collectorNum = parsed?.collectorNum ?? null;
    const setTotal     = parsed?.setTotal     ?? null;
    const rarity       = getRarity(product);
    let   shouldTrack  = false;

    if (config.includeAll) {
      shouldTrack = isCard(product) && (pricedIds ? pricedIds.has(product.productId) : true);
    } else if (isCard(product) && collectorNum != null) {
      if (config.rarities && matchesRarity(product, config.rarities))                                    shouldTrack = true;
      if (config.nameContains && config.nameContains.some(kw => product.name?.toLowerCase().includes(kw.toLowerCase()))) shouldTrack = true;
      if (config.urlContains  && config.urlContains.some(kw  => product.url?.toLowerCase().includes(kw.toLowerCase())))  shouldTrack = true;
      if (config.aboveSetCount && collectorNum > setTotal)                                                shouldTrack = true;
    }

    if (!shouldTrack) continue;

    await upsertCard(product, config.name, groupId, collectorNum, setTotal, rarity);
    count++;
  }

  if (count > 0) console.log(`  "${config.name}": ${count} cards`);
  return count;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function syncCards() {
  // 1. Explicitly configured sets (XY / SM / SWSH + promos)
  console.log('[syncCards] Processing explicit sets...');
  let explicitTotal = 0;
  for (const [groupId, config] of Object.entries(SET_CONFIGS)) {
    explicitTotal += await processSet(Number(groupId), config);
  }
  console.log(`[syncCards] ${explicitTotal} cards from explicit sets.`);

  // 2. Dynamic discovery for new SV era main sets
  console.log('[syncCards] Discovering new SV era sets...');
  const groupsRes = await fetch(`${TCGCSV_BASE}/groups`, FETCH_OPTS);
  if (!groupsRes.ok) {
    console.error(`[syncCards] Failed to fetch groups — HTTP ${groupsRes.status}`);
    return;
  }

  const sets = (await groupsRes.json()).results?.filter(isMainSvSet) ?? [];
  console.log(`[syncCards] ${sets.length} new SV sets found.`);

  let svTotal = 0;
  for (const set of sets) {
    svTotal += await processSet(set.groupId, {
      name:          set.name,
      aboveSetCount: true,
    });
  }
  console.log(`[syncCards] ${svTotal} cards from dynamic SV discovery.`);
  console.log(`[syncCards] Done — ${explicitTotal + svTotal} total cards tracked.`);
}

if (require.main === module) {
  require('dotenv').config();
  syncCards()
    .then(() => db.end())
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = syncCards;
