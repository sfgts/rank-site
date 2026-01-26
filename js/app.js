// ================== CONFIG ==================
const DATA_URL = "https://script.google.com/macros/s/AKfycbxkLrAorAf8PMAB3Wu9vBv7DIcjj9tj6W4KrnuEVYMvrV563bWQ0clgsultApJnEOy0/exec";

const RATING_DIGITS = 1;
const DELTA_DIGITS = 1;

// (ФОТО) Можно потом заменить на реальные ссылки / локальные файлы.
// Сейчас: если не найдено — генерим аватар через ui-avatars.com по нику.
const AVATARS = {
  "Pavlinho19": "./img/pavlinho19.png",
  "Hyper": "./img/hyper.png",
  "Vuksha": "./img/vuksha.png",
  "Maxa": "./img/maxa.png",
  "borees": "./img/borees.png",
  "Leolol_Pepsi": "./img/leolol_Pepsi.png",
  "KaLuBa": "./img/kaluba.png",
  "Sef": "./img/sef.png",
  "Hristian05": "./img/hristian05.png",
  "Rodja": "./img/rodja.png",
  "Duka": "./img/duka.png",
  "Lumix": "./img/lumix.png",
  "BlueEyes": "./img/blueeyes.png",
  "Gaga": "./img/gaga.png",
  "Qnko": "./img/qnko.png",
  "Lx7ss": "./img/lx7ss.png",
  //"Badema": "./img/badema.png",
  "SpeciAL": "./img/special.png",
  "Decade": "./img/decade.png",
  "Giox": "./img/giox.png",
  "Kriso": "./img/kriso.png",
  "Totti": "./img/totti.png",
  "Noltzer": "./img/noltzer.png",
  "maggett0": "./img/maggett0.png",
  "Malenkiy": "./img/malenkiy.png"
};

// ================== GROUPS ==================
// thresholds: minRating for group
const GROUPS = [
  { name: "Legend", min: 1250, color: "#e53a2eff" },
  { name: "Icon", min: 1125, color: "#dab823ff" },
  { name: "Elite", min: 1000, color: "#f0ff25ff" },
  { name: "Champion", min: 875,  color: "#20b839ff" },
  { name: "World Class", min: 750,  color: "#b8b8b8ff" },
  { name: "Professional", min: 0,    color: "#7ec8ceff" },
];

function getGroupByRating(rating) {
  const r = Number(rating);
  if (!isFinite(r)) return { name: "—", color: "#7A8196" };
  // ищем первую группу по убыванию min
  for (const g of GROUPS) {
    if (r >= g.min) return g;
  }
  return GROUPS.at(-1);
}


// ================== ELEMENTS ==================
const els = {
  tbody: document.querySelector("#leaderboard tbody"),
  search: document.getElementById("search"),
  refresh: document.getElementById("refresh"),

  profileTitle: document.getElementById("profileTitle"),
  currentRating: document.getElementById("currentRating"),
  deltaPeriod: document.getElementById("delta7"),
  delta1: document.getElementById("delta1"),
  pointsCount: document.getElementById("pointsCount"),

  deltaHeader: document.getElementById("deltaHeader"),
  deltaLabel: document.getElementById("deltaLabel"),

  history: document.getElementById("history"),
  chart: document.getElementById("chart"),
  periodButtons: document.querySelectorAll("#periodSwitch button"),

  playerPhoto: document.getElementById("playerPhoto"),
  photoNick: document.getElementById("photoNick"),
  groupDot: document.getElementById("groupDot"),
  groupName: document.getElementById("groupName"),
};

let state = {
  players: [],
  selected: null,
  periodDays: 7,

  // глобальный рейтинг независимо от поиска
  globalRows: [],         // массив игроков отсортированный по рейтингу
  globalRankByNick: new Map(), // nick -> rank (1..)
};

init();

// ================== INIT ==================
async function init() {
  els.refresh?.addEventListener("click", loadData);
  els.search?.addEventListener("input", onSearch);

  els.periodButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      els.periodButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.periodDays = Number(btn.dataset.days);

      updateDeltaLabels();

      // перерисовка
      renderTable();

      const p = state.selected ? state.players.find(x => x.nick === state.selected.nick) : null;
      if (p) selectPlayer(p);
    });
  });

  updateDeltaLabels();
  await loadData();
  handleDeepLink();
}

