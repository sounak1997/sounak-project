// scripts/prefetchGroceryImages.js
//
// Downloads the one real photo-per-family used by seedGroceryProducts500.js
// (scripts/data/groceryImageMap.json) to scripts/data/images/, decoupled
// from the DB-writing pass. Wikimedia's edge cache hands out a hard ~600s
// IP-wide cooldown (Retry-After) after a burst of requests, which is fatal
// if it happens mid-seed (partially-created products, awkward resume); this
// script only ever downloads, so it's safe to re-run — already-downloaded
// files are skipped — and paces + backs off patiently since it doesn't need
// to keep a DB transaction warm while it waits.
const fs = require('fs');
const path = require('path');

const IMAGE_MAP = require('./data/groceryImageMap.json');
const OUT_DIR = path.join(__dirname, 'data', 'images');
fs.mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'sounak-grocery-dev-seed/1.0 (local dev seed script; contact smitra@vuemotionteam.com)';

const slugify = (term) => term.replace(/[^a-z0-9]+/gi, '_').toLowerCase();

async function fetchWithBackoff(url, label) {
  const delays = [0, 8000, 20000, 45000, 90000];
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) {
      console.log(`  ... waiting ${delays[i] / 1000}s before retry ${i} for ${label}`);
      await sleep(delays[i]);
    }
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 200) return Buffer.from(await res.arrayBuffer());
    if (res.status !== 429) throw new Error(`HTTP ${res.status}`);
    console.log(`  429 for ${label} (attempt ${i + 1}/${delays.length})`);
  }
  throw new Error('exhausted retries, still 429');
}

async function main() {
  const entries = Object.entries(IMAGE_MAP);
  let done = 0;
  for (const [term, info] of entries) {
    const file = path.join(OUT_DIR, `${slugify(term)}.jpg`);
    if (fs.existsSync(file)) {
      done++;
      continue;
    }
    try {
      const buf = await fetchWithBackoff(info.url, term);
      fs.writeFileSync(file, buf);
      done++;
      console.log(`OK  (${done}/${entries.length}) ${term} -> ${file} (${buf.length} bytes)`);
    } catch (err) {
      console.log(`FAIL (${done}/${entries.length}) ${term}: ${err.message}`);
    }
    await sleep(3000); // patient pacing between distinct images
  }
  console.log(`DONE downloaded=${done}/${entries.length}`);
}

main();
