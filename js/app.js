/* ============================================================
 * ESportsBattle Rank — public leaderboard
 * Single-file vanilla JS app. No build step, no dependencies.
 * ============================================================ */
"use strict";

/* ================== CONFIG ================== */
const CONFIG = Object.freeze({
  DATA_URL:
    "https://script.google.com/macros/s/AKfycbxkLrAorAf8PMAB3Wu9vBv7DIcjj9tj6W4KrnuEVYMvrV563bWQ0clgsultApJnEOy0/exec",
  RATING_DIGITS: 1,
  DELTA_DIGITS: 1,
  CHART_ANIM_MS: 600,
});

const SUPABASE = Object.freeze({
  URL: "https://vgmwxtpsbwzeqwtpxamo.supabase.co",
  KEY: "sb_publishable_RjvZCtsriMO6nGDASJkcbg_estuVZyq",
});

/* Static rating groups (admin removed — values fixed in code). */
const GROUPS = Object.freeze([
  { name: "Legend",       min: 1250, color: "#e53a2e" },
  { name: "Icon",         min: 1125, color: "#dab823" },
  { name: "Elite",        min: 1000, color: "#f0ff25" },
  { name: "Champion",     min:  875, color: "#20b839" },
  { name: "World Class",  min:  750, color: "#b8b8b8" },
  { name: "Professional", min:    0, color: "#7ec8ce" },
]);

/* Manual nick → file overrides for cases where image filename
 * differs from the player nickname returned by the API.
 * If a nick is not listed, we fall back to `img/<nick>.png`. */
const AVATAR_OVERRIDES = Object.freeze({
  Lelool_Pepsi: "img/Leolol_Pepsi.png",
  KaBuA:        "img/KaLuBa.png",
  Christian05:  "img/Hristian05.png",
  Onko:         "img/Qnko.png",
  maggetto:     "img/maggett0.png",
});

/* ================== DOM REFS ================== */
const $ = (id) => document.getElementById(id);

const els = {
  tbody:         document.querySelector("#leaderboard tbody"),
  search:        $("search"),
  refresh:       $("refresh"),

  profileTitle:  $("profileTitle"),
  currentRating: $("currentRating"),
  deltaPeriod:   $("delta7"),
  delta1:        $("delta1"),
  pointsCount:   $("pointsCount"),
  deltaHeader:   $("deltaHeader"),
  deltaLabel:    $("deltaLabel"),

  history:       $("history"),
  chart:         $("chart"),
  chartTip:      $("chartTip"),
  periodButtons: document.querySelectorAll("#periodSwitch button"),

  playerPhoto:   $("playerPhoto"),
  photoNick:     $("photoNick"),
  groupDot:      $("groupDot"),
  groupName:     $("groupName"),
};

/* ================== STATE ================== */
const state = {
  players: [],
  hiddenNicks: new Set(),
  selected: null,
  periodDays: 7,
  globalRows: [],
  globalRankByNick: new Map(),
  chartRAF: 0,
  chartAnimating: false,
  chartSeries: [],
  chartDims: null,
  chartHoverIdx: null,
};

/* ================== INIT ================== */
init();

async function init() {
  els.refresh?.addEventListener("click", loadData);
  els.search?.addEventListener("input", debounce(onSearch, 120));

  els.periodButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      els.periodButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.periodDays = Number(btn.dataset.days);
      updateDeltaLabels();
      renderTable();
      if (state.selected) {
        const p = state.players.find((x) => x.nick === state.selected.nick);
        if (p) selectPlayer(p);
      }
    });
  });

  // Resize → redraw chart without re-animating
  window.addEventListener("resize", debounce(() => {
    if (!state.chartSeries?.length) return;
    state.chartDims = computeChartDims(state.chartSeries);
    drawChartFrame(state.chartSeries, state.chartDims, {
      progress: 1,
      hoverIdx: state.chartHoverIdx ?? undefined,
    });
  }, 150));

  setupChartHover();

  updateDeltaLabels();
  await loadData();
  handleDeepLink();
}

