const assert = require("assert");

// -------------------------------------------------------------
// Type-Aware Detection and Parsing Helpers
// -------------------------------------------------------------

function parseSymbolTier(val) {
  if (typeof val !== "string") return null;
  const s = val.trim();
  const m = s.match(/^([\$€£₹])\1{0,4}$/);
  if (m) {
    return {
      symbol: m[1],
      count: s.length
    };
  }
  return null;
}

function parseRange(val) {
  if (typeof val !== "string") return null;
  const s = val.trim();
  // Match range with dash (hyphen, en-dash \u2013, em-dash \u2014) or "to"
  const rangeRegex = /^[₹$€£\s]*(?:rs\.?|inr)?\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]+)?)\s*(?:[–—\-]|to)\s*[₹$€£\s]*(?:rs\.?|inr)?\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]+)?)\s*([a-zA-Z%]+)?$/i;
  const m = s.match(rangeRegex);
  if (m) {
    const low = parseFloat(m[1].replace(/,/g, ""));
    const high = parseFloat(m[2].replace(/,/g, ""));
    const midpoint = (low + high) / 2;
    const unit = m[3] ? m[3].trim().toLowerCase() : "";
    return { low, high, midpoint, unit };
  }
  return null;
}

function parseSingleNumber(val) {
  if (typeof val === "number" && !isNaN(val)) {
    return { value: val, unit: "" };
  }
  if (typeof val === "string") {
    const s = val.trim();
    if (/^[\$€£₹]+$/.test(s)) return null;

    const currMatch = s.match(/^[₹$€£\s]*(?:rs\.?|inr)?\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]+)?)$/i);
    if (currMatch) {
      return { value: parseFloat(currMatch[1].replace(/,/g, "")), unit: "" };
    }

    const unitMatch = s.match(/^([+-]?(?:\d+(?:,\d+)*(?:\.\d+)?|\.\d+))\s*([a-zA-Z%]+)?$/);
    if (unitMatch) {
      return {
        value: parseFloat(unitMatch[1].replace(/,/g, "")),
        unit: unitMatch[2] ? unitMatch[2].trim().toLowerCase() : ""
      };
    }
  }
  return null;
}

function detectSortKey(val) {
  if (val === null || val === undefined || val === "") {
    return { type: "empty", value: null };
  }

  // 1. Symbol tier (e.g. "$", "$$", "$$$", "$$$$")
  const tier = parseSymbolTier(val);
  if (tier) {
    return { type: "tier", value: tier.count, raw: val };
  }

  // 2. Number / Currency Range (e.g. "₹200–400", "₹90–150")
  const range = parseRange(val);
  if (range) {
    // Sort primarily by lower bound, secondary by upper bound / midpoint
    return {
      type: "numeric",
      value: range.low,
      secondary: range.high,
      midpoint: range.midpoint,
      raw: val
    };
  }

  // 3. Plain Number or Single Quantity with Unit/Currency (e.g. 54990, "₹54,990", "16GB", "18 hrs")
  const single = parseSingleNumber(val);
  if (single) {
    return {
      type: "numeric",
      value: single.value,
      secondary: single.value,
      midpoint: single.value,
      raw: val
    };
  }

  // 4. Plain text fallback (e.g. "Italian", "Casual", "Beginner")
  return {
    type: "text",
    value: String(val).trim(),
    raw: val
  };
}

function compareSortKeys(keyA, keyB, direction) {
  // Empty values always sink to the bottom in both directions
  if (keyA.type === "empty" && keyB.type === "empty") return 0;
  if (keyA.type === "empty") return 1;
  if (keyB.type === "empty") return -1;

  // 1. Both are numeric (including ranges, plain numbers, currency amounts)
  if (keyA.type === "numeric" && keyB.type === "numeric") {
    let diff = keyA.value - keyB.value;
    if (diff === 0 && keyA.secondary !== undefined && keyB.secondary !== undefined) {
      diff = keyA.secondary - keyB.secondary;
    }
    return direction === "asc" ? diff : -diff;
  }

  // 2. Both are symbol tiers (e.g. "$$" vs "$$$$")
  if (keyA.type === "tier" && keyB.type === "tier") {
    const diff = keyA.value - keyB.value;
    return direction === "asc" ? diff : -diff;
  }

  // 3. Both are plain text (e.g. "Italian" vs "Chinese")
  if (keyA.type === "text" && keyB.type === "text") {
    return direction === "asc"
      ? keyA.value.localeCompare(keyB.value, undefined, { numeric: true, sensitivity: "base" })
      : keyB.value.localeCompare(keyA.value, undefined, { numeric: true, sensitivity: "base" });
  }

  // 4. Mixed types within same column
  const typeRank = { numeric: 1, tier: 2, text: 3 };
  const rankA = typeRank[keyA.type] || 99;
  const rankB = typeRank[keyB.type] || 99;
  if (rankA !== rankB) {
    return direction === "asc" ? rankA - rankB : rankB - rankA;
  }

  return 0;
}

function sortRows(rows, col, direction) {
  return [...rows].sort((a, b) => {
    const keyA = detectSortKey(a[col]);
    const keyB = detectSortKey(b[col]);
    return compareSortKeys(keyA, keyB, direction);
  });
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

  // Repeated symbol scale (like "$", "$$", "$$$", "€€")
  if (parseSymbolTier(strVal)) {
    return `<span class="cell-tier" title="Price tier: ${strVal}">${strVal}</span>`;
  }

  // Number / Currency range (like "₹200–400")
  if (parseRange(strVal)) {
    return `<span class="cell-range">${strVal}</span>`;
  }

  // Rating string (e.g. "4.5" or "4.8")
  const colLower = String(col).toLowerCase();
  if ((colLower === "rating" || colLower === "score") && !strVal.includes("★")) {
    return `<span class="cell-rating">★ ${strVal}</span>`;
  }

  return strVal;
}

