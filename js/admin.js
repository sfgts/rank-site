/* ============================================================
 * ESportsBattle Admin Panel — Supabase edition
 * ============================================================ */
"use strict";

const SUPABASE = Object.freeze({
  URL: "https://vgmwxtpsbwzeqwtpxamo.supabase.co",
  KEY: "sb_publishable_RjvZCtsriMO6nGDASJkcbg_estuVZyq",
});

const ADMIN_CFG = Object.freeze({
  // Password: ESBAdmin123
  PASS_B64: "RVNCQWRtaW4xMjM=",
  DATA_URL: "https://script.google.com/macros/s/AKfycbxkLrAorAf8PMAB3Wu9vBv7DIcjj9tj6W4KrnuEVYMvrV563bWQ0clgsultApJnEOy0/exec",
});

const AVATAR_OVERRIDES = Object.freeze({
  Lelool_Pepsi: "img/Leolol_Pepsi.png",
  KaBuA:        "img/KaLuBa.png",
  Christian05:  "img/Hristian05.png",
  Onko:         "img/Qnko.png",
  maggetto:     "img/maggett0.png",
});

/* ===== State ===== */
const st = {
  players: [],
  hiddenNicks: new Set(),
  searchQuery: "",
};

/* ===== DOM refs ===== */
const loginSection  = document.getElementById("loginSection");
const panelSection  = document.getElementById("panelSection");
const passwordInput = document.getElementById("passwordInput");
const loginBtn      = document.getElementById("loginBtn");
const loginError    = document.getElementById("loginError");
const logoutBtn     = document.getElementById("logoutBtn");
const playerList    = document.getElementById("playerList");
const totalVisible  = document.getElementById("totalVisible");
const totalHidden   = document.getElementById("totalHidden");
const adminSearch   = document.getElementById("adminSearch");

/* ===== Auth ===== */
function tryLogin() {
  loginError.style.display = "none";
  const correct = atob(ADMIN_CFG.PASS_B64);
  if (passwordInput.value !== correct) {
    loginError.textContent = "Incorrect password";
    loginError.style.display = "block";
    passwordInput.value = "";
    passwordInput.focus();
    return;
  }
  enterPanel();
}

function logout() {
  location.reload();
}

/* ===== Panel ===== */
function enterPanel() {
  loginSection.style.display = "none";
  panelSection.style.display = "block";
  loadAdminData();
}

async function loadAdminData() {
  playerList.innerHTML = '<p class="loading-msg">Loading player data...</p>';

  try {
    const res = await fetch(
      SUPABASE.URL + "/rest/v1/hidden_players?select=nick",
      { headers: { apikey: SUPABASE.KEY, Authorization: "Bearer " + SUPABASE.KEY } }
    );
    const rows = await res.json();
    st.hiddenNicks = new Set(Array.isArray(rows) ? rows.map(function(r) { return r.nick; }) : []);
  } catch (e) {
    console.warn("Supabase load failed:", e);
    st.hiddenNicks = new Set();
  }

  try {
    const data = await loadJSONP(ADMIN_CFG.DATA_URL);
    st.players = (data && data.players ? data.players : [])
      .map(function(p) {
        return {
          nick: String(p.nick),
          rating: p.series && p.series.length ? p.series[p.series.length - 1].rating : null,
        };
      })
      .sort(function(a, b) {
        var ra = a.rating != null ? a.rating : -Infinity;
        var rb = b.rating != null ? b.rating : -Infinity;
        return rb - ra;
      });
    renderList();
  } catch (err) {
    playerList.innerHTML = '<p style="color:#ff7676;padding:24px 0;text-align:center;">Failed to load data: ' + escHtml(err.message) + '</p>';
  }
}

function renderList() {
  updateStats();
  var q = st.searchQuery.toLowerCase().trim();
  var visible = q
    ? st.players.filter(function(p) { return p.nick.toLowerCase().indexOf(q) !== -1; })
    : st.players;

  if (!visible.length) {
    playerList.innerHTML = '<p class="loading-msg">No players found.</p>';
    return;
  }

  var frag = document.createDocumentFragment();
  for (var i = 0; i < visible.length; i++) {
    frag.appendChild(makeRow(visible[i]));
  }
  playerList.replaceChildren(frag);
}

