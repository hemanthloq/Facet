/**
 * Facet — Frontend Application
 * Built by Pandu for SerpApi India Hackathon 2026 (AI Agents Track)
 * 
 * Works strictly against the project API contract:
 * - POST /search  { query }
 * - POST /refine  { query, rows, instruction }
 * - POST /insight { row }
 */

const API_BASE = "http://localhost:8000";

// Application State
const state = {
  currentQuery: "",
  originalData: null,   // { caption, columns, rows } saved from /search
  currentData: null,    // active table data (may be refined)
  currentSort: { column: null, direction: null }, // 'asc' | 'desc'
  expandedRowId: null,  // currently expanded insight row id
  insightCache: {},     // { [rowId]: { pros, cons, flag, note } }
  isSearching: false,
  isRefining: false,
  progressInterval: null,
  progressStartTime: 0,
};

// DOM Elements
const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const btnClear = document.getElementById("btnClear");
const btnSearch = document.getElementById("btnSearch");
const progressCard = document.getElementById("progressCard");
const progressTitleText = document.getElementById("progressTitleText");
const progressTimer = document.getElementById("progressTimer");
const progressBar = document.getElementById("progressBar");
const pStep1 = document.getElementById("pStep1");
const pStep2 = document.getElementById("pStep2");
const pStep3 = document.getElementById("pStep3");
const pStep4 = document.getElementById("pStep4");

const errorCard = document.getElementById("errorCard");
const errorTitle = document.getElementById("errorTitle");
const errorDesc = document.getElementById("errorDesc");
const btnRetry = document.getElementById("btnRetry");

const emptyCard = document.getElementById("emptyCard");
const emptyDesc = document.getElementById("emptyDesc");

const resultsSection = document.getElementById("resultsSection");
const tableCaption = document.getElementById("tableCaption");
const tableMetaCount = document.getElementById("tableMetaCount");
const refinedBadge = document.getElementById("refinedBadge");
const btnResetRefine = document.getElementById("btnResetRefine");
const tableHeaderRow = document.getElementById("tableHeaderRow");
const tableBody = document.getElementById("tableBody");

const refineForm = document.getElementById("refineForm");
const refineInput = document.getElementById("refineInput");
const btnRefine = document.getElementById("btnRefine");

// Initialize Event Listeners
function init() {
  searchForm.addEventListener("submit", handleSearchSubmit);
  refineForm.addEventListener("submit", handleRefineSubmit);
  btnRetry.addEventListener("click", () => {
    if (state.currentQuery) executeSearch(state.currentQuery);
  });
  btnResetRefine.addEventListener("click", resetToOriginalResults);

  // Search input clear button
  searchInput.addEventListener("input", () => {
    btnClear.style.display = searchInput.value ? "flex" : "none";
  });
  btnClear.addEventListener("click", () => {
    searchInput.value = "";
    btnClear.style.display = "none";
    searchInput.focus();
  });

  // Sample Query Chips
  document.querySelectorAll(".query-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const q = chip.getAttribute("data-query");
      if (q && !state.isSearching) {
        searchInput.value = q;
        btnClear.style.display = "flex";
        executeSearch(q);
      }
    });
  });

  // Refine Suggestion Chips
  document.querySelectorAll(".refine-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const inst = chip.getAttribute("data-instruction");
      if (inst && !state.isRefining && state.currentData) {
        refineInput.value = inst;
        executeRefine(inst);
      }
    });
  });
}

// -------------------------------------------------------------
// Search Pipeline (/search)
// -------------------------------------------------------------

function handleSearchSubmit(e) {
  e.preventDefault();
  const query = searchInput.value.trim();
  if (!query || state.isSearching) return;
  executeSearch(query);
}

