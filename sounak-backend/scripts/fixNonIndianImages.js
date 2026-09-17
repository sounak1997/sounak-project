// scripts/fixNonIndianImages.js
// Swaps a few product images that read as generic Western stock photography
// (glass milk bottle, Western butter stick, salt shaker, sliced white bread)
// for more India-appropriate equivalents. Clears the old image first so the
// product ends up with one correct image, not both stacked.
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
  { productName: 'Salt, 1 kg', image: wikimediaFile('Salt Crystals.JPG') },
  { productName: 'White Bread, 400 g', image: wikimediaFile('Pav Bread.jpg') },
  { productName: 'Tea, 250 g', image: wikimediaFile('Assam black tea.jpg') },
  // Never got an image at all — Wikimedia rate-limited every attempt during
  // the original seed run. Same source as originally intended.
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
    while (attempt < 4) {
      attempt++;
      try {
        buffer = await fetchImageBuffer(image);
        break;
      } catch (err) {
        if (attempt === 4) {
          console.error(`  ✘ ${productName}: ${err.message}`);
          break;
        }
        console.log(`    (retry ${attempt} for ${productName}: ${err.message})`);
        await sleep(4000 * attempt);
      }
    }
    if (!buffer) {
      await sleep(2000);
      continue;
    }

    const newImageUrl = await saveResizedImage(buffer, 'products');

    // Clear old image(s) first (delete files, then blank the column) so the
    // product ends up with exactly the new one, not the old + new stacked.
    const oldUrls = product.image_urls || [];
    await pgPool.query('UPDATE products SET image_urls = $1::jsonb WHERE id = $2', ['[]', product.id]);
    for (const oldUrl of oldUrls) {
      await deleteUploadedImage(oldUrl).catch(() => {});
    }

    await productService.addProductImage(product.id, newImageUrl);
    console.log(`  ✔ ${productName} -> ${newImageUrl}`);
    await sleep(2000);
  }

  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