function updateDeltaLabels() {
  if (els.deltaHeader) els.deltaHeader.textContent = `Δ ${state.periodDays}d`;
  if (els.deltaLabel) els.deltaLabel.textContent = `Change (${state.periodDays} days)`;
}

// ================== JSONP ==================
function loadJSONP(url) {
  return new Promise((resolve, reject) => {
    const cbName = `__rank_cb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };

    const script = document.createElement("script");
    script.src = `${url}?callback=${cbName}&t=${Date.now()}`;
    script.async = true;

    script.onerror = () => {
      cleanup();
      reject(new Error("JSONP load failed"));
    };

    function cleanup() {
      try { delete window[cbName]; } catch (_) { window[cbName] = undefined; }
      script.remove();
    }

    document.body.appendChild(script);
  });
}

// ================== LOAD DATA ==================
async function loadData() {
  try {
    const data = await loadJSONP(DATA_URL);

    state.players = (data.players || []).map(p => ({
      nick: p.nick,
      series: (p.series || []).slice().sort((a, b) => a.date.localeCompare(b.date))
    }));

    buildGlobalRanking();
    renderTable();
    autoSelectTop();
  } catch (err) {
    console.error(err);
    alert("Не удалось загрузить данные из Google Script.");
  }
}

// строим глобальный рейтинг и мапу nick->rank
function buildGlobalRanking() {
  state.globalRows = state.players
    .map(p => ({
      ...p,
      rating: p.series.at(-1)?.rating ?? null,
      deltaPeriod: calcDelta(p.series, state.periodDays),
      delta1: calcDelta(p.series, 1),
    }))
    .sort((a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity));

  state.globalRankByNick = new Map();
  state.globalRows.forEach((p, idx) => state.globalRankByNick.set(p.nick, idx + 1));
}

// ================== TABLE ==================
function renderTable() {
  if (!els.tbody) return;

  // каждый ререндер — пересобираем глобальный рейтинг (на случай смены periodDays)
  buildGlobalRanking();

  const q = (els.search?.value || "").toLowerCase();
  els.tbody.innerHTML = "";

  // фильтрация НЕ меняет ранг — ранг берём из globalRankByNick
  const filtered = state.globalRows.filter(p => p.nick.toLowerCase().includes(q));

  filtered.forEach((p) => {
    const tr = document.createElement("tr");

    const rank = state.globalRankByNick.get(p.nick) ?? null;

    // подсветка топ-3 по ГЛОБАЛЬНОМУ рангу
    if (rank === 1) tr.classList.add("rank-1");
    if (rank === 2) tr.classList.add("rank-2");
    if (rank === 3) tr.classList.add("rank-3");

    tr.innerHTML = `
      <td>${rank ?? "—"}</td>
      <td>${escapeHtml(p.nick)}</td>
      <td class="right">${fmt(p.rating, RATING_DIGITS)}</td>
      <td class="right">${formatDelta(p.deltaPeriod, DELTA_DIGITS)}</td>
      <td class="right">${formatDelta(p.delta1, DELTA_DIGITS)}</td>
    `;

    tr.onclick = () => selectPlayer(p);
    els.tbody.appendChild(tr);
  });
}

// ================== SELECT PLAYER ==================
function selectPlayer(p) {
  state.selected = p;
  updateURL(p.nick);

  if (els.profileTitle) els.profileTitle.textContent = `Player: ${p.nick}`;

  const lastRating = p.series.at(-1)?.rating ?? null;

  if (els.currentRating) els.currentRating.textContent = fmt(lastRating, RATING_DIGITS);
  if (els.deltaPeriod) els.deltaPeriod.textContent = formatDelta(calcDelta(p.series, state.periodDays), DELTA_DIGITS);
  if (els.delta1) els.delta1.textContent = formatDelta(calcDelta(p.series, 1), DELTA_DIGITS);
  if (els.pointsCount) els.pointsCount.textContent = String(p.series.length);

  // Фото
  setPlayerPhoto(p.nick);
  setPlayerGroup(lastRating);

  // История и график по выбранному периоду
  const seriesWindow = sliceByDays(p.series, state.periodDays);
  renderHistory(seriesWindow);
  drawChartAnimated(seriesWindow);
}

function setPlayerPhoto(nick) {
  const url = avatarUrlForNick(nick);
  if (els.playerPhoto) els.playerPhoto.src = url;
  if (els.photoNick) els.photoNick.textContent = nick;
}

function setPlayerGroup(rating) {
  const g = getGroupByRating(rating);

  if (els.groupName) els.groupName.textContent = g.name;
  if (els.groupDot) els.groupDot.style.background = g.color;
}

function avatarUrlForNick(nick) {
  if (AVATARS[nick]) return AVATARS[nick];

  // безопасный дефолт: генерим аватар с инициалами
  const safe = encodeURIComponent(nick);
  return `https://ui-avatars.com/api/?name=${safe}&background=0b1f17&color=35c07a&size=512&bold=true&format=png`;
}

// ================== HISTORY ==================
function renderHistory(series) {
  if (!els.history) return;

  els.history.innerHTML = "";

  // показываем от нового к старому
  series.slice().reverse().forEach((p, i, arr) => {
    const prev = arr[i + 1]?.rating;
    const delta = prev != null ? p.rating - prev : null;

    const li = document.createElement("li");
    li.innerHTML = `
      <span>${p.date}</span>
      <span>${fmt(p.rating, RATING_DIGITS)}${delta != null ? ` (${formatDelta(delta, DELTA_DIGITS)})` : ""}</span>
    `;
    els.history.appendChild(li);
  });
}

// ================== CHART (ANIMATED) ==================
function drawChartAnimated(series) {
  if (!els.chart) return;
  const ctx = els.chart.getContext("2d");
  const W = els.chart.width;
  const H = els.chart.height;
  const pad = 40;

  ctx.clearRect(0, 0, W, H);

  if (!series.length) return;

  const values = series.map(s => s.rating);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = (max - min) || 1;

  let progress = 0;

  function animate() {
    progress += 0.05;
    if (progress > 1) progress = 1;

    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    ctx.strokeStyle = "#35c07a"; // green line
    ctx.lineWidth = 2;

    const n = series.length;
    const maxIndex = Math.floor((n - 1) * progress);

    for (let i = 0; i <= maxIndex; i++) {
      const p = series[i];
      const x = pad + (i / Math.max(1, n - 1)) * (W - pad * 2);
      const y = pad + (1 - (p.rating - min) / range) * (H - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.stroke();
    if (progress < 1) requestAnimationFrame(animate);
  }

  animate();
}

// ================== SERIES WINDOW BY DAYS ==================
// Берём только последние N дней (по датам). Если в данных есть ежедневные точки — будет ровно N+1 точка обычно.
function sliceByDays(series, days) {
  if (!series.length) return [];
  const last = series.at(-1);
  const lastDate = new Date(last.date);
  const from = new Date(lastDate);
  from.setDate(from.getDate() - days);

  return series.filter(p => new Date(p.date) >= from);
}

// ================== DELTA ==================
function calcDelta(series, days) {
  if (!series.length) return null;

  const last = series.at(-1);
  const lastDate = new Date(last.date);
  const target = new Date(lastDate);
  target.setDate(target.getDate() - days);

  // ближайшая точка <= target
  let base = series[0];
  for (const p of series) {
    if (new Date(p.date) <= target) base = p;
  }

  return last.rating - base.rating;
}

function fmt(num, digits = 1) {
  if (num == null || isNaN(num)) return "—";
  return Number(num).toFixed(digits);
}

function formatDelta(v, digits = 1) {
  if (v == null || isNaN(v)) return "—";
  const n = Number(v);
  const s = n.toFixed(digits);
  return n > 0 ? `+${s}` : s;
}

// ================== SEARCH AUTSELECT ==================
function onSearch() {
  renderTable();

  // авто-выбор первого видимого игрока, но ранг остаётся глобальным
  const first = els.tbody?.querySelector("tr");
  if (first) first.click();
}

// ================== DEEP LINK ==================
function updateURL(nick) {
  const url = new URL(window.location.href);
  url.searchParams.set("player", nick);
  history.replaceState(null, "", url.toString());
}

function handleDeepLink() {
  const nick = new URLSearchParams(window.location.search).get("player");
  if (!nick) return;

  const p = state.players.find(x => x.nick === nick);
  if (p) selectPlayer(p);
}

// ================== START SELECT ==================
function autoSelectTop() {
  if (!state.globalRows.length) return;
  selectPlayer(state.globalRows[0]);
}

// ================== HTML ESCAPE ==================
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