async function executeSearch(query) {
  state.currentQuery = query;
  setSearchingState(true);
  hideAllAlerts();

  try {
    const res = await fetch(`${API_BASE}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query })
    });

    const data = await res.json().catch(() => ({ error: "invalid_json" }));

    if (!res.ok) {
      handleApiError(res.status, data);
      return;
    }

    // Success response
    handleSearchSuccess(data);
  } catch (err) {
    console.error("Search network error:", err);
    showError(
      "Connection Failed",
      `Could not connect to backend server at ${API_BASE}. Make sure the FastAPI backend is running via 'uvicorn main:app --reload --port 8000'.`
    );
  } finally {
    setSearchingState(false);
  }
}

function handleSearchSuccess(data) {
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const columns = Array.isArray(data.columns) ? data.columns : [];

  if (rows.length === 0) {
    emptyDesc.textContent = `No comparison items found for "${state.currentQuery}". Try a broader query or another domain (e.g. laptops, restaurants, courses).`;
    emptyCard.style.display = "flex";
    resultsSection.style.display = "none";
    return;
  }

  // Deep clone to ensure original results can always be cleanly restored
  state.originalData = JSON.parse(JSON.stringify(data));
  state.currentData = JSON.parse(JSON.stringify(data));
  state.currentSort = { column: null, direction: null };
  state.expandedRowId = null;
  state.insightCache = {}; // reset cache for new query

  renderComparisonView();
  resultsSection.style.display = "flex";
}

// -------------------------------------------------------------
// Refine Pipeline (/refine)
// -------------------------------------------------------------

function handleRefineSubmit(e) {
  e.preventDefault();
  const instruction = refineInput.value.trim();
  if (!instruction || state.isRefining || !state.currentData) return;
  executeRefine(instruction);
}

async function executeRefine(instruction) {
  setRefiningState(true);
  hideAllAlerts();

  try {
    const res = await fetch(`${API_BASE}/refine`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: state.currentQuery,
        rows: state.currentData.rows,
        instruction
      })
    });

    const data = await res.json().catch(() => ({ error: "invalid_json" }));

    if (!res.ok) {
      handleApiError(res.status, data, "Refinement Failed");
      return;
    }

    handleRefineSuccess(data, instruction);
  } catch (err) {
    console.error("Refine network error:", err);
    showError(
      "Refinement Error",
      "Network connection error while contacting the refinement service. Please try again."
    );
  } finally {
    setRefiningState(false);
  }
}

function handleRefineSuccess(data, instruction) {
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (rows.length === 0) {
    tableCaption.textContent = data.caption || `No items matched "${instruction}".`;
    tableMetaCount.textContent = "0 items matched";
    tableBody.innerHTML = `
      <tr>
        <td colspan="${(state.currentData.columns?.length || 0) + 1}" style="text-align:center; padding: 32px 16px; color: var(--ink-soft);">
          No items match <em>"${escapeHtml(instruction)}"</em> in the current results.
          <br><button type="button" class="btn-secondary" onclick="resetToOriginalResults()" style="margin-top:12px;">Reset to original results</button>
        </td>
      </tr>
    `;
    refinedBadge.style.display = "inline-block";
    btnResetRefine.style.display = "inline-flex";
    return;
  }

  // Update current data while preserving columns
  state.currentData = {
    caption: data.caption || `Refined for "${instruction}"`,
    columns: data.columns && data.columns.length > 0 ? data.columns : state.currentData.columns,
    rows: data.rows
  };

  state.currentSort = { column: null, direction: null };
  state.expandedRowId = null;

  renderComparisonView(true);
}

function resetToOriginalResults() {
  if (!state.originalData) return;
  state.currentData = JSON.parse(JSON.stringify(state.originalData));
  state.currentSort = { column: null, direction: null };
  state.expandedRowId = null;
  refineInput.value = "";
  renderComparisonView(false);
}

// -------------------------------------------------------------
// Insight Pipeline (/insight)
// -------------------------------------------------------------

async function toggleRowInsight(row, parentTr) {
  const rowId = row.id;

  // If already open, close it
  if (state.expandedRowId === rowId) {
    collapseInsightRow(parentTr);
    state.expandedRowId = null;
    return;
  }

  // If another row was open, close it first
  if (state.expandedRowId !== null) {
    const prevOpenTr = document.querySelector(`tr.item-row[data-row-id="${state.expandedRowId}"]`);
    if (prevOpenTr) collapseInsightRow(prevOpenTr);
  }

  // Open this row
  state.expandedRowId = rowId;
  parentTr.classList.add("selected");

  const totalCols = (state.currentData.columns?.length || 0) + 1;
  const subTr = document.createElement("tr");
  subTr.className = "insight-container-row";
  subTr.dataset.forRowId = rowId;
  subTr.innerHTML = `
    <td colspan="${totalCols}">
      <div class="insight-inline-box">
        <div class="insight-card" id="insightCard-${rowId}">
          <div class="insight-card-head">
            <div class="insight-title">What reviewers say — <strong>${escapeHtml(row.name || "Item")}</strong></div>
            <div class="insight-badge">Reviewer Synthesis</div>
          </div>
          <div id="insightContent-${rowId}">
            <div class="insight-loading">
              <div class="spinner"></div>
              <span>Reading what reviewers say...</span>
            </div>
          </div>
        </div>
      </div>
    </td>
  `;

  parentTr.after(subTr);

  // Check cache first (never refetch if already cached)
  if (state.insightCache[rowId]) {
    renderInsightCardContent(rowId, state.insightCache[rowId], row);
    return;
  }

  // Fetch /insight lazily only on click
  try {
    const res = await fetch(`${API_BASE}/insight`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ row })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      renderInsightError(rowId, errData.message || "Failed to load reviewer insight.");
      return;
    }

    const insightData = await res.json();
    state.insightCache[rowId] = insightData;
    renderInsightCardContent(rowId, insightData, row);
  } catch (err) {
    console.error("Insight fetch error:", err);
    renderInsightError(rowId, "Could not contact insight service. Please try again.");
  }
}

function collapseInsightRow(parentTr) {
  parentTr.classList.remove("selected");
  const subTr = parentTr.nextElementSibling;
  if (subTr && subTr.classList.contains("insight-container-row")) {
    subTr.remove();
  }
}

function renderInsightCardContent(rowId, insight, row) {
  const container = document.getElementById(`insightContent-${rowId}`);
  if (!container) return;

  const pros = Array.isArray(insight.pros) ? insight.pros : [];
  const cons = Array.isArray(insight.cons) ? insight.cons : [];
  const flag = insight.flag;
  const note = insight.note;

  if (pros.length === 0 && cons.length === 0 && !flag) {
    container.innerHTML = `
      <div class="insight-empty">
        ${escapeHtml(note || "No review snippet was returned in the search results for this item.")}
      </div>
    `;
    return;
  }

  let html = `<div class="insight-list">`;

  pros.forEach(p => {
    html += `
      <div class="insight-pro">
        <span class="bullet"><strong>+</strong></span>
        <span>${escapeHtml(p)}</span>
      </div>
    `;
  });

  cons.forEach(c => {
    html += `
      <div class="insight-con">
        <span class="bullet"><strong>−</strong></span>
        <span>${escapeHtml(c)}</span>
      </div>
    `;
  });

  if (flag) {
    html += `
      <div class="insight-flag">
        <span>⚠ <strong>Notice:</strong> ${escapeHtml(flag)}</span>
      </div>
    `;
  }

  html += `</div>`;
  container.innerHTML = html;
}

function renderInsightError(rowId, message) {
  const container = document.getElementById(`insightContent-${rowId}`);
  if (!container) return;
  container.innerHTML = `
    <div style="font-size:12.5px; color:#962D22; display:flex; align-items:center; gap:8px;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
}

// -------------------------------------------------------------
// Rendering & Client-Side Sorting
// -------------------------------------------------------------

function renderComparisonView(isRefined = false) {
  const data = state.currentData;
  if (!data) return;

  // Caption and metadata
  tableCaption.textContent = data.caption || `Comparison for "${state.currentQuery}"`;
  const count = data.rows ? data.rows.length : 0;
  tableMetaCount.textContent = `${count} ${count === 1 ? "item" : "items"} compared`;

  if (isRefined) {
    refinedBadge.style.display = "inline-block";
    btnResetRefine.style.display = "inline-flex";
  } else {
    refinedBadge.style.display = "none";
    btnResetRefine.style.display = "none";
  }

  // Render Table Header dynamically from whatever backend columns were returned
  renderTableHeader(data.columns);

  // Render Table Body
  renderTableBody(data.rows, data.columns);
}

function renderTableHeader(columns) {
  tableHeaderRow.innerHTML = "";

  // 1. First column is always Item / Product Name
  const thName = document.createElement("th");
  thName.dataset.col = "name";
  thName.innerHTML = `
    <span>Item</span>
    <span class="sort-arrow" id="sortArrow-name"></span>
  `;
  thName.addEventListener("click", () => handleColumnSort("name"));
  tableHeaderRow.appendChild(thName);

  // 2. Dynamic attribute columns inferred by AI
  (columns || []).forEach(col => {
    const th = document.createElement("th");
    th.dataset.col = col;
    const formattedCol = formatColumnHeader(col);
    th.innerHTML = `
      <span>${escapeHtml(formattedCol)}</span>
      <span class="sort-arrow" id="sortArrow-${escapeHtml(col)}"></span>
    `;
    th.addEventListener("click", () => handleColumnSort(col));
    tableHeaderRow.appendChild(th);
  });

  updateSortHeaderIndicators();
}

function renderTableBody(rows, columns) {
  tableBody.innerHTML = "";

  (rows || []).forEach(row => {
    const tr = document.createElement("tr");
    tr.className = "item-row";
    tr.dataset.rowId = row.id;

    // Item name cell with hint
    const tdName = document.createElement("td");
    tdName.innerHTML = `
      <div class="row-name-wrap">
        <div class="item-name">${escapeHtml(row.name || "Unnamed Item")}</div>
        <div class="insight-hint">
          <span>Review Insight</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </div>
      </div>
    `;
    tr.appendChild(tdName);

    // Attribute cells
    (columns || []).forEach(col => {
      const td = document.createElement("td");
      const val = row[col];
      td.innerHTML = formatCellValue(col, val);
      tr.appendChild(td);
    });

    // Clicking row toggles the insight card
    tr.addEventListener("click", () => toggleRowInsight(row, tr));

    tableBody.appendChild(tr);

    // If this row was previously expanded before a sort/re-render, re-expand it
    if (state.expandedRowId === row.id) {
      tr.classList.add("selected");
      // Re-insert the insight container
      const totalCols = (columns?.length || 0) + 1;
      const subTr = document.createElement("tr");
      subTr.className = "insight-container-row";
      subTr.dataset.forRowId = row.id;
      subTr.innerHTML = `
        <td colspan="${totalCols}">
          <div class="insight-inline-box">
            <div class="insight-card" id="insightCard-${row.id}">
              <div class="insight-card-head">
                <div class="insight-title">What reviewers say — <strong>${escapeHtml(row.name || "Item")}</strong></div>
                <div class="insight-badge">Reviewer Synthesis</div>
              </div>
              <div id="insightContent-${row.id}"></div>
            </div>
          </div>
        </td>
      `;
      tr.after(subTr);
      if (state.insightCache[row.id]) {
        renderInsightCardContent(row.id, state.insightCache[row.id], row);
      }
    }
  });
}

function handleColumnSort(col) {
  if (!state.currentData || !state.currentData.rows) return;

  // Toggle direction or switch column
  let newDir = "asc";
  if (state.currentSort.column === col) {
    newDir = state.currentSort.direction === "asc" ? "desc" : "asc";
  } else {
    // For price or rating, natural default may be desc for rating or asc for price
    newDir = (col === "rating" || col === "battery") ? "desc" : "asc";
  }

  state.currentSort = { column: col, direction: newDir };

  // Sort rows client-side in memory without any new network request
  state.currentData.rows.sort((a, b) => {
    const valA = a[col];
    const valB = b[col];

    // Nulls / empty always sink to the bottom
    if (valA === null || valA === undefined || valA === "") return 1;
    if (valB === null || valB === undefined || valB === "") return -1;

    // Numeric comparison
    const numA = parseSortableNumber(valA);
    const numB = parseSortableNumber(valB);

    if (numA !== null && numB !== null) {
      return newDir === "asc" ? numA - numB : numB - numA;
    }

    // String comparison
    const strA = String(valA).toLowerCase();
    const strB = String(valB).toLowerCase();
    return newDir === "asc" ? strA.localeCompare(strB) : strB.localeCompare(strA);
  });

  updateSortHeaderIndicators();
  renderTableBody(state.currentData.rows, state.currentData.columns);
}

function parseSortableNumber(val) {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    // Clean currency symbols, commas, units
    const cleaned = val.replace(/[₹$,]/g, "").trim();
    const match = cleaned.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))/);
    if (match) return parseFloat(match[1]);
  }
  return null;
}