// =============================================================
// TEST SUITE: Mixed-Type Example & Range Sorting
// =============================================================

// Mixed dataset containing:
// 1. A numeric price column
// 2. A "$$"-style tier column
// 3. A "₹X–Y" range column
// 4. A text column
const mixedDataset = [
  { id: "r1", name: "Venue A", price: 54990, tier: "$$$",  price_range: "₹200–400", cuisine: "Italian" },
  { id: "r2", name: "Venue B", price: 46990, tier: "$",    price_range: "₹90–150",  cuisine: "Cafe" },
  { id: "r3", name: "Venue C", price: 58490, tier: "$$$$", price_range: "₹500–800", cuisine: "Continental" },
  { id: "r4", name: "Venue D", price: 32000, tier: "$$",   price_range: "₹50–80",   cuisine: "Bakery" }
];

console.log("=== TEST 1: Range Column ('₹200–400' vs '₹90–150') ===");
// In plain string comparison:
// "₹200–400".localeCompare("₹90–150") would put "₹200–400" first because '2' < '9'. That is WRONG.
// Type-aware sorting parses 90 and 200, so "₹90–150" must come before "₹200–400".
const sortedByRangeAsc = sortRows(mixedDataset, "price_range", "asc");
console.log("Ascending by price_range:");
sortedByRangeAsc.forEach(r => console.log(`  ${r.name}: ${r.price_range}`));
assert.strictEqual(sortedByRangeAsc[0].id, "r4", "₹50–80 should be first (50)");
assert.strictEqual(sortedByRangeAsc[1].id, "r2", "₹90–150 should be second (90)");
assert.strictEqual(sortedByRangeAsc[2].id, "r1", "₹200–400 should be third (200)");
assert.strictEqual(sortedByRangeAsc[3].id, "r3", "₹500–800 should be fourth (500)");

const sortedByRangeDesc = sortRows(mixedDataset, "price_range", "desc");
console.log("Descending by price_range:");
sortedByRangeDesc.forEach(r => console.log(`  ${r.name}: ${r.price_range}`));
assert.strictEqual(sortedByRangeDesc[0].id, "r3", "₹500–800 should be first");
assert.strictEqual(sortedByRangeDesc[3].id, "r4", "₹50–80 should be last");

console.log("\n=== TEST 2: Tier Column ('$$'-style) ===");
const sortedByTierAsc = sortRows(mixedDataset, "tier", "asc");
console.log("Ascending by tier:");
sortedByTierAsc.forEach(r => console.log(`  ${r.name}: ${r.tier}`));
assert.strictEqual(sortedByTierAsc[0].tier, "$");
assert.strictEqual(sortedByTierAsc[1].tier, "$$");
assert.strictEqual(sortedByTierAsc[2].tier, "$$$");
assert.strictEqual(sortedByTierAsc[3].tier, "$$$$");

const sortedByTierDesc = sortRows(mixedDataset, "tier", "desc");
console.log("Descending by tier:");
sortedByTierDesc.forEach(r => console.log(`  ${r.name}: ${r.tier}`));
assert.strictEqual(sortedByTierDesc[0].tier, "$$$$");
assert.strictEqual(sortedByTierDesc[3].tier, "$");

console.log("\n=== TEST 3: Numeric Price Column ===");
const sortedByPriceAsc = sortRows(mixedDataset, "price", "asc");
console.log("Ascending by numeric price:");
sortedByPriceAsc.forEach(r => console.log(`  ${r.name}: ₹${r.price}`));
assert.strictEqual(sortedByPriceAsc[0].price, 32000);
assert.strictEqual(sortedByPriceAsc[1].price, 46990);
assert.strictEqual(sortedByPriceAsc[2].price, 54990);
assert.strictEqual(sortedByPriceAsc[3].price, 58490);

console.log("\n=== TEST 4: Text Column (Alphabetical) ===");
const sortedByCuisineAsc = sortRows(mixedDataset, "cuisine", "asc");
console.log("Ascending by cuisine text:");
sortedByCuisineAsc.forEach(r => console.log(`  ${r.name}: ${r.cuisine}`));
assert.strictEqual(sortedByCuisineAsc[0].cuisine, "Bakery");
assert.strictEqual(sortedByCuisineAsc[1].cuisine, "Cafe");
assert.strictEqual(sortedByCuisineAsc[2].cuisine, "Continental");
assert.strictEqual(sortedByCuisineAsc[3].cuisine, "Italian");

console.log("\n=== TEST 5: Null / Empty Sinking ===");
const dataWithNulls = [
  { id: "a", val: "₹200–400" },
  { id: "b", val: null },
  { id: "c", val: "₹90–150" },
  { id: "d", val: "" }
];
const sortedNullsAsc = sortRows(dataWithNulls, "val", "asc");
assert.strictEqual(sortedNullsAsc[0].id, "c"); // ₹90–150
assert.strictEqual(sortedNullsAsc[1].id, "a"); // ₹200–400
assert.ok(sortedNullsAsc[2].id === "b" || sortedNullsAsc[2].id === "d");
assert.ok(sortedNullsAsc[3].id === "b" || sortedNullsAsc[3].id === "d");

console.log("\nALL TYPE-AWARE SORTING TESTS PASSED PERFECTLY!");
