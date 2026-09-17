// scripts/dedupeGroceryPackSizes.js
//
// seedGroceryProducts500.js created several pack-size rows per family (e.g.
// "Apple, 500 g" / "1 kg" / "2 kg" / "5 kg") so every size was independently
// browsable. The user wants one catalog row per item instead, with quantity
// (how many of that pack) chosen at add-to-cart time — the cart already
// works this way (cart_items.quantity is a plain integer multiplier on one
// product row, see src/services/cartService.js).
//
// For each family this keeps exactly one row — the smallest of the sizes
// actually authored in scripts/data/groceryFamilies.js (padded sizes added
// only to pad the seed count are never picked as canonical) — renames/
// re-prices/re-stocks it to that size, and deletes the rest. Deleting is
// safe: cart_items/order_items have no ON DELETE CASCADE on product_id, so
// this will error loudly instead of silently orphaning a real cart/order —
// safe to re-run (idempotent once each family is down to one row).
require('dotenv').config();
const pgPool = require('../src/config/pg.config');
const FAMILIES = require('./data/groceryFamilies');

function canonicalVariant(family) {
  if (family.kind === 'count') {
    const [label, price] = family.variants[0]; // smallest authored pack
    return { name: `${family.name}, ${label}`, price, stock: family.stock };
  }
  const qty = family.sizes.includes(1) ? 1 : Math.min(...family.sizes);
  const label = family.kind === 'weight' ? (qty < 1 ? `${Math.round(qty * 1000)} g` : `${qty} kg`) : (qty < 1 ? `${Math.round(qty * 1000)} ml` : `${qty} L`);
  return { name: `${family.name}, ${label}`, price: family.perUnit * qty, stock: family.stock };
}

async function main() {
  let keptCount = 0;
  let deletedCount = 0;
  let missingCanonical = 0;

  for (const family of FAMILIES) {
    const canonical = canonicalVariant(family);
    const rows = (await pgPool.query('SELECT id, name FROM products WHERE name LIKE $1', [`${family.name}, %`])).rows;
    if (rows.length === 0) continue;

    let keepRow = rows.find((r) => r.name === canonical.name);
    if (!keepRow) {
      // canonical name didn't make it into the DB (e.g. it collided with a
      // pre-existing row under a different id and got skipped) — just keep
      // whichever row is there and re-price/re-stock it to the canonical size.
      keepRow = rows[0];
      missingCanonical++;
    }

    await pgPool.query('UPDATE products SET name = $1, price = $2, stock = $3, updated_at = now() WHERE id = $4', [
      canonical.name,
      canonical.price,
      canonical.stock,
      keepRow.id,
    ]);
    keptCount++;

    const toDelete = rows.filter((r) => r.id !== keepRow.id);
    if (toDelete.length) {
      await pgPool.query('DELETE FROM products WHERE id = ANY($1::text[])', [toDelete.map((r) => r.id)]);
      deletedCount += toDelete.length;
    }
    console.log(`${family.name}: kept "${canonical.name}" (₹${canonical.price}), deleted ${toDelete.length}`);
  }

  console.log(`\nDone. Kept ${keptCount} canonical rows, deleted ${deletedCount} duplicate pack-size rows (${missingCanonical} families used a fallback row instead of the intended canonical size).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