function makeRow(p) {
  var isHidden  = st.hiddenNicks.has(p.nick);
  var rating    = p.rating != null ? Number(p.rating).toFixed(1) : "—";
  var avatarSrc = AVATAR_OVERRIDES[p.nick] || ("img/" + encodeURIComponent(p.nick) + ".png");
  var fallback  = "https://ui-avatars.com/api/?name=" + encodeURIComponent(p.nick) + "&background=0b1f17&color=35c07a&size=64&bold=true&format=png";

  var row = document.createElement("div");
  row.className = "player-row" + (isHidden ? " player-row--hidden" : "");
  row.dataset.nick = p.nick;

  var hiddenTitle = isHidden ? "Hidden — click to show" : "Visible — click to hide";
  var checkedAttr = isHidden ? "" : "checked";
  var labelText   = isHidden ? "Hidden" : "Visible";

  row.innerHTML =
    '<div class="player-row-info">' +
      '<img class="player-row-avatar" src="' + escAttr(avatarSrc) + '" alt="' + escAttr(p.nick) + '" loading="lazy" onerror="this.onerror=null;this.src=\'' + escAttr(fallback) + '\'" />' +
      '<div>' +
        '<div class="player-row-nick">' + escHtml(p.nick) + '</div>' +
        '<div class="player-row-rating">Rating: ' + escHtml(rating) + '</div>' +
      '</div>' +
    '</div>' +
    '<label class="toggle" title="' + escAttr(hiddenTitle) + '">' +
      '<input type="checkbox" ' + checkedAttr + ' />' +
      '<span class="toggle-track"><span class="toggle-thumb"></span></span>' +
      '<span class="toggle-label">' + labelText + '</span>' +
    '</label>';

  row.querySelector("input[type=checkbox]").addEventListener("change", function(e) {
    onToggle(p.nick, e.target.checked, row);
  });

  return row;
}

async function onToggle(nick, visible, row) {
  if (visible) {
    st.hiddenNicks.delete(nick);
  } else {
    st.hiddenNicks.add(nick);
  }
  row.className = "player-row" + (visible ? "" : " player-row--hidden");

  var lbl = row.querySelector(".toggle-label");
  var tog = row.querySelector(".toggle");
  if (lbl) lbl.textContent = visible ? "Visible" : "Hidden";
  if (tog) tog.title = visible ? "Visible — click to hide" : "Hidden — click to show";
  updateStats();

  try {
    var res2;
    if (visible) {
      res2 = await fetch(
        SUPABASE.URL + "/rest/v1/hidden_players?nick=eq." + encodeURIComponent(nick),
        { method: "DELETE", headers: { apikey: SUPABASE.KEY, Authorization: "Bearer " + SUPABASE.KEY } }
      );
    } else {
      res2 = await fetch(SUPABASE.URL + "/rest/v1/hidden_players", {
        method: "POST",
        headers: {
          apikey: SUPABASE.KEY,
          Authorization: "Bearer " + SUPABASE.KEY,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify({ nick: nick }),
      });
    }
    if (!res2.ok) {
      var errBody = await res2.text();
      throw new Error("HTTP " + res2.status + ": " + errBody);
    }
  } catch (err) {
    console.error("Supabase error:", err);
    // revert UI
    if (visible) { st.hiddenNicks.add(nick); } else { st.hiddenNicks.delete(nick); }
    row.className = "player-row" + (visible ? " player-row--hidden" : "");
    if (lbl) lbl.textContent = visible ? "Hidden" : "Visible";
    updateStats();
  }
}

function updateStats() {
  var hidden = st.hiddenNicks.size;
  var total  = st.players.length;
  if (totalVisible) totalVisible.textContent = total - hidden;
  if (totalHidden)  totalHidden.textContent  = hidden;
}

/* ===== JSONP ===== */
function loadJSONP(url, timeoutMs) {
  if (!timeoutMs) timeoutMs = 15000;
  return new Promise(function(resolve, reject) {
    var cbName = "__adm_cb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
    var script = document.createElement("script");
    var timer = 0;

    function cleanup() {
      try { delete window[cbName]; } catch(e) { window[cbName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
      if (timer) clearTimeout(timer);
    }

    window[cbName] = function(data) { cleanup(); resolve(data); };
    script.src = url + "?callback=" + cbName + "&t=" + Date.now();
    script.async = true;
    script.onerror = function() { cleanup(); reject(new Error("JSONP load failed")); };
    timer = setTimeout(function() { cleanup(); reject(new Error("JSONP timeout")); }, timeoutMs);
    document.body.appendChild(script);
  });
}

/* ===== Utils ===== */
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escAttr(str) {
  return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function debounce(fn, ms) {
  var t = 0;
  return function() {
    var args = arguments;
    clearTimeout(t);
    t = setTimeout(function() { fn.apply(null, args); }, ms);
  };
}

/* ===== Boot ===== */
loginBtn.addEventListener("click", tryLogin);
passwordInput.addEventListener("keydown", function(e) {
  if (e.key === "Enter") tryLogin();
});
if (logoutBtn) logoutBtn.addEventListener("click", logout);
if (adminSearch) adminSearch.addEventListener("input", debounce(function() {
  st.searchQuery = adminSearch.value;
  renderList();
}, 120));

passwordInput.focus();
