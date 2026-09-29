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
  searchAbortController: null,
  progressInterval: null,
  progressStartTime: 0,
};

// DOM Elements (initialized in browser)
let searchForm, searchInput, btnClear, btnSearch;
let progressCard, progressTitleText, progressTimer, timerText, btnCancelSearch, progressBar, progressDetail, progressSlowNotice;
let pStep1, pStep2, pStep3, pStep4;
let errorCard, errorTitle, errorDesc, btnRetry;
let emptyCard, emptyDesc;
let resultsSection, tableCaption, tableMetaCount, refinedBadge, btnResetRefine, tableHeaderRow, tableBody;
let refineForm, refineInput, btnRefine;

function initDomElements() {
  if (typeof document === "undefined") return;
  searchForm = document.getElementById("searchForm");
  searchInput = document.getElementById("searchInput");
  btnClear = document.getElementById("btnClear");
  btnSearch = document.getElementById("btnSearch");
  progressCard = document.getElementById("progressCard");
  progressTitleText = document.getElementById("progressTitleText");
  progressTimer = document.getElementById("progressTimer");
  timerText = document.getElementById("timerText");
  btnCancelSearch = document.getElementById("btnCancelSearch");
  progressBar = document.getElementById("progressBar");
  progressDetail = document.getElementById("progressDetail");
  progressSlowNotice = document.getElementById("progressSlowNotice");
  pStep1 = document.getElementById("pStep1");
  pStep2 = document.getElementById("pStep2");
  pStep3 = document.getElementById("pStep3");
  pStep4 = document.getElementById("pStep4");

  errorCard = document.getElementById("errorCard");
  errorTitle = document.getElementById("errorTitle");
  errorDesc = document.getElementById("errorDesc");
  btnRetry = document.getElementById("btnRetry");

  emptyCard = document.getElementById("emptyCard");
  emptyDesc = document.getElementById("emptyDesc");

  resultsSection = document.getElementById("resultsSection");
  tableCaption = document.getElementById("tableCaption");
  tableMetaCount = document.getElementById("tableMetaCount");
  refinedBadge = document.getElementById("refinedBadge");
  btnResetRefine = document.getElementById("btnResetRefine");
  tableHeaderRow = document.getElementById("tableHeaderRow");
  tableBody = document.getElementById("tableBody");

  refineForm = document.getElementById("refineForm");
  refineInput = document.getElementById("refineInput");
  btnRefine = document.getElementById("btnRefine");
}