/* ================== LOAD ================== */
async function loadData() {
  setLoading(true);
  try {
    const data = await loadJSONP(CONFIG.DATA_URL);

    try {
      const res = await fetch(
        `${SUPABASE.URL}/rest/v1/hidden_players?select=nick`,
        { headers: { apikey: SUPABASE.KEY, Authorization: `Bearer ${SUPABASE.KEY}` } }
      );
      const rows = await res.json();
      state.hiddenNicks = new Set(Array.isArray(rows) ? rows.map((r) => r.nick) : []);
    } catch {
      state.hiddenNicks = new Set();
    }

    state.players = (data?.players ?? []).map((p) => ({
      nick: String(p.nick),
      series: (p.series ?? [])
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date)),
    }));
    buildGlobalRanking();
    renderTable();
    autoSelectTop();
  } catch (err) {
    console.error("Data load failed:", err);
    if (els.tbody) {
      els.tbody.innerHTML = `<tr><td colspan="5" style="opacity:.7;padding:14px;">Failed to load data. Try Refresh.</td></tr>`;
    }
  } finally {
    setLoading(false);
  }
}

function setLoading(isLoading) {
  if (!els.refresh) return;
  els.refresh.disabled = isLoading;
  els.refresh.textContent = isLoading ? "Loading…" : "Refresh";
}

/* ================== JSONP ================== */
function loadJSONP(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const cbName = `__rank_cb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const script = document.createElement("script");
    let timer = 0;

    const cleanup = () => {
      try { delete window[cbName]; } catch { window[cbName] = undefined; }
      script.remove();
      if (timer) clearTimeout(timer);
    };

    window[cbName] = (data) => { cleanup(); resolve(data); };
    script.src = `${url}?callback=${cbName}&t=${Date.now()}`;
    script.async = true;
    script.onerror = () => { cleanup(); reject(new Error("JSONP load failed")); };

    timer = setTimeout(() => { cleanup(); reject(new Error("JSONP timeout")); }, timeoutMs);
    document.body.appendChild(script);
  });
}

/* ================== GROUPS ================== */
function getGroupByRating(rating) {
  const r = Number(rating);
  if (!Number.isFinite(r)) return GROUPS.at(-1);
  if (r < 0) return GROUPS.at(-1);
  return GROUPS.find((g) => r >= g.min) ?? GROUPS.at(-1);
}

/* ================== RANKING ================== */
function buildGlobalRanking() {
  state.globalRows = state.players
    .filter((p) => !state.hiddenNicks.has(p.nick))
    .map((p) => ({
      ...p,
      rating: p.series.at(-1)?.rating ?? null,
      deltaPeriod: calcDelta(p.series, state.periodDays),
      delta1: calcDelta(p.series, 1),
    }))
    .sort((a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity));

  state.globalRankByNick = new Map(
    state.globalRows.map((p, idx) => [p.nick, idx + 1])
  );
}

/* ================== TABLE ================== */
function renderTable() {
  if (!els.tbody) return;
  buildGlobalRanking();

  const q = (els.search?.value ?? "").toLowerCase().trim();
  const filtered = q
    ? state.globalRows.filter((p) => p.nick.toLowerCase().includes(q))
    : state.globalRows;

  const frag = document.createDocumentFragment();

  if (!filtered.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" style="opacity:.7;padding:14px;">No players found.</td>`;
    frag.appendChild(tr);
  } else {
    for (const p of filtered) {
      const tr = document.createElement("tr");
      const rank = state.globalRankByNick.get(p.nick) ?? null;

      if (rank === 1) tr.classList.add("rank-1");
      else if (rank === 2) tr.classList.add("rank-2");
      else if (rank === 3) tr.classList.add("rank-3");

      if (state.selected?.nick === p.nick) tr.classList.add("active");

      tr.innerHTML = `
        <td>${rank ?? "—"}</td>
        <td>${escapeHtml(p.nick)}</td>
        <td class="right">${fmt(p.rating, CONFIG.RATING_DIGITS)}</td>
        <td class="right ${deltaClass(p.deltaPeriod)}">${formatDelta(p.deltaPeriod, CONFIG.DELTA_DIGITS)}</td>
        <td class="right ${deltaClass(p.delta1)}">${formatDelta(p.delta1, CONFIG.DELTA_DIGITS)}</td>
      `;
      tr.addEventListener("click", () => selectPlayer(p));
      frag.appendChild(tr);
    }
  }

  els.tbody.replaceChildren(frag);
}

