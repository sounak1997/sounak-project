// scripts/seedMoreGroceryProducts.js
// Additive expansion of scripts/seedGroceryProducts.js — fruits, spices,
// beverages, and more dairy, to round out the catalog's category coverage.
require('dotenv').config();
const productService = require('../src/services/productService');
const { saveResizedImage } = require('../src/utils/imageUpload');

const wikimediaFile = (filename) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MORE_GROCERY_PRODUCTS = [
  {
    name: 'Apple, 1 kg',
    description: 'Fresh red apples, 1 kg.',
    price: 180,
    category: 'Fruits',
    stock: 60,
    image: wikimediaFile('Shiny red apples.jpg'),
  },
  {
    name: 'Banana, 1 dozen',
    description: 'Fresh ripe bananas, one dozen.',
    price: 60,
    category: 'Fruits',
    stock: 70,
    image: wikimediaFile('A bunch of bananas.jpg'),
  },
  {
    name: 'Turmeric Powder, 200 g',
    description: 'Ground turmeric powder, 200 g pack.',
    price: 55,
    category: 'Spices',
    stock: 90,
    image: wikimediaFile('Turmeric-powder.jpg'),
  },
  {
    name: 'Salt, 1 kg',
    description: 'Iodised table salt, 1 kg pack.',
    price: 22,
    category: 'Spices',
    stock: 100,
    image: wikimediaFile('Table salt with salt shaker V1.jpg'),
  },
  {
    name: 'Tea, 250 g',
    description: 'Loose leaf black tea, 250 g pack.',
    price: 140,
    category: 'Beverages',
    stock: 65,
    image: wikimediaFile('Tea, two leaves and a bud.jpg'),
  },
  {
    name: 'Paneer, 200 g',
    description: 'Fresh cottage cheese (paneer), 200 g pack.',
    price: 90,
    category: 'Dairy',
    stock: 45,
    image: wikimediaFile('Homemade Paneer cottage cheese cut into cubes.JPG'),
  },
  {
    name: 'Curd, 400 g',
    description: 'Fresh set curd (yogurt), 400 g pack.',
    price: 40,
    category: 'Dairy',
    stock: 60,
    image: wikimediaFile('Curd in steel bowl.jpg'),
  },
  {
    name: 'Eggs, 6 pack',
    description: 'Farm fresh chicken eggs, pack of 6.',
    price: 48,
    category: 'Dairy',
    stock: 80,
    image: wikimediaFile('6-Pack-Chicken-Eggs.jpg'),
  },
  {
    name: 'Butter, 100 g',
    description: 'Salted table butter, 100 g pack.',
    price: 55,
    category: 'Dairy',
    stock: 50,
    image: wikimediaFile('Stick-of-butter-salted.jpg'),
  },
];

async function fetchImageBuffer(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'sohay-dev-seed/1.0 (local dev seed script)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  console.log(`Seeding ${MORE_GROCERY_PRODUCTS.length} more grocery products...`);

  for (const item of MORE_GROCERY_PRODUCTS) {
    try {
      const product = await productService.createProduct({
        name: item.name,
        description: item.description,
        price: item.price,
        category: item.category,
        stock: item.stock,
      });

      let buffer;
      let attempt = 0;
      while (attempt < 4) {
        attempt++;
        try {
          buffer = await fetchImageBuffer(item.image);
          break;
        } catch (err) {
          if (attempt === 4) throw err;
          console.log(`    (retry ${attempt} for ${item.name}: ${err.message})`);
          await sleep(4000 * attempt);
        }
      }

      const imageUrl = await saveResizedImage(buffer, 'products');
      await productService.addProductImage(product.id, imageUrl);
      console.log(`  ✔ ${product.id}  ${item.name}  -> ${imageUrl}`);
    } catch (err) {
      console.error(`  ✘ ${item.name}: ${err.message}`);
    }
    await sleep(2000); // pace requests to stay under Wikimedia's rate limit
  }

  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