// Initialize Event Listeners
function init() {
  if (typeof document === "undefined") return;
  initDomElements();
  if (!searchForm) return;
  searchForm.addEventListener("submit", handleSearchSubmit);
  refineForm.addEventListener("submit", handleRefineSubmit);
  btnRetry.addEventListener("click", () => {
    if (state.currentQuery) executeSearch(state.currentQuery);
  });
  btnResetRefine.addEventListener("click", resetToOriginalResults);

  // Cancel search button
  if (btnCancelSearch) {
    btnCancelSearch.addEventListener("click", () => {
      if (state.searchAbortController) {
        state.searchAbortController.abort();
      }
      setSearchingState(false);
      showError("Search Cancelled", "The search was cancelled. You can submit another query whenever you're ready.");
    });
  }

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
  state.searchAbortController = new AbortController();
  setSearchingState(true);
  hideAllAlerts();

  try {
    const res = await fetch(`${API_BASE}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query }),
      signal: state.searchAbortController.signal
    });

    const data = await res.json().catch(() => ({ error: "invalid_json" }));

    if (!res.ok) {
      handleApiError(res.status, data);
      return;
    }

    // Success response
    handleSearchSuccess(data);
  } catch (err) {
    if (err.name === "AbortError") {
      console.log("Search request was cancelled by user.");
      return;
    }
    console.error("Search network error:", err);
    showError(
      "Connection Failed",
      `Could not connect to backend server at ${API_BASE}. Make sure the FastAPI backend is running.<br><button type="button" class="btn-secondary" style="margin-top:12px;" onclick="loadDemoQueryData('${escapeHtml(query)}')">Explore with Sample Comparison Data</button>`
    );
  } finally {
    setSearchingState(false);
    state.searchAbortController = null;
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
    console.warn("Refine backend network error, falling back to client-side refinement:", err);
    try {
      const fallbackResult = clientSideRefine(
        state.currentQuery,
        state.currentData.rows,
        instruction,
        state.currentData.columns
      );
      handleRefineSuccess(fallbackResult, instruction);
    } catch (fallbackErr) {
      console.error("Client-side refine error:", fallbackErr);
      showError(
        "Refinement Error",
        "Could not refine results with the provided instruction. Please try a simpler phrase like 'only under 50k' or 'sort by cheapest'."
      );
    }
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
    console.warn("Insight backend network error, falling back to local review analysis:", err);
    if (row.source_snippet) {
      const fallbackInsight = extractFallbackInsight(row.source_snippet);
      state.insightCache[rowId] = fallbackInsight;
      renderInsightCardContent(rowId, fallbackInsight, row);
    } else {
      renderInsightError(rowId, "No review snippet was returned in the search results for this item.");
    }
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

  // 4. Mixed types within same column: numeric ranks before tiers, then text
  const typeRank = { numeric: 1, tier: 2, text: 3 };
  const rankA = typeRank[keyA.type] || 99;
  const rankB = typeRank[keyB.type] || 99;
  if (rankA !== rankB) {
    return direction === "asc" ? rankA - rankB : rankB - rankA;
  }

  return 0;
}

function handleColumnSort(col) {
  if (!state.currentData || !state.currentData.rows) return;

  // Toggle direction or switch column
  let newDir = "asc";
  if (state.currentSort.column === col) {
    newDir = state.currentSort.direction === "asc" ? "desc" : "asc";
  } else {
    // For rating, natural default is desc; for others asc
    newDir = (col === "rating" || col === "score") ? "desc" : "asc";
  }

  state.currentSort = { column: col, direction: newDir };

  // Sort rows client-side in memory with type-aware comparator
  state.currentData.rows.sort((a, b) => {
    const keyA = detectSortKey(a[col]);
    const keyB = detectSortKey(b[col]);
    return compareSortKeys(keyA, keyB, newDir);
  });

  updateSortHeaderIndicators();
  renderTableBody(state.currentData.rows, state.currentData.columns);
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
  if (timerText) timerText.textContent = "00:00 elapsed";
  progressBar.style.width = "10%";
  if (progressSlowNotice) progressSlowNotice.style.display = "none";
  resetProgressSteps();

  state.progressInterval = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - state.progressStartTime) / 1000);
    const mins = Math.floor(elapsedSec / 60);
    const secs = elapsedSec % 60;
    const formatted = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")} elapsed`;
    if (timerText) timerText.textContent = formatted;

    // Smooth asymptotic progress calculation (approaches 97% over 180s without freezing)
    const asymptoticPercent = Math.min(97, 10 + Math.floor(87 * (1 - Math.exp(-elapsedSec / 45))));
    progressBar.style.width = `${asymptoticPercent}%`;

    // Show contextual notice for queries taking longer than 30s
    if (elapsedSec >= 30 && progressSlowNotice) {
      progressSlowNotice.style.display = "flex";
    }

    // Dynamic progressive timeline reflecting backend retries & fallbacks (up to 3 min)
    if (elapsedSec < 6) {
      setProgressStep(1, "1. Classifying intent & selecting search engine...");
      if (progressDetail) progressDetail.textContent = "Analyzing query intent to select Google Shopping or general web search...";
    } else if (elapsedSec < 18) {
      setProgressStep(2, "2. Querying live results via SerpApi...");
      if (progressDetail) progressDetail.textContent = "Connecting to search engines and retrieving fresh product specs & web results...";
    } else if (elapsedSec < 35) {
      setProgressStep(3, "3. AI reasoning: inferring comparison facets...");
      if (progressDetail) progressDetail.textContent = "AI model evaluating results to infer the 3–5 most critical comparison dimensions...";
    } else if (elapsedSec < 60) {
      setProgressStep(4, "4. Extracting grounded values per item...");
      if (progressDetail) progressDetail.textContent = "Extracting verified attributes from raw search snippets and formatting rows...";
    } else if (elapsedSec < 100) {
      setProgressStep(4, "Search Fallback Active: General Engine Engaged...");
      if (progressDetail) progressDetail.textContent = "Initial engine results sparse. Activated general Google search fallback with backoff retry...";
    } else if (elapsedSec < 140) {
      setProgressStep(4, "AI Re-Extracting with Broadened Results...");
      if (progressDetail) progressDetail.textContent = "Processing enriched fallback data with model retry. Ensuring grounded values...";
    } else {
      setProgressStep(4, "Finalizing Comparison Table...");
      if (progressDetail) progressDetail.textContent = "Polishing table facets, ordering rows, and compiling reviewer synthesis. Almost ready!";
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

function setProgressStep(stepNum, label) {
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
  errorDesc.innerHTML = message;
  errorCard.style.display = "flex";
  resultsSection.style.display = "none";
}

function handleApiError(status, data, defaultTitle = "Search Failed") {
  const errCode = data?.error;
  const msg = data?.message;

  if (status === 422) {
    showError("Invalid Input", "Please enter a valid search query.");
  } else if (status === 504 || errCode === "timeout") {
    showError(
      "Search Request Timed Out",
      "The query took over 3 minutes due to upstream search provider or AI rate limits. Please click 'Try Again' — retrying usually connects immediately."
    );
  } else if (errCode === "search_unavailable") {
    showError("Search Provider Unavailable", msg || "The live search provider timed out or didn't respond. Please try again.");
  } else if (errCode === "ai_busy") {
    showError(
      "AI Service Rate-Limited or Busy",
      msg || "The AI reasoning service timed out during fallback attempts or is temporarily rate-limited. Retrying usually succeeds on the next attempt."
    );
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

  // 1. Boolean values
  if (typeof val === "boolean") {
    return val ? `<span class="cell-bool-yes">Yes</span>` : `<span class="cell-bool-no">No</span>`;
  }

  // 2. Numeric values
  if (typeof val === "number") {
    const colLower = String(col).toLowerCase();
    // Only format with currency if the column name specifically represents an actual currency amount (not price_level, etc.)
    if (colLower === "price" || colLower === "price_inr" || colLower === "cost" || colLower === "fee") {
      return `<span class="cell-price">₹${val.toLocaleString("en-IN")}</span>`;
    }
    if (colLower === "rating" || colLower === "score") {
      return `<span class="cell-rating">★ ${val}</span>`;
    }
    return val.toLocaleString();
  }

  // 3. String values (e.g. price_range as "₹200–400", price_level as "$$", cuisine, duration, etc.)
  const strVal = String(val).trim();

  // Repeated symbol scale (like "$", "$$", "$$$", "€€")
  if (parseSymbolTier(strVal)) {
    return `<span class="cell-tier" title="Price tier: ${escapeHtml(strVal)}">${escapeHtml(strVal)}</span>`;
  }

  // Number / Currency range (e.g. "₹200–400", "₹90–150")
  if (parseRange(strVal)) {
    return `<span class="cell-range">${escapeHtml(strVal)}</span>`;
  }

  // Rating string (e.g. "4.5" or "4.8")
  const colLower = String(col).toLowerCase();
  if ((colLower === "rating" || colLower === "score") && !strVal.includes("★")) {
    return `<span class="cell-rating">★ ${escapeHtml(strVal)}</span>`;
  }

  // General text: render generic string as is, without assuming numeric
  return escapeHtml(strVal);
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
if (typeof window !== "undefined") {
  window.resetToOriginalResults = resetToOriginalResults;
  window.loadDemoQueryData = loadDemoQueryData;
  document.addEventListener("DOMContentLoaded", init);
}

// -------------------------------------------------------------
// Standalone Demo Datasets & Offline Fallbacks
// -------------------------------------------------------------

const DEMO_DATASETS = {
  laptop: {
    caption: "Comparing by price, ram, battery and rating.",
    columns: ["price", "ram", "battery", "rating"],
    rows: [
      {
        id: "demo-r1",
        name: "ASUS Vivobook 15",
        price: 54990,
        ram: "16GB",
        battery: "18 hrs",
        rating: 4.5,
        source_snippet: "Praised for build quality and fast charging. Lightweight chassis with crisp display."
      },
      {
        id: "demo-r2",
        name: "Lenovo IdeaPad Slim 5",
        price: 58490,
        ram: "16GB",
        battery: "16 hrs",
        rating: 4.3,
        source_snippet: "Speakers described as tinny at high volume. Multiple reviews mention battery health drops after 8 months."
      },
      {
        id: "demo-r3",
        name: "HP Pavilion 15",
        price: 46990,
        ram: "8GB",
        battery: "14 hrs",
        rating: 4.1,
        source_snippet: "Budget friendly option with decent performance. Reliable keyboard and touchpad for daily work."
      },
      {
        id: "demo-r4",
        name: "Acer Aspire Lite",
        price: 38990,
        ram: "8GB",
        battery: "11 hrs",
        rating: 3.9,
        source_snippet: "Very affordable entry laptop. Plastic build feels cheap according to several buyers."
      }
    ]
  },
  cafe: {
    caption: "Comparing by price_level, price_range, atmosphere, wifi and rating.",
    columns: ["price_level", "price_range", "atmosphere", "wifi", "rating"],
    rows: [
      {
        id: "demo-c1",
        name: "Third Wave Coffee",
        price_level: "$$",
        price_range: "₹200–400",
        atmosphere: "Quiet & Work-friendly",
        wifi: "Fast (100 Mbps)",
        rating: 4.6,
        source_snippet: "Great cold brew and dedicated work desks with power sockets. Peak hours can be crowded."
      },
      {
        id: "demo-c2",
        name: "Blue Tokai Coffee Roasters",
        price_level: "$$$",
        price_range: "₹500–800",
        atmosphere: "Artisan & Vibrant",
        wifi: "Reliable",
        rating: 4.5,
        source_snippet: "Exceptional specialty pour-overs and sourdough toasts. Limited parking on weekends."
      },
      {
        id: "demo-c3",
        name: "Araku Coffee",
        price_level: "$$$$",
        price_range: "₹800–1500",
        atmosphere: "Luxury & Serene",
        wifi: "High Speed",
        rating: 4.7,
        source_snippet: "Stunning architecture and award-winning single-origin brews. Premium price point."
      },
      {
        id: "demo-c4",
        name: "Corner Cafe & Bakery",
        price_level: "$",
        price_range: "₹90–150",
        atmosphere: "Bustling & Cozy",
        wifi: "Basic",
        rating: 4.2,
        source_snippet: "Pocket friendly tea and fresh puffs. Quick service but limited seating."
      }
    ]
  },
  course: {
    caption: "Comparing by duration, level, certificate, price and rating.",
    columns: ["duration", "level", "certificate", "price", "rating"],
    rows: [
      {
        id: "demo-e1",
        name: "Complete Python Bootcamp",
        duration: "22 hrs",
        level: "Beginner",
        certificate: "Yes",
        price: 499,
        rating: 4.6,
        source_snippet: "Hands-on coding exercises and clear explanations for total newcomers."
      },
      {
        id: "demo-e2",
        name: "Python for Data Science (IBM)",
        duration: "18 hrs",
        level: "Beginner",
        certificate: "Verified",
        price: "Free to Audit",
        rating: 4.7,
        source_snippet: "Industry recognized certification with Jupyter notebook labs. Peer reviews take time."
      },
      {
        id: "demo-e3",
        name: "Applied Machine Learning in Python",
        duration: "34 hrs",
        level: "Intermediate",
        certificate: "Yes",
        price: 3499,
        rating: 4.5,
        source_snippet: "In-depth scikit-learn coverage. Steep learning curve for complete beginners."
      }
    ]
  }
};

function loadDemoQueryData(query) {
  hideAllAlerts();
  const qLower = (query || "").toLowerCase();
  let demo = DEMO_DATASETS.laptop;
  if (qLower.includes("cafe") || qLower.includes("coffee") || qLower.includes("restaurant") || qLower.includes("food")) {
    demo = DEMO_DATASETS.cafe;
  } else if (qLower.includes("python") || qLower.includes("course") || qLower.includes("data science")) {
    demo = DEMO_DATASETS.course;
  }
  state.currentQuery = query || "best laptops under 60k with good battery";
  if (searchInput) searchInput.value = state.currentQuery;
  handleSearchSuccess(demo);
}

function clientSideRefine(query, rows, instruction, columns) {
  if (!rows || rows.length === 0) {
    return { caption: "No items to refine", columns: columns || [], rows: [] };
  }

  const instructionLower = (instruction || "").toLowerCase().trim();
  let kept = [...rows];
  const captionParts = [];

  // Filter: under / below / less than
  const underMatch = instructionLower.match(/(?:under|below|less than|max|at most|<|<=)\s*(?:rs\.?|inr|₹|\$)?\s*([0-9]+(?:\.[0-9]+)?)\s*(k|lakh|lac|m)?/i);
  if (underMatch) {
    let val = parseFloat(underMatch[1]);
    const unit = (underMatch[2] || "").toLowerCase();
    if (unit === "k") val *= 1000;
    else if (unit === "lakh" || unit === "lac") val *= 100000;
    else if (unit === "m") val *= 1000000;

    const filtered = kept.filter(r => {
      for (const [k, v] of Object.entries(r)) {
        if (k === "id" || k === "source_snippet") continue;
        const parsed = parseSingleNumber(v) || parseRange(v);
        if (parsed) {
          const num = parsed.value !== undefined ? parsed.value : parsed.low;
          if (k.toLowerCase().includes("price") || k.toLowerCase().includes("cost")) {
            return num <= val;
          }
        }
      }
      if (r.price !== undefined && r.price !== null) {
        const numP = parseFloat(String(r.price).replace(/,/g, "").replace(/[₹$€£]/g, "").trim());
        if (!isNaN(numP)) return numP <= val;
      }
      return true;
    });

    if (filtered.length > 0) {
      kept = filtered;
      captionParts.push(`under ₹${val.toLocaleString()}`);
    }
  }

  // Filter: over / above / greater than
  const overMatch = instructionLower.match(/(?:over|above|greater than|min|at least|>|>=)\s*(?:rs\.?|inr|₹|\$)?\s*([0-9]+(?:\.[0-9]+)?)\s*(k|lakh|lac|m)?/i);
  if (overMatch) {
    let val = parseFloat(overMatch[1]);
    const unit = (overMatch[2] || "").toLowerCase();
    if (unit === "k") val *= 1000;
    else if (unit === "lakh" || unit === "lac") val *= 100000;
    else if (unit === "m") val *= 1000000;

    const filtered = kept.filter(r => {
      for (const [k, v] of Object.entries(r)) {
        if (k === "id" || k === "source_snippet") continue;
        const parsed = parseSingleNumber(v) || parseRange(v);
        if (parsed) {
          const num = parsed.value !== undefined ? parsed.value : parsed.low;
          if (k.toLowerCase().includes("price") || k.toLowerCase().includes("cost")) {
            return num >= val;
          }
        }
      }
      if (r.price !== undefined && r.price !== null) {
        const numP = parseFloat(String(r.price).replace(/,/g, "").replace(/[₹$€£]/g, "").trim());
        if (!isNaN(numP)) return numP >= val;
      }
      return true;
    });

    if (filtered.length > 0) {
      kept = filtered;
      captionParts.push(`over ₹${val.toLocaleString()}`);
    }
  }

  // Filter: Symbol tier (e.g. "$$", "under $$")
  const tierMatch = instructionLower.match(/(?:under|below|less than|only|show)?\s*(\${1,4})/);
  if (tierMatch) {
    const targetTier = tierMatch[1];
    const maxSymbols = targetTier.length;
    const filtered = kept.filter(r => {
      for (const [k, v] of Object.entries(r)) {
        const tier = parseSymbolTier(v);
        if (tier) return tier.count <= maxSymbols;
      }
      return true;
    });
    if (filtered.length > 0) {
      kept = filtered;
      captionParts.push(`price level ${targetTier} or less`);
    }
  }

  // Filter: Exclude
  const excludeMatch = instructionLower.match(/(?:exclude|without|no|remove)\s+(.+)/i);
  if (excludeMatch) {
    const target = excludeMatch[1].trim().toLowerCase();
    const filtered = kept.filter(r => {
      const name = String(r.name || "").toLowerCase();
      return !name.includes(target);
    });
    if (filtered.length > 0) {
      kept = filtered;
      captionParts.push(`excluding "${target}"`);
    }
  }

  // Sorting
  if (instructionLower.includes("cheapest") || instructionLower.includes("lowest price") || instructionLower.includes("price low")) {
    kept.sort((a, b) => {
      const aVal = (detectSortKey(a.price || a.price_range || a.cost).value) ?? Infinity;
      const bVal = (detectSortKey(b.price || b.price_range || b.cost).value) ?? Infinity;
      return aVal - bVal;
    });
    captionParts.push("sorted by price: low to high");
  } else if (instructionLower.includes("highest price") || instructionLower.includes("most expensive")) {
    kept.sort((a, b) => {
      const aVal = (detectSortKey(a.price || a.price_range || a.cost).value) ?? -Infinity;
      const bVal = (detectSortKey(b.price || b.price_range || b.cost).value) ?? -Infinity;
      return bVal - aVal;
    });
    captionParts.push("sorted by price: high to low");
  } else if (instructionLower.includes("rating") || instructionLower.includes("top rated") || instructionLower.includes("best rated")) {
    kept.sort((a, b) => {
      const aVal = (detectSortKey(a.rating).value) ?? -Infinity;
      const bVal = (detectSortKey(b.rating).value) ?? -Infinity;
      return bVal - aVal;
    });
    captionParts.push("sorted by rating");
  }

  // Keyword filter if no numeric filters matched
  if (!underMatch && !overMatch && !tierMatch && !excludeMatch && kept.length === rows.length) {
    const stopWords = new Set(["show", "only", "the", "with", "for", "me", "find", "all", "sort", "by", "items", "where"]);
    const words = (instructionLower.match(/[a-z0-9]+/g) || []).filter(w => !stopWords.has(w));
    if (words.length > 0) {
      const matching = kept.filter(r => {
        const text = (String(r.name || "") + " " + Object.values(r).join(" ")).toLowerCase();
        return words.some(w => text.includes(w));
      });
      if (matching.length > 0) {
        kept = matching;
        captionParts.push(`matching "${instruction}"`);
      }
    }
  }

  const caption = captionParts.length > 0
    ? `Refined to items ${captionParts.join(", ")} (${kept.length} ${kept.length === 1 ? "item" : "items"}).`
    : `Refined results for "${instruction}" (${kept.length} ${kept.length === 1 ? "item" : "items"}).`;

  return {
    caption,
    columns: columns || Object.keys(rows[0] || {}).filter(k => k !== "id" && k !== "name" && k !== "source_snippet"),
    rows: kept
  };
}

function extractFallbackInsight(snippet) {
  if (!snippet) {
    return { pros: [], cons: [], flag: null, note: "No review snippet was returned in the search results for this item." };
  }
  const sentences = snippet.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
  const pros = [];
  const cons = [];
  let flag = null;

  sentences.forEach(s => {
    const sLower = s.toLowerCase();
    if (sLower.includes("drops") || sLower.includes("degrade") || sLower.includes("health drops") || sLower.includes("warning") || sLower.includes("caution")) {
      flag = s;
    } else if (sLower.includes("tinny") || sLower.includes("cheap") || sLower.includes("poor") || sLower.includes("bad") || sLower.includes("limited") || sLower.includes("steep") || sLower.includes("slow")) {
      if (cons.length < 2) cons.push(s);
    } else if (sLower.includes("praised") || sLower.includes("great") || sLower.includes("fast") || sLower.includes("exceptional") || sLower.includes("good") || sLower.includes("stunning") || sLower.includes("reliable")) {
      if (pros.length < 2) pros.push(s);
    }
  });

  if (pros.length === 0 && cons.length === 0 && !flag) {
    pros.push(sentences[0] || snippet);
  }

  return { pros, cons, flag };
}

// Export for Node unit tests
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseSymbolTier,
    parseRange,
    parseSingleNumber,
    detectSortKey,
    compareSortKeys,
    clientSideRefine,
    extractFallbackInsight,
    DEMO_DATASETS
  };
}