/* ================== SELECT PLAYER ================== */
function selectPlayer(p) {
  state.selected = p;
  updateURL(p.nick);

  // mark active row
  els.tbody?.querySelectorAll("tr.active").forEach((r) => r.classList.remove("active"));
  const rows = els.tbody?.querySelectorAll("tr") ?? [];
  for (const tr of rows) {
    const nickCell = tr.children[1];
    if (nickCell && nickCell.textContent === p.nick) {
      tr.classList.add("active");
      break;
    }
  }

  if (els.profileTitle) els.profileTitle.textContent = `Player: ${p.nick}`;

  const lastRating = p.series.at(-1)?.rating ?? null;
  if (els.currentRating) els.currentRating.textContent = fmt(lastRating, CONFIG.RATING_DIGITS);
  if (els.deltaPeriod) els.deltaPeriod.textContent = formatDelta(calcDelta(p.series, state.periodDays), CONFIG.DELTA_DIGITS);
  if (els.delta1)      els.delta1.textContent      = formatDelta(calcDelta(p.series, 1),               CONFIG.DELTA_DIGITS);
  if (els.pointsCount) els.pointsCount.textContent = String(p.series.length);

  setPlayerPhoto(p.nick);
  setPlayerGroup(lastRating);

  const seriesWindow = sliceByDays(p.series, state.periodDays);
  renderHistory(seriesWindow);
  drawChartAnimated(seriesWindow);
}

/* ================== PHOTO + GROUP ================== */
function setPlayerPhoto(nick) {
  if (!els.playerPhoto) return;
  const url = avatarUrlForNick(nick);
  els.playerPhoto.src = url;
  els.playerPhoto.alt = `Photo of ${nick}`;
  els.playerPhoto.onerror = () => {
    els.playerPhoto.onerror = null;
    els.playerPhoto.src = avatarUrlFallback(nick);
  };
  if (els.photoNick) els.photoNick.textContent = nick;
}

function setPlayerGroup(rating) {
  const g = getGroupByRating(rating);
  if (els.groupName) els.groupName.textContent = g.name;
  if (els.groupDot) {
    els.groupDot.style.background = g.color;
    els.groupDot.style.boxShadow = `0 0 12px ${g.color}55`;
  }
}

function avatarUrlForNick(nick) {
  return AVATAR_OVERRIDES[nick] ?? `img/${encodeURIComponent(nick)}.png`;
}

function avatarUrlFallback(nick) {
  const safe = encodeURIComponent(nick);
  return `https://ui-avatars.com/api/?name=${safe}&background=0b1f17&color=35c07a&size=512&bold=true&format=png`;
}

/* ================== HISTORY ================== */
function renderHistory(series) {
  if (!els.history) return;
  els.history.innerHTML = "";
  if (!series.length) return;

  const frag = document.createDocumentFragment();
  const reversed = series.slice().reverse();

  reversed.forEach((p, i) => {
    const prev = reversed[i + 1]?.rating;
    const delta = prev != null ? p.rating - prev : null;

    const li = document.createElement("li");
    const cls = delta == null ? "" : deltaClass(delta);
    li.innerHTML = `
      <span>${escapeHtml(p.date)}</span>
      <span>${fmt(p.rating, CONFIG.RATING_DIGITS)}${
        delta != null
          ? ` <span class="${cls}">(${formatDelta(delta, CONFIG.DELTA_DIGITS)})</span>`
          : ""
      }</span>
    `;
    frag.appendChild(li);
  });

  els.history.appendChild(frag);
}

/* ================== CHART ================== */
function computeChartDims(series) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.max(1, els.chart.clientWidth);
  const H = Math.max(1, els.chart.clientHeight);

  if (els.chart.width !== Math.round(W * dpr) || els.chart.height !== Math.round(H * dpr)) {
    els.chart.width = Math.round(W * dpr);
    els.chart.height = Math.round(H * dpr);
  }

  const pad = { l: 48, r: 20, t: 20, b: 28 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const values = series.map((s) => s.rating);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const range = max - min || 1;
  const n = series.length;

  const xAt = (i) => pad.l + (i / Math.max(1, n - 1)) * innerW;
  const yAt = (v) => pad.t + (1 - (v - min) / range) * innerH;

  return { W, H, dpr, pad, innerW, innerH, min, max, range, n, xAt, yAt };
}

