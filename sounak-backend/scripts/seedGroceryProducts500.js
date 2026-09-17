// scripts/seedGroceryProducts500.js
//
// Bulk dev seed: expands scripts/data/groceryFamilies.js (~145 West Bengal
// kirana-store product families, e.g. "Basmati Rice") into 500+ pack-size
// variants (e.g. "Basmati Rice, 1 kg" / "2 kg" / "10 kg" / "25 kg"), each
// going through the same pipeline a real admin upload uses
// (productService.createProduct + saveResizedImage + addProductImage — see
// FR-2.1, NFR-3), same as scripts/seedGroceryProducts.js.
//
// Images come from scripts/data/groceryImageMap.json: one real Wikimedia
// Commons photo per family, resolved via their search API and checked for
// topical relevance (not just guessed filenames) before being baked in here
// — see the family's `term` key. The image is fetched and resized ONCE per
// family and reused across all of that family's size variants, both to
// avoid hammering Commons and because pack-size variants of one product
// legitimately share a photo.
//
// Families with too few natural pack sizes are padded up to a minimum
// (4 sizes for weight/volume, 3 for count-based items) using a generic
// doubling ladder / bulk-pack label, purely to comfortably clear the
// "500+ products" target without inventing more real-world variety than
// exists — see padSizes/padCountVariants below.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const productService = require('../src/services/productService');
const { saveResizedImage } = require('../src/utils/imageUpload');
const pgPool = require('../src/config/pg.config');
const FAMILIES = require('./data/groceryFamilies');
const IMAGE_MAP = require('./data/groceryImageMap.json');

// Images are pre-downloaded to disk by prefetchGroceryImages.js so this pass
// never depends on Wikimedia's rate limiting while it's writing to the DB.
const LOCAL_IMAGE_DIR = path.join(__dirname, 'data', 'images');
const slugify = (term) => term.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
const localImagePath = (term) => path.join(LOCAL_IMAGE_DIR, `${slugify(term)}.jpg`);

const MIN_WEIGHT_VOLUME_SIZES = 4;
const MIN_COUNT_VARIANTS = 3;
const SIZE_LADDER = [0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 25, 50];

function padSizes(sizes) {
  const out = [...sizes];
  while (out.length < MIN_WEIGHT_VOLUME_SIZES) {
    const max = Math.max(...out);
    const next = SIZE_LADDER.find((x) => x > max + 1e-9);
    if (next == null) break;
    out.push(next);
  }
  return out;
}

function padCountVariants(variants) {
  const out = variants.map((v) => [...v]);
  const extraLabels = ['Value Pack', 'Family Pack', 'Combo Pack'];
  let i = 0;
  while (out.length < MIN_COUNT_VARIANTS && i < extraLabels.length) {
    const maxPrice = Math.max(...out.map((v) => v[1]));
    out.push([extraLabels[i], Math.round((maxPrice * 1.7) / 5) * 5]);
    i++;
  }
  return out;
}

function bulkFactor(qty) {
  if (qty >= 20) return 0.82;
  if (qty >= 10) return 0.88;
  if (qty >= 5) return 0.93;
  if (qty >= 2) return 0.97;
  return 1;
}

function priceForQty(perUnit, qty) {
  const raw = perUnit * qty * bulkFactor(qty);
  return Math.max(5, Math.round(raw / 5) * 5);
}

function sizeLabel(kind, qty) {
  if (kind === 'weight') return qty < 1 ? `${Math.round(qty * 1000)} g` : `${qty} kg`;
  return qty < 1 ? `${Math.round(qty * 1000)} ml` : `${qty} L`;
}

function stockForQty(baseStock, qty) {
  const factor = Math.min(4, Math.max(0.3, 1 / Math.sqrt(qty)));
  return Math.max(8, Math.min(400, Math.round(baseStock * factor)));
}

// Expand one family definition into its list of {name, price, stock} variants.
function expandFamily(family) {
  if (family.kind === 'count') {
    return padCountVariants(family.variants).map(([label, price]) => ({
      name: `${family.name}, ${label}`,
      price,
      stock: family.stock,
    }));
  }
  return padSizes(family.sizes).map((qty) => ({
    name: `${family.name}, ${sizeLabel(family.kind, qty)}`,
    price: priceForQty(family.perUnit, qty),
    stock: stockForQty(family.stock, qty),
  }));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Wikimedia's edge cache can hand out a hard ~600s cooldown (Retry-After)
// after a burst of requests — not something worth retrying inline for. Try
// once more after a short pause for transient blips, then give up on this
// family; failed families get a separate slow retry pass at the end.
async function fetchImageBuffer(url, attempt = 1) {
  const res = await fetch(url, { headers: { 'User-Agent': 'sounak-grocery-dev-seed/1.0 (local dev seed script)' } });
  if (res.status === 429 && attempt <= 2) {
    await sleep(attempt * 4000);
    return fetchImageBuffer(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const counts = { created: 0, skipped: 0 };

async function processFamily(family, existingNames) {
  const imageEntry = IMAGE_MAP[family.term];
  if (!imageEntry) {
    console.error(`  ✘ [${family.name}] no image mapped for term "${family.term}", skipping family`);
    return false;
  }

  let imageUrl;
  try {
    const localPath = localImagePath(family.term);
    const buffer = fs.existsSync(localPath) ? fs.readFileSync(localPath) : await fetchImageBuffer(imageEntry.url);
    imageUrl = await saveResizedImage(buffer, 'products');
  } catch (err) {
    console.error(`  ✘ [${family.name}] image fetch failed: ${err.message}, skipping family`);
    return false;
  }

  const variants = expandFamily(family);
  for (const variant of variants) {
    if (existingNames.has(variant.name)) {
      counts.skipped++;
      continue;
    }
    try {
      const product = await productService.createProduct({
        name: variant.name,
        description: family.desc,
        price: variant.price,
        category: family.category,
        stock: variant.stock,
      });
      await productService.addProductImage(product.id, imageUrl);
      existingNames.add(variant.name);
      counts.created++;
      console.log(`  ✔ ${product.id}  ${variant.name}  ₹${variant.price}`);
    } catch (err) {
      console.error(`  ✘ ${variant.name}: ${err.message}`);
    }
  }
  return true;
}

async function main() {
  const existingNamesResult = await pgPool.query('SELECT name FROM products');
  const existingNames = new Set(existingNamesResult.rows.map((r) => r.name));

  console.log(`Seeding from ${FAMILIES.length} product families...`);

  const failedFamilies = [];
  for (const family of FAMILIES) {
    const usedNetwork = !fs.existsSync(localImagePath(family.term));
    const ok = await processFamily(family, existingNames);
    if (!ok) failedFamilies.push(family);
    if (usedNetwork) await sleep(1200); // only throttle actual Commons fetches, not local-disk reads
  }

  if (failedFamilies.length) {
    console.log(`\nRetrying ${failedFamilies.length} failed families with a longer pause...`);
    const stillFailed = [];
    for (const family of failedFamilies) {
      await sleep(5000);
      const ok = await processFamily(family, existingNames);
      if (!ok) stillFailed.push(family.name);
    }
    if (stillFailed.length) {
      console.log(`\nStill failed after retry: ${stillFailed.join(', ')}`);
    }
  }

  console.log(`\nDone. Created ${counts.created} products, skipped ${counts.skipped} (already existed), ${failedFamilies.length} families needed a retry.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
