const assert = require("assert");

function isSymbolTier(val) {
  return typeof val === "string" && /^[\$€£₹]{1,5}$/.test(val.trim());
}

function parseSortableNumber(val) {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const s = val.trim();
    if (/^[\$€£₹]+$/.test(s)) return null;

    const currMatch = s.match(/^[₹$€£]\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]+)?)$/);
    if (currMatch) {
      return parseFloat(currMatch[1].replace(/,/g, ""));
    }

    const match = s.match(/^([+-]?(?:\d+(?:,\d+)*(?:\.\d+)?|\.\d+))\s*([a-zA-Z%]+)?$/);
    if (match) {
      return parseFloat(match[1].replace(/,/g, ""));
    }
  }
  return null;
}

function formatCellValue(col, val) {
  if (val === null || val === undefined || val === "") {
    return `<span class="cell-null">—</span>`;
  }

  if (typeof val === "boolean") {
    return val ? `<span class="cell-bool-yes">Yes</span>` : `<span class="cell-bool-no">No</span>`;
  }

  if (typeof val === "number") {
    const colLower = String(col).toLowerCase();
    if (colLower === "price" || colLower === "price_inr" || colLower === "cost" || colLower === "fee") {
      return `<span class="cell-price">₹${val.toLocaleString("en-IN")}</span>`;
    }
    if (colLower === "rating" || colLower === "score") {
      return `<span class="cell-rating">★ ${val}</span>`;
    }
    return val.toLocaleString();
  }

  const strVal = String(val).trim();
  if (isSymbolTier(strVal)) {
    return `<span class="cell-tier" title="Price tier: ${strVal}">${strVal}</span>`;
  }

  const colLower = String(col).toLowerCase();
  if ((colLower === "rating" || colLower === "score") && !strVal.includes("★")) {
    return `<span class="cell-rating">★ ${strVal}</span>`;
  }

  return strVal;
}

function sortRows(rows, col, direction) {
  return [...rows].sort((a, b) => {
    const valA = a[col];
    const valB = b[col];

    const isNullA = valA === null || valA === undefined || valA === "";
    const isNullB = valB === null || valB === undefined || valB === "";
    if (isNullA && isNullB) return 0;
    if (isNullA) return 1;
    if (isNullB) return -1;

    // 1. Symbol tier scale (e.g. $, $$, $$$, $$$$)
    if (isSymbolTier(valA) && isSymbolTier(valB)) {
      const lenA = String(valA).trim().length;
      const lenB = String(valB).trim().length;
      return direction === "asc" ? lenA - lenB : lenB - lenA;
    }

    // 2. Both values are numbers
    if (typeof valA === "number" && typeof valB === "number") {
      return direction === "asc" ? valA - valB : valB - valA;
    }

    // 3. Formatted quantities with identical units (e.g. 16GB, 18 hrs)
    const numA = parseSortableNumber(valA);
    const numB = parseSortableNumber(valB);
    if (numA !== null && numB !== null) {
      return direction === "asc" ? numA - numB : numB - numA;
    }

    // 4. Generic string natural sort
    const strA = String(valA);
    const strB = String(valB);
    return direction === "asc"
      ? strA.localeCompare(strB, undefined, { numeric: true, sensitivity: "base" })
      : strB.localeCompare(strA, undefined, { numeric: true, sensitivity: "base" });
  });
}

// Tests

// 1. Non-numeric price_level as "$$" rendering
const renderedTier = formatCellValue("price_level", "$$");
assert.ok(renderedTier.includes('class="cell-tier"'));
assert.ok(renderedTier.includes("$$"));
assert.ok(!renderedTier.includes("₹"), "Should NOT format $$ with rupee symbol");

// 2. Sorting by non-numeric price_level ($ vs $$ vs $$$)
const restaurantRows = [
  { id: "r1", name: "Cafe A", price_level: "$$$" },
  { id: "r2", name: "Bistro B", price_level: "$" },
  { id: "r3", name: "Diner C", price_level: "$$" },
  { id: "r4", name: "Place D", price_level: null }
];

const sortedTierAsc = sortRows(restaurantRows, "price_level", "asc");
assert.strictEqual(sortedTierAsc[0].id, "r2"); // $ (tier 1)
assert.strictEqual(sortedTierAsc[1].id, "r3"); // $$ (tier 2)
assert.strictEqual(sortedTierAsc[2].id, "r1"); // $$$ (tier 3)
assert.strictEqual(sortedTierAsc[3].id, "r4"); // null at bottom

const sortedTierDesc = sortRows(restaurantRows, "price_level", "desc");
assert.strictEqual(sortedTierDesc[0].id, "r1"); // $$$ (tier 3)
assert.strictEqual(sortedTierDesc[1].id, "r3"); // $$ (tier 2)
assert.strictEqual(sortedTierDesc[2].id, "r2"); // $ (tier 1)
assert.strictEqual(sortedTierDesc[3].id, "r4"); // null at bottom

// 3. Numeric price sorting
const laptopRows = [
  { id: "r1", name: "Laptop A", price: 54990 },
  { id: "r2", name: "Laptop B", price: 58490 },
  { id: "r3", name: "Laptop C", price: 46990 }
];
const sortedPriceAsc = sortRows(laptopRows, "price", "asc");
assert.strictEqual(sortedPriceAsc[0].id, "r3"); // 46990
assert.strictEqual(sortedPriceAsc[2].id, "r2"); // 58490

// 4. String sorting (cuisine)
const cuisineRows = [
  { id: "r1", cuisine: "Italian" },
  { id: "r2", cuisine: "Continental" },
  { id: "r3", cuisine: "Asian" }
];
const sortedCuisine = sortRows(cuisineRows, "cuisine", "asc");
assert.strictEqual(sortedCuisine[0].cuisine, "Asian");
assert.strictEqual(sortedCuisine[1].cuisine, "Continental");
assert.strictEqual(sortedCuisine[2].cuisine, "Italian");

console.log("All generic type-aware sort & render tests passed successfully!");
