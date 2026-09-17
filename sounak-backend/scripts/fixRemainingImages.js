// scripts/fixRemainingImages.js
// Retries the items that were still rate-limited after fixNonIndianImages.js.
// Longer spacing between items this time since the previous run showed
// Wikimedia's limit is a rolling window, not a hard block — some requests
// got through once earlier ones had "aged out."
require('dotenv').config();
const pgPool = require('../src/config/pg.config');
const productService = require('../src/services/productService');
const { saveResizedImage, deleteUploadedImage } = require('../src/utils/imageUpload');

const wikimediaFile = (filename) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REPLACEMENTS = [
  { productName: 'Milk, 1 L', image: wikimediaFile('Glass of milk.jpg') },
  { productName: 'Butter, 100 g', image: wikimediaFile('Desi makhan.jpg') },
  { productName: 'White Bread, 400 g', image: wikimediaFile('Pav Bread.jpg') },
  { productName: 'Paneer, 200 g', image: wikimediaFile('Homemade Paneer cottage cheese cut into cubes.JPG') },
];

async function fetchImageBuffer(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'sohay-dev-seed/1.0 (local dev seed script)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  for (const { productName, image } of REPLACEMENTS) {
    const result = await pgPool.query('SELECT id, image_urls FROM products WHERE name = $1', [productName]);
    if (result.rows.length === 0) {
      console.log(`  ! ${productName}: not found, skipping.`);
      continue;
    }
    const product = result.rows[0];

    let attempt = 0;
    let buffer;
    while (attempt < 6) {
      attempt++;
      try {
        buffer = await fetchImageBuffer(image);
        break;
      } catch (err) {
        if (attempt === 6) {
          console.error(`  ✘ ${productName}: ${err.message}`);
          break;
        }
        console.log(`    (retry ${attempt} for ${productName}: ${err.message})`);
        await sleep(8000 * attempt);
      }
    }
    if (!buffer) {
      await sleep(10000);
      continue;
    }

    const newImageUrl = await saveResizedImage(buffer, 'products');
    const oldUrls = product.image_urls || [];
    await pgPool.query('UPDATE products SET image_urls = $1::jsonb WHERE id = $2', ['[]', product.id]);
    for (const oldUrl of oldUrls) {
      await deleteUploadedImage(oldUrl).catch(() => {});
    }
    await productService.addProductImage(product.id, newImageUrl);
    console.log(`  ✔ ${productName} -> ${newImageUrl}`);
    await sleep(10000); // long gap before the next item
  }

  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