function updateSortHeaderIndicators() {
  document.querySelectorAll("#tableHeaderRow th").forEach(th => {
    const col = th.dataset.col;
    const arrow = th.querySelector(".sort-arrow");
    if (col === state.currentSort.column) {
      th.classList.add("active");
      if (arrow) arrow.textContent = state.currentSort.direction === "asc" ? "▲" : "▼";
    } else {
      th.classList.remove("active");
      if (arrow) arrow.textContent = "";
    }
  });
}

// -------------------------------------------------------------
// UI State & Progress Timers (handling 11-15s latency)
// -------------------------------------------------------------

function setSearchingState(isSearching) {
  state.isSearching = isSearching;
  btnSearch.disabled = isSearching;
  searchInput.disabled = isSearching;

  if (isSearching) {
    btnSearch.querySelector(".btn-text").textContent = "Comparing...";
    startProgressTimer();
    progressCard.style.display = "flex";
  } else {
    btnSearch.querySelector(".btn-text").textContent = "Compare";
    stopProgressTimer();
    progressCard.style.display = "none";
  }
}

function setRefiningState(isRefining) {
  state.isRefining = isRefining;
  btnRefine.disabled = isRefining;
  refineInput.disabled = isRefining;

  const btnText = btnRefine.querySelector(".refine-btn-text");
  if (isRefining) {
    btnText.textContent = "Refining...";
  } else {
    btnText.textContent = "Refine";
  }
}