function drawChartFrame(series, dims, opts = {}) {
  if (!els.chart) return;
  const { W, H, dpr, pad, min, max, range, n, xAt, yAt } = dims;
  const progress = opts.progress != null ? opts.progress : 1;
  const hoverIdx = opts.hoverIdx != null ? opts.hoverIdx : null;

  const ctx = els.chart.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!n) return;

  // Gridlines + Y-axis labels
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "rgba(255,255,255,0.42)";
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const STEPS = 4;
  for (let i = 0; i <= STEPS; i++) {
    const ratio = i / STEPS;
    const y = pad.t + ratio * (H - pad.t - pad.b);
    const v = max - ratio * range;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(W - pad.r, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(0), pad.l - 6, y);
  }

  // Animated portion
  const maxIndex = Math.max(0, Math.floor((n - 1) * progress));
  const partial = (n - 1) * progress - maxIndex;
  const lastX = (maxIndex < n - 1 && partial > 0)
    ? xAt(maxIndex) + (xAt(maxIndex + 1) - xAt(maxIndex)) * partial
    : xAt(maxIndex);
  const lastY = (maxIndex < n - 1 && partial > 0)
    ? yAt(series[maxIndex].rating) + (yAt(series[maxIndex + 1].rating) - yAt(series[maxIndex].rating)) * partial
    : yAt(series[maxIndex].rating);

  // Filled area under curve
  ctx.beginPath();
  ctx.moveTo(xAt(0), H - pad.b);
  for (let i = 0; i <= maxIndex; i++) ctx.lineTo(xAt(i), yAt(series[i].rating));
  ctx.lineTo(lastX, lastY);
  ctx.lineTo(lastX, H - pad.b);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
  grad.addColorStop(0, "rgba(53,192,122,0.32)");
  grad.addColorStop(1, "rgba(53,192,122,0.00)");
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = "#35c07a";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (let i = 0; i <= maxIndex; i++) {
    const x = xAt(i), y = yAt(series[i].rating);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  if (maxIndex < n - 1 && partial > 0) ctx.lineTo(lastX, lastY);
  ctx.stroke();

  // Data point dots (only after animation completes)
  if (progress >= 1) {
    for (let i = 0; i < n; i++) {
      const x = xAt(i), y = yAt(series[i].rating);
      ctx.fillStyle = "#35c07a";
      ctx.beginPath();
      ctx.arc(x, y, i === n - 1 ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fill();
      if (i === n - 1) {
        ctx.strokeStyle = "rgba(11,15,20,1)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  // Hover marker
  if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < n) {
    const hx = xAt(hoverIdx), hy = yAt(series[hoverIdx].rating);

    // Vertical guide line
    ctx.strokeStyle = "rgba(53,192,122,0.45)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(hx, pad.t);
    ctx.lineTo(hx, H - pad.b);
    ctx.stroke();
    ctx.setLineDash([]);

    // Halo
    ctx.fillStyle = "rgba(53,192,122,0.25)";
    ctx.beginPath();
    ctx.arc(hx, hy, 11, 0, Math.PI * 2);
    ctx.fill();

    // Marker
    ctx.fillStyle = "#35c07a";
    ctx.beginPath();
    ctx.arc(hx, hy, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawChartAnimated(series) {
  if (!els.chart) return;
  cancelAnimationFrame(state.chartRAF);
  hideChartTip();

  state.chartSeries = series;
  state.chartDims = computeChartDims(series);
  state.chartHoverIdx = null;

  if (!series.length) {
    drawChartFrame(series, state.chartDims, { progress: 1 });
    state.chartAnimating = false;
    return;
  }

  state.chartAnimating = true;
  const start = performance.now();

  const tick = (now) => {
    const t = Math.min(1, (now - start) / CONFIG.CHART_ANIM_MS);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
    drawChartFrame(state.chartSeries, state.chartDims, { progress: eased });
    if (t < 1) {
      state.chartRAF = requestAnimationFrame(tick);
    } else {
      state.chartAnimating = false;
    }
  };
  state.chartRAF = requestAnimationFrame(tick);
}

/* ----- hover ----- */
function setupChartHover() {
  if (!els.chart) return;
  els.chart.addEventListener("mousemove", onChartMove);
  els.chart.addEventListener("mouseleave", onChartLeave);
  els.chart.addEventListener("touchstart", onChartTouch, { passive: true });
  els.chart.addEventListener("touchmove",  onChartTouch, { passive: true });
  els.chart.addEventListener("touchend",   onChartLeave);
}

function pickNearestIdx(clientX) {
  const series = state.chartSeries;
  const dims = state.chartDims;
  if (!series?.length || !dims) return null;

  const rect = els.chart.getBoundingClientRect();
  const x = clientX - rect.left;

  let nearest = 0;
  let minDist = Infinity;
  for (let i = 0; i < series.length; i++) {
    const d = Math.abs(dims.xAt(i) - x);
    if (d < minDist) { minDist = d; nearest = i; }
  }
  // Don't show if pointer is far outside the plot area
  return minDist > Math.max(40, dims.innerW / Math.max(1, series.length - 1)) ? null : nearest;
}

function onChartMove(e) {
  if (state.chartAnimating) return;
  const idx = pickNearestIdx(e.clientX);
  applyChartHover(idx);
}

function onChartTouch(e) {
  if (state.chartAnimating) return;
  const t = e.touches?.[0];
  if (!t) return;
  const idx = pickNearestIdx(t.clientX);
  applyChartHover(idx);
}

function onChartLeave() {
  applyChartHover(null);
}

function applyChartHover(idx) {
  const series = state.chartSeries;
  const dims = state.chartDims;
  if (!series?.length || !dims) return;

  if (idx === state.chartHoverIdx) return;
  state.chartHoverIdx = idx;

  drawChartFrame(series, dims, { progress: 1, hoverIdx: idx ?? undefined });

  if (idx == null) { hideChartTip(); return; }

  const point = series[idx];
  const px = dims.xAt(idx);
  const py = dims.yAt(point.rating);

  if (els.chartTip) {
    els.chartTip.innerHTML =
      `<strong>${fmt(point.rating, CONFIG.RATING_DIGITS)}</strong>` +
      `<span>${escapeHtml(point.date)}</span>`;
    // Position relative to .chartWrap (canvas has padding inside wrap = 8px)
    const offset = 8; // matches .chartWrap padding
    els.chartTip.style.left = (px + offset) + "px";
    els.chartTip.style.top  = (py + offset) + "px";
    els.chartTip.hidden = false;
  }
}

function hideChartTip() {
  if (els.chartTip) els.chartTip.hidden = true;
}

/* ================== HELPERS ================== */
function sliceByDays(series, days) {
  if (!series.length) return [];
  const last = series.at(-1);
  const lastDate = new Date(last.date);
  const from = new Date(lastDate);
  from.setDate(from.getDate() - days);
  return series.filter((p) => new Date(p.date) >= from);
}

function calcDelta(series, days) {
  if (!series.length) return null;
  const last = series.at(-1);
  const lastDate = new Date(last.date);
  const target = new Date(lastDate);
  target.setDate(target.getDate() - days);

  let base = series[0];
  for (const p of series) if (new Date(p.date) <= target) base = p;
  return last.rating - base.rating;
}

function fmt(num, digits = 1) {
  if (num == null || Number.isNaN(num)) return "—";
  return Number(num).toFixed(digits);
}

function formatDelta(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return "—";
  const n = Number(v);
  const s = n.toFixed(digits);
  return n > 0 ? `+${s}` : s;
}

function deltaClass(v) {
  if (v == null || Number.isNaN(v)) return "";
  if (v > 0) return "delta-pos";
  if (v < 0) return "delta-neg";
  return "delta-zero";
}

function updateDeltaLabels() {
  if (els.deltaHeader) els.deltaHeader.textContent = `Δ ${state.periodDays}d`;
  if (els.deltaLabel)  els.deltaLabel.textContent  = `Change (${state.periodDays} days)`;
}

function onSearch() {
  renderTable();
  const first = els.tbody?.querySelector("tr");
  if (first && first.children.length > 1) first.click();
}

function autoSelectTop() {
  if (!state.globalRows.length) return;
  selectPlayer(state.globalRows[0]);
}

function updateURL(nick) {
  const url = new URL(window.location.href);
  url.searchParams.set("player", nick);
  history.replaceState(null, "", url.toString());
}

function handleDeepLink() {
  const nick = new URLSearchParams(window.location.search).get("player");
  if (!nick) return;
  const p = state.players.find((x) => x.nick === nick);
  if (p) selectPlayer(p);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function debounce(fn, ms) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
