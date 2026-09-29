const assert = require("assert");

function formatColumnHeader(col) {
  if (!col) return "";
  return col
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .map(word => {
      const lower = word.toLowerCase();
      if (lower === "ram") return "RAM";
      if (lower === "cpu") return "CPU";
      if (lower === "gpu") return "GPU";
      if (lower === "id") return "ID";
      if (lower === "anc") return "ANC";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function parseSortableNumber(val) {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const cleaned = val.replace(/[₹$,]/g, "").trim();
    const match = cleaned.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))/);
    if (match) return parseFloat(match[1]);
  }
  return null;
}

function sortRows(rows, col, direction) {
  return [...rows].sort((a, b) => {
    const valA = a[col];
    const valB = b[col];

    if (valA === null || valA === undefined || valA === "") return 1;
    if (valB === null || valB === undefined || valB === "") return -1;

    const numA = parseSortableNumber(valA);
    const numB = parseSortableNumber(valB);

    if (numA !== null && numB !== null) {
      return direction === "asc" ? numA - numB : numB - numA;
    }

    const strA = String(valA).toLowerCase();
    const strB = String(valB).toLowerCase();
    return direction === "asc" ? strA.localeCompare(strB) : strB.localeCompare(strA);
  });
}

// 1. Column header tests
assert.strictEqual(formatColumnHeader("price"), "Price");
assert.strictEqual(formatColumnHeader("battery_life"), "Battery Life");
assert.strictEqual(formatColumnHeader("ram"), "RAM");
assert.strictEqual(formatColumnHeader("reviews_count"), "Reviews Count");

// 2. Numeric parser tests
assert.strictEqual(parseSortableNumber(54990), 54990);
assert.strictEqual(parseSortableNumber("₹54,990"), 54990);
assert.strictEqual(parseSortableNumber("16GB"), 16);
assert.strictEqual(parseSortableNumber("18 hrs"), 18);
assert.strictEqual(parseSortableNumber("4.5 / 5"), 4.5);
assert.strictEqual(parseSortableNumber("N/A"), null);

// 3. Sorting tests
const rows = [
  { id: "r1", name: "Laptop A", price: 54990, battery: "18 hrs", rating: 4.5 },
  { id: "r2", name: "Laptop B", price: 58490, battery: "16 hrs", rating: 4.1 },
  { id: "r3", name: "Laptop C", price: 46990, battery: "14 hrs", rating: null }
];

const sortedByPriceAsc = sortRows(rows, "price", "asc");
assert.strictEqual(sortedByPriceAsc[0].id, "r3");
assert.strictEqual(sortedByPriceAsc[2].id, "r2");

const sortedByPriceDesc = sortRows(rows, "price", "desc");
assert.strictEqual(sortedByPriceDesc[0].id, "r2");
assert.strictEqual(sortedByPriceDesc[2].id, "r3");

const sortedByRatingAsc = sortRows(rows, "rating", "asc");
// Laptop C has null rating, should sink to bottom
assert.strictEqual(sortedByRatingAsc[0].id, "r2");
assert.strictEqual(sortedByRatingAsc[1].id, "r1");
assert.strictEqual(sortedByRatingAsc[2].id, "r3");

const sortedByBatteryDesc = sortRows(rows, "battery", "desc");
assert.strictEqual(sortedByBatteryDesc[0].id, "r1"); // 18 hrs
assert.strictEqual(sortedByBatteryDesc[1].id, "r2"); // 16 hrs
assert.strictEqual(sortedByBatteryDesc[2].id, "r3"); // 14 hrs

console.log("All frontend sorting & formatting unit tests passed!");