function startProgressTimer() {
  state.progressStartTime = Date.now();
  progressTimer.textContent = "00:00s elapsed";
  progressBar.style.width = "10%";
  resetProgressSteps();

  state.progressInterval = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - state.progressStartTime) / 1000);
    const formatted = `00:${String(elapsedSec).padStart(2, "0")}s elapsed`;
    progressTimer.textContent = formatted;

    // Dynamic phase transitions over typical 11-15s latency
    if (elapsedSec < 3) {
      setProgressStep(1, 25, "1. Classifying intent & selecting search engine...");
    } else if (elapsedSec < 7) {
      setProgressStep(2, 50, "2. Fetching live search data via SerpApi...");
    } else if (elapsedSec < 12) {
      setProgressStep(3, 75, "3. AI inferring comparison attributes...");
    } else {
      setProgressStep(4, 90, "4. Structuring comparison table...");
    }
  }, 500);
}

function stopProgressTimer() {
  if (state.progressInterval) {
    clearInterval(state.progressInterval);
    state.progressInterval = null;
  }
}

function resetProgressSteps() {
  [pStep1, pStep2, pStep3, pStep4].forEach(step => {
    step.className = "progress-step";
  });
  pStep1.classList.add("active");
}

function setProgressStep(stepNum, percent, label) {
  progressBar.style.width = `${percent}%`;
  progressTitleText.textContent = label;

  const steps = [pStep1, pStep2, pStep3, pStep4];
  steps.forEach((step, idx) => {
    const cur = idx + 1;
    if (cur < stepNum) {
      step.className = "progress-step done";
    } else if (cur === stepNum) {
      step.className = "progress-step active";
    } else {
      step.className = "progress-step";
    }
  });
}

