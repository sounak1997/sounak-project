// scripts/seedGroceryProducts.js
//
// One-off dev seed: dummy grocery products with real photos, run through the
// exact same pipeline a real admin upload uses (productService.createProduct
// + saveResizedImage + productService.addProductImage) — see FR-2.1, NFR-3.
// Images are freely-licensed stock photos from Wikimedia Commons, fetched at
// seed time rather than committed to the repo.
require('dotenv').config();
const productService = require('../src/services/productService');
const { saveResizedImage } = require('../src/utils/imageUpload');

const wikimediaFile = (filename) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}`;

const GROCERY_PRODUCTS = [
  {
    name: 'Basmati Rice, 5 kg',
    description: 'Long-grain aromatic basmati rice, 5 kg pack.',
    price: 310,
    category: 'Staples',
    stock: 60,
    image: wikimediaFile('Basmati Rice.jpg'),
  },
  {
    name: 'Sunflower Oil, 1 L',
    description: 'Refined sunflower cooking oil, 1 litre bottle.',
    price: 145,
    category: 'Staples',
    stock: 80,
    image: wikimediaFile('Bottle 1 liter Sunflower refined oil.jpg'),
  },
  {
    name: 'Wheat Atta, 5 kg',
    description: 'Whole wheat flour for rotis and chapatis, 5 kg pack.',
    price: 210,
    category: 'Staples',
    stock: 55,
    image: wikimediaFile('Wheat flour 01.jpg'),
  },
  {
    name: 'Toor Dal, 1 kg',
    description: 'Split pigeon peas (toor/arhar dal), 1 kg pack.',
    price: 135,
    category: 'Staples',
    stock: 70,
    image: wikimediaFile('Toor dal.jpg'),
  },
  {
    name: 'Sugar, 1 kg',
    description: 'Refined white sugar, 1 kg pack.',
    price: 48,
    category: 'Staples',
    stock: 90,
    image: wikimediaFile('Bowl of white sugar without background.jpg'),
  },
  {
    name: 'Milk, 1 L',
    description: 'Fresh pasteurized toned milk, 1 litre.',
    price: 32,
    category: 'Dairy',
    stock: 100,
    image: wikimediaFile('Milk-bottle.jpg'),
  },
  {
    name: 'Onion, 1 kg',
    description: 'Fresh red onions, 1 kg.',
    price: 28,
    category: 'Vegetables',
    stock: 120,
    image: wikimediaFile('Red onions.jpg'),
  },
  {
    name: 'Tomato, 1 kg',
    description: 'Fresh ripe tomatoes, 1 kg.',
    price: 30,
    category: 'Vegetables',
    stock: 110,
    image: wikimediaFile('Fresh big juicy tomatoes.jpg'),
  },
  {
    name: 'Potato, 1 kg',
    description: 'Fresh potatoes, 1 kg.',
    price: 25,
    category: 'Vegetables',
    stock: 130,
    image: wikimediaFile('Potatoes.jpg'),
  },
  {
    name: 'White Bread, 400 g',
    description: 'Soft white sandwich bread loaf, 400 g.',
    price: 45,
    category: 'Bakery',
    stock: 40,
    image: wikimediaFile('Different types of white bread.jpg'),
  },
];

async function fetchImageBuffer(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'sohay-dev-seed/1.0 (local dev seed script)' } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  console.log(`Seeding ${GROCERY_PRODUCTS.length} grocery products...`);

  for (const item of GROCERY_PRODUCTS) {
    try {
      const product = await productService.createProduct({
        name: item.name,
        description: item.description,
        price: item.price,
        category: item.category,
        stock: item.stock,
      });

      const buffer = await fetchImageBuffer(item.image);
      const imageUrl = await saveResizedImage(buffer, 'products');
      await productService.addProductImage(product.id, imageUrl);

      console.log(`  ✔ ${product.id}  ${item.name}  -> ${imageUrl}`);
    } catch (err) {
      console.error(`  ✘ ${item.name}: ${err.message}`);
    }
  }

  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