function hideAllAlerts() {
  errorCard.style.display = "none";
  emptyCard.style.display = "none";
}

function showError(title, message) {
  errorTitle.textContent = title;
  errorDesc.textContent = message;
  errorCard.style.display = "flex";
  resultsSection.style.display = "none";
}

function handleApiError(status, data, defaultTitle = "Search Failed") {
  const errCode = data?.error;
  const msg = data?.message;

  if (status === 422) {
    showError("Invalid Input", "Please enter a valid search query.");
  } else if (errCode === "search_unavailable") {
    showError("Search Provider Unavailable", msg || "The live search provider timed out or didn't respond. Please try again.");
  } else if (errCode === "ai_busy") {
    showError("AI Service Busy", msg || "The AI model is temporarily rate-limited or busy. Please retry shortly.");
  } else if (errCode === "ai_bad_output") {
    showError("AI Output Unreadable", msg || "The AI generated an invalid JSON format. Retrying typically solves this.");
  } else if (errCode === "ai_unavailable") {
    showError("AI Service Unavailable", msg || "The AI service returned an authentication or model error.");
  } else if (status === 500 || errCode === "internal_error") {
    showError("Internal Server Error", msg || "Something went wrong on the server. Please check backend logs.");
  } else {
    showError(defaultTitle, msg || `Request failed with status ${status}.`);
  }
}

// -------------------------------------------------------------
// Formatters & Helpers
// -------------------------------------------------------------

function formatColumnHeader(col) {
  if (!col) return "";
  // Humanize snake_case or camelCase
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

function formatCellValue(col, val) {
  if (val === null || val === undefined || val === "") {
    return `<span class="cell-null">—</span>`;
  }

  const colLower = String(col).toLowerCase();

  // Price formatting
  if (colLower === "price" || colLower.includes("price") || colLower.includes("cost") || colLower.includes("fee")) {
    if (typeof val === "number") {
      return `<span class="cell-price">₹${val.toLocaleString("en-IN")}</span>`;
    }
    const cleanNum = parseFloat(String(val).replace(/[₹$,]/g, ""));
    if (!isNaN(cleanNum)) {
      return `<span class="cell-price">₹${cleanNum.toLocaleString("en-IN")}</span>`;
    }
    return `<span class="cell-price">${escapeHtml(String(val))}</span>`;
  }

  // Rating formatting
  if (colLower === "rating" || colLower.includes("rating") || colLower === "score") {
    return `<span class="cell-rating">★ ${escapeHtml(String(val))}</span>`;
  }

  return escapeHtml(String(val));
}

function escapeHtml(str) {
  if (typeof str !== "string") str = String(str);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Global invocation for inline callbacks if needed
window.resetToOriginalResults = resetToOriginalResults;

// Run on load
document.addEventListener("DOMContentLoaded", init);
