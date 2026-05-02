/* ============================================================
 * ESportsBattle Admin Panel — Supabase edition
 * ============================================================ */
"use strict";

const SUPABASE = Object.freeze({
  URL: "https://vgmwxtpsbwzeqwtpxamo.supabase.co",
  KEY: "sb_publishable_RjvZCtsriMO6nGDASJkcbg_estuVZyq",
  BUCKET: "player-avatars",
  ACH_BUCKET: "achievements",
});

const ADMIN_CFG = Object.freeze({
  PASS_B64: "RVNCQWRtaW4xMjM=",
  DATA_URL: "https://script.google.com/macros/s/AKfycbxkLrAorAf8PMAB3Wu9vBv7DIcjj9tj6W4KrnuEVYMvrV563bWQ0clgsultApJnEOy0/exec",
  COOKIE: "esb_admin",
});

/* ===== Rating groups ===== */
var GROUPS = [
  { name: "Legend",       min: 1250, color: "#e53a2e" },
  { name: "Icon",         min: 1125, color: "#dab823" },
  { name: "Elite",        min: 1000, color: "#f0ff25" },
  { name: "Champion",     min:  875, color: "#20b839" },
  { name: "World Class",  min:  750, color: "#b8b8b8" },
  { name: "Professional", min:    0, color: "#7ec8ce" },
];
function getGroup(rating) {
  var r = Number(rating);
  if (!isFinite(r) || r < 0) return GROUPS[GROUPS.length - 1];
  for (var i = 0; i < GROUPS.length; i++) {
    if (r >= GROUPS[i].min) return GROUPS[i];
  }
  return GROUPS[GROUPS.length - 1];
}
function calcDelta(series, days) {
  if (!series || series.length < 2) return null;
  var last = series[series.length - 1];
  var lastDate = new Date(last.date);
  var target = new Date(lastDate);
  target.setDate(target.getDate() - days);
  var base = series[0];
  for (var i = 0; i < series.length; i++) {
    if (new Date(series[i].date) <= target) base = series[i];
  }
  return last.rating - base.rating;
}

/* ===== State ===== */
const st = {
  players: [],
  hiddenNicks: new Set(),
  searchQuery: "",
  achievements: [],
  playerAchievements: {},
  openPickerNick: null,
  currentTab: "players",
  adminEmail: "",
};

/* ===== DOM refs ===== */
const loginSection  = document.getElementById("loginSection");
const panelSection  = document.getElementById("panelSection");
const emailInput    = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const loginBtn      = document.getElementById("loginBtn");
const loginError    = document.getElementById("loginError");
const logoutBtn     = document.getElementById("logoutBtn");
const playerList    = document.getElementById("playerList");
const totalVisible  = document.getElementById("totalVisible");
const totalHidden   = document.getElementById("totalHidden");
const adminSearch   = document.getElementById("adminSearch");

/* ===== Cookie helpers ===== */
function setCookie(name, value, days) {
  var exp = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = name + "=" + value + "; expires=" + exp + "; path=/; SameSite=Strict";
}
function getCookie(name) {
  var m = document.cookie.match("(?:^|; )" + name + "=([^;]*)");
  return m ? m[1] : null;
}
function deleteCookie(name) {
  document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
}

/* ===== Auth ===== */
async function tryLogin() {
  loginError.style.display = "none";
  loginBtn.disabled = true;
  loginBtn.textContent = "Checking…";

  var email    = emailInput ? emailInput.value.trim() : "";
  var password = passwordInput.value;

  if (!email || !password) {
    loginBtn.disabled = false;
    loginBtn.textContent = "Log in";
    showLoginError("Enter email and password.");
    return;
  }

  try {
    var res = await fetch(SUPABASE.URL + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: {
        "apikey": SUPABASE.KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: email, password: password }),
    });
    var data = await res.json();
    if (!res.ok || !data.access_token) {
      showLoginError("Invalid email or password.");
      return;
    }
    setCookie(ADMIN_CFG.COOKIE, "1", 7);
    setCookie("esb_admin_email", email, 7);
    st.adminEmail = email;
    writeLog("Logged in", email);
    enterPanel();
  } catch (e) {
    console.error("Login error:", e);
    showLoginError("Connection error. Try again.");
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Log in";
  }
}

function showLoginError(msg) {
  loginError.textContent = msg;
  loginError.style.display = "block";
  passwordInput.value = "";
  passwordInput.focus();
}
function logout() {
  writeLog("Logged out", st.adminEmail || null);
  deleteCookie(ADMIN_CFG.COOKIE);
  deleteCookie("esb_admin_email");
  st.adminEmail = "";
  setTimeout(function() { location.reload(); }, 300);
}

/* ===== Panel ===== */
function setAdminLoading(on) {
  var ov = document.getElementById("adminLoadingOverlay");
  if (ov) ov.classList.toggle("hidden", !on);
}

function enterPanel() {
  loginSection.style.display = "none";
  panelSection.style.display = "block";
  setTimeout(function() { setAdminLoading(true); }, 0);
  loadAdminData();
}

async function loadAdminData() {
  playerList.innerHTML = '<p class="loading-msg">Loading player data...</p>';

  try {
    var res = await fetch(
      SUPABASE.URL + "/rest/v1/hidden_players?select=nick",
      { headers: { apikey: SUPABASE.KEY, Authorization: "Bearer " + SUPABASE.KEY } }
    );
    var rows = await res.json();
    st.hiddenNicks = new Set(Array.isArray(rows) ? rows.map(function(r) { return r.nick; }) : []);
  } catch (e) {
    console.warn("Supabase hidden load failed:", e);
    st.hiddenNicks = new Set();
  }

  await loadAchievements();
  await loadAllPlayerAchievements();
  renderAchievementsTab();

  try {
    var data = await loadJSONP(ADMIN_CFG.DATA_URL);
    st.players = (data && data.players ? data.players : [])
      .map(function(p) {
        var series = (p.series || []).slice().sort(function(a,b){return a.date.localeCompare(b.date);});
        return {
          nick: String(p.nick),
          rating: series.length ? series[series.length - 1].rating : null,
          series: series,
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
  } finally {
    setAdminLoading(false);
  }
}

/* ===== Tab switching ===== */
function switchTab(tab) {
  st.currentTab = tab;
  var tabIds = ["players", "achievements", "dashboard", "log"];
  tabIds.forEach(function(key) {
    var btn = document.getElementById("tab" + key.charAt(0).toUpperCase() + key.slice(1));
    var sec = document.getElementById("section" + key.charAt(0).toUpperCase() + key.slice(1));
    if (btn) btn.classList.toggle("tab-active", key === tab);
    if (sec) sec.style.display = key === tab ? "block" : "none";
  });
  if (tab === "dashboard") renderDashboard();
  if (tab === "log") loadLog();
}

/* ===== Load achievements ===== */
async function loadAchievements() {
  try {
    var res = await fetch(
      SUPABASE.URL + "/rest/v1/achievements?select=id,name,icon_url,url&order=id.asc",
      { headers: { apikey: SUPABASE.KEY, Authorization: "Bearer " + SUPABASE.KEY } }
    );
    var rows = await res.json();
    st.achievements = Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.warn("Achievements load failed:", e);
    st.achievements = [];
  }
}

async function loadAllPlayerAchievements() {
  try {
    var res = await fetch(
      SUPABASE.URL + "/rest/v1/player_achievements?select=nick,achievement_id",
      { headers: { apikey: SUPABASE.KEY, Authorization: "Bearer " + SUPABASE.KEY } }
    );
    var rows = await res.json();
    st.playerAchievements = {};
    if (Array.isArray(rows)) {
      rows.forEach(function(r) {
        if (!st.playerAchievements[r.nick]) st.playerAchievements[r.nick] = new Set();
        st.playerAchievements[r.nick].add(r.achievement_id);
      });
    }
  } catch (e) {
    console.warn("Player achievements load failed:", e);
  }
}

/* ===== Render achievements tab ===== */
function renderAchievementsTab() {
  var container = document.getElementById("achCardList");
  if (!container) return;
  container.innerHTML = "";

  if (!st.achievements.length) {
    container.innerHTML = '<p class="loading-msg">No achievements yet. Create one below.</p>';
    return;
  }

  st.achievements.forEach(function(ach) {
    container.appendChild(makeAchCard(ach));
  });
}

function makeAchCard(ach) {
  var card = document.createElement("div");
  card.className = "ach-card";
  card.dataset.achId = ach.id;
  card.innerHTML =
    '<div class="ach-card-view">' +
      '<img class="ach-card-icon" src="' + escAttr(ach.icon_url) + '" alt="" />' +
      '<div class="ach-card-info">' +
        '<div class="ach-card-name">' + escHtml(ach.name) + '</div>' +
        '<div class="ach-card-url">' + (ach.url ? '<a href="' + escAttr(ach.url) + '" target="_blank" rel="noopener">' + escHtml(ach.url) + '</a>' : '<span style="opacity:0.4;">No link</span>') + '</div>' +
      '</div>' +
      '<div class="ach-card-actions">' +
        '<button class="btn ach-edit-btn" type="button" style="font-size:12px;">✏ Edit</button>' +
        '<button class="btn ach-del-btn" type="button" style="font-size:12px;color:#ff7676;">✕ Delete</button>' +
      '</div>' +
    '</div>' +
    '<div class="ach-card-edit" style="display:none;">' +
      '<div class="ach-edit-row">' +
        '<label class="ach-edit-label">Name</label>' +
        '<input class="ach-edit-name ach-edit-input" type="text" value="' + escAttr(ach.name) + '" />' +
      '</div>' +
      '<div class="ach-edit-row">' +
        '<label class="ach-edit-label">Link (URL)</label>' +
        '<input class="ach-edit-url ach-edit-input" type="url" placeholder="https://..." value="' + escAttr(ach.url || "") + '" />' +
      '</div>' +
      '<div class="ach-edit-row">' +
        '<label class="ach-edit-label">Icon</label>' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<label class="upload-btn" title="Choose new icon">🖼<input class="ach-edit-file" type="file" accept="image/*" style="display:none" /></label>' +
          '<span class="ach-edit-filename" style="font-size:12px;opacity:0.55;">Keep current</span>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:4px;">' +
        '<button class="btn ach-save-edit-btn" type="button" style="font-size:13px;background:var(--accent);color:#0b0f14;font-weight:700;">Save</button>' +
        '<button class="btn ach-cancel-edit-btn" type="button" style="font-size:13px;">Cancel</button>' +
      '</div>' +
    '</div>';

  /* Edit toggle */
  card.querySelector(".ach-edit-btn").addEventListener("click", function() {
    card.querySelector(".ach-card-view").style.display = "none";
    card.querySelector(".ach-card-edit").style.display = "block";
  });
  card.querySelector(".ach-cancel-edit-btn").addEventListener("click", function() {
    card.querySelector(".ach-card-view").style.display = "flex";
    card.querySelector(".ach-card-edit").style.display = "none";
    card.querySelector(".ach-edit-file").value = "";
    card.querySelector(".ach-edit-filename").textContent = "Keep current";
  });

  /* File picker label */
  card.querySelector(".ach-edit-file").addEventListener("change", function(e) {
    card.querySelector(".ach-edit-filename").textContent = e.target.files[0] ? e.target.files[0].name : "Keep current";
  });

  /* Save edit */
  card.querySelector(".ach-save-edit-btn").addEventListener("click", function() {
    var name = card.querySelector(".ach-edit-name").value.trim();
    var url  = card.querySelector(".ach-edit-url").value.trim();
    var file = card.querySelector(".ach-edit-file").files[0] || null;
    if (!name) { alert("Name cannot be empty."); return; }
    saveAchievementEdit(ach.id, name, url, file, card);
  });

  /* Delete */
  card.querySelector(".ach-del-btn").addEventListener("click", function() {
    if (confirm('Delete achievement "' + ach.name + '"?')) deleteAchievement(ach.id, card);
  });

  return card;
}

/* ===== Create achievement ===== */
async function createAchievement(name, url, file) {
  var saveBtn = document.getElementById("achSaveBtn");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }

  try {
    var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    var filename = slug + "_" + Date.now() + ".png";
    var uploadRes = await fetch(
      SUPABASE.URL + "/storage/v1/object/" + SUPABASE.ACH_BUCKET + "/" + filename,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE.KEY,
          Authorization: "Bearer " + SUPABASE.KEY,
          "Content-Type": file.type || "image/png",
          "x-upsert": "true",
        },
        body: file,
      }
    );
    if (!uploadRes.ok) {
      var errText = await uploadRes.text();
      throw new Error("Icon upload failed: " + errText);
    }
    var iconUrl = SUPABASE.URL + "/storage/v1/object/public/" + SUPABASE.ACH_BUCKET + "/" + filename;

    var insertRes = await fetch(SUPABASE.URL + "/rest/v1/achievements", {
      method: "POST",
      headers: {
        apikey: SUPABASE.KEY,
        Authorization: "Bearer " + SUPABASE.KEY,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ name: name, icon_url: iconUrl, url: url || null }),
    });
    if (!insertRes.ok) {
      var errBody = await insertRes.text();
      throw new Error("DB insert failed: " + errBody);
    }
    var inserted = await insertRes.json();
    var newAch = Array.isArray(inserted) ? inserted[0] : inserted;
    st.achievements.push(newAch);
    writeLog("Achievement created", name);

    /* Reset form */
    document.getElementById("achNameInput").value = "";
    document.getElementById("achUrlInput").value = "";
    document.getElementById("achIconInput").value = "";
    document.getElementById("achIconName").textContent = "No file";
    document.getElementById("addAchForm").style.display = "none";

    renderAchievementsTab();
    renderList();
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save"; }
  }
}

/* ===== Edit achievement ===== */
async function saveAchievementEdit(id, name, url, file, cardEl) {
  var saveBtn = cardEl.querySelector(".ach-save-edit-btn");
  saveBtn.disabled = true; saveBtn.textContent = "Saving…";

  try {
    var updateData = { name: name, url: url || null };

    /* Upload new icon if provided */
    if (file) {
      var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      var filename = slug + "_" + Date.now() + ".png";
      var uploadRes = await fetch(
        SUPABASE.URL + "/storage/v1/object/" + SUPABASE.ACH_BUCKET + "/" + filename,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE.KEY,
            Authorization: "Bearer " + SUPABASE.KEY,
            "Content-Type": file.type || "image/png",
            "x-upsert": "true",
          },
          body: file,
        }
      );
      if (!uploadRes.ok) {
        var errText = await uploadRes.text();
        throw new Error("Icon upload failed: " + errText);
      }
      updateData.icon_url = SUPABASE.URL + "/storage/v1/object/public/" + SUPABASE.ACH_BUCKET + "/" + filename;
    }

    var res = await fetch(SUPABASE.URL + "/rest/v1/achievements?id=eq." + id, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE.KEY,
        Authorization: "Bearer " + SUPABASE.KEY,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(updateData),
    });
    if (!res.ok) {
      var errBody = await res.text();
      throw new Error("Update failed: " + errBody);
    }

    /* Update state */
    var idx = st.achievements.findIndex(function(a) { return a.id === id; });
    if (idx !== -1) {
      st.achievements[idx].name = name;
      st.achievements[idx].url = url || null;
      if (updateData.icon_url) st.achievements[idx].icon_url = updateData.icon_url;
    }
    writeLog("Achievement edited", name);

    renderAchievementsTab();
    renderList();
  } catch (err) {
    alert("Error: " + err.message);
    saveBtn.disabled = false; saveBtn.textContent = "Save";
  }
}

/* ===== Delete achievement ===== */
async function deleteAchievement(id, cardEl) {
  if (cardEl) cardEl.style.opacity = "0.4";
  try {
    var res = await fetch(
      SUPABASE.URL + "/rest/v1/achievements?id=eq." + id,
      { method: "DELETE", headers: { apikey: SUPABASE.KEY, Authorization: "Bearer " + SUPABASE.KEY } }
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    var delName = (st.achievements.find(function(a){return a.id===id;})||{}).name || String(id);
    writeLog("Achievement deleted", delName);
    st.achievements = st.achievements.filter(function(a) { return a.id !== id; });
    Object.keys(st.playerAchievements).forEach(function(nick) {
      st.playerAchievements[nick].delete(id);
    });
    renderAchievementsTab();
    renderList();
  } catch (err) {
    if (cardEl) cardEl.style.opacity = "1";
    alert("Delete failed: " + err.message);
  }
}

/* ===== Achievement picker (per player) ===== */
function openAchievementPicker(nick, btnEl) {
  closeAchievementPicker();
  if (!st.achievements.length) { alert("No achievements yet. Create one in the Achievements tab."); return; }
  st.openPickerNick = nick;
  var picker = document.createElement("div");
  picker.className = "ach-picker";
  picker.id = "achPicker";
  var assigned = st.playerAchievements[nick] || new Set();
  st.achievements.forEach(function(ach) {
    var isChecked = assigned.has(ach.id);
    var item = document.createElement("label");
    item.className = "ach-picker-item";
    item.innerHTML =
      '<input type="checkbox" ' + (isChecked ? "checked" : "") + ' data-ach-id="' + ach.id + '" />' +
      '<img src="' + escAttr(ach.icon_url) + '" alt="" />' +
      '<span>' + escHtml(ach.name) + '</span>';
    item.querySelector("input").addEventListener("change", function(e) {
      togglePlayerAchievement(nick, ach.id, e.target.checked);
    });
    picker.appendChild(item);
  });
  var rect = btnEl.getBoundingClientRect();
  picker.style.position = "fixed";
  picker.style.top = (rect.bottom + 6) + "px";
  picker.style.right = (window.innerWidth - rect.right) + "px";
  document.body.appendChild(picker);
  setTimeout(function() {
    document.addEventListener("click", onPickerOutsideClick, true);
  }, 0);
}

function onPickerOutsideClick(e) {
  var picker = document.getElementById("achPicker");
  if (!picker) { document.removeEventListener("click", onPickerOutsideClick, true); return; }
  if (!picker.contains(e.target)) {
    closeAchievementPicker();
    document.removeEventListener("click", onPickerOutsideClick, true);
  }
}
function closeAchievementPicker() {
  var picker = document.getElementById("achPicker");
  if (picker) picker.remove();
  st.openPickerNick = null;
}

async function togglePlayerAchievement(nick, achId, assign) {
  if (!st.playerAchievements[nick]) st.playerAchievements[nick] = new Set();
  if (assign) { st.playerAchievements[nick].add(achId); }
  else        { st.playerAchievements[nick].delete(achId); }
  updateTrophyBtn(nick);
  try {
    var res;
    if (assign) {
      res = await fetch(SUPABASE.URL + "/rest/v1/player_achievements", {
        method: "POST",
        headers: {
          apikey: SUPABASE.KEY, Authorization: "Bearer " + SUPABASE.KEY,
          "Content-Type": "application/json", Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify({ nick: nick, achievement_id: achId }),
      });
    } else {
      res = await fetch(
        SUPABASE.URL + "/rest/v1/player_achievements?nick=eq." + encodeURIComponent(nick) + "&achievement_id=eq." + achId,
        { method: "DELETE", headers: { apikey: SUPABASE.KEY, Authorization: "Bearer " + SUPABASE.KEY } }
      );
    }
    if (!res.ok) { var errBody = await res.text(); throw new Error("HTTP " + res.status + ": " + errBody); }
    var achName = (st.achievements.find(function(a){return a.id===achId;})||{}).name || String(achId);
    writeLog(assign ? "Badge assigned" : "Badge removed", nick + " → " + achName);
  } catch (err) {
    console.error("Toggle achievement failed:", err);
    if (assign) { st.playerAchievements[nick].delete(achId); }
    else        { st.playerAchievements[nick].add(achId); }
    updateTrophyBtn(nick);
    alert("Error: " + err.message);
  }
}

function updateTrophyBtn(nick) {
  var row = playerList.querySelector('[data-nick="' + CSS.escape(nick) + '"]');
  if (!row) return;
  var btn = row.querySelector(".trophy-btn");
  if (!btn) return;
  var hasAny = st.playerAchievements[nick] && st.playerAchievements[nick].size > 0;
  btn.classList.toggle("has-ach", hasAny);
  btn.title = hasAny ? "Achievements (" + st.playerAchievements[nick].size + ")" : "Add achievement";
}

/* ===== Avatar URL ===== */
function supabaseAvatarUrl(nick) {
  return SUPABASE.URL + "/storage/v1/object/public/" + SUPABASE.BUCKET + "/" + encodeURIComponent(nick) + ".png?t=" + Date.now();
}
function uiAvatarUrl(nick) {
  return "https://ui-avatars.com/api/?name=" + encodeURIComponent(nick) + "&background=0b1f17&color=35c07a&size=64&bold=true&format=png";
}

/* ===== Render players ===== */
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
  for (var i = 0; i < visible.length; i++) { frag.appendChild(makeRow(visible[i])); }
  playerList.replaceChildren(frag);
}

function makeRow(p) {
  var isHidden    = st.hiddenNicks.has(p.nick);
  var rating      = p.rating != null ? Number(p.rating).toFixed(1) : "—";
  var supUrl      = supabaseAvatarUrl(p.nick);
  var uiUrl       = uiAvatarUrl(p.nick);
  var checkedAttr = isHidden ? "" : "checked";
  var labelText   = isHidden ? "Hidden" : "Visible";
  var achCount    = st.playerAchievements[p.nick] ? st.playerAchievements[p.nick].size : 0;
  var trophyClass = "trophy-btn" + (achCount > 0 ? " has-ach" : "");
  var trophyTitle = achCount > 0 ? "Achievements (" + achCount + ")" : "Add achievement";

  var row = document.createElement("div");
  row.className = "player-row" + (isHidden ? " player-row--hidden" : "");
  row.dataset.nick = p.nick;
  row.innerHTML =
    '<div class="player-row-info">' +
      '<img class="player-row-avatar" src="' + escAttr(supUrl) + '" alt="' + escAttr(p.nick) + '" loading="lazy" />' +
      '<div>' +
        '<div class="player-row-nick">' + escHtml(p.nick) + '</div>' +
        '<div class="player-row-rating">Rating: ' + escHtml(rating) + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="row-actions">' +
      '<label class="upload-btn" title="Upload photo">📷<input class="avatar-file-input" type="file" accept="image/*" style="display:none" /></label>' +
      '<button class="' + trophyClass + '" type="button" title="' + escAttr(trophyTitle) + '">🏆</button>' +
      '<label class="toggle" title="' + (isHidden ? "Hidden — click to show" : "Visible — click to hide") + '">' +
        '<input type="checkbox" ' + checkedAttr + ' />' +
        '<span class="toggle-track"><span class="toggle-thumb"></span></span>' +
        '<span class="toggle-label">' + labelText + '</span>' +
      '</label>' +
    '</div>';

  var img = row.querySelector(".player-row-avatar");
  img.onerror = function() { img.onerror = null; img.src = uiUrl; };
  var input = row.querySelector(".avatar-file-input");
  input.addEventListener("change", function(e) {
    var file = e.target.files[0];
    if (file) uploadAvatar(p.nick, file, img);
    input.value = "";
  });
  row.querySelector("input[type=checkbox]").addEventListener("change", function(e) {
    onToggle(p.nick, e.target.checked, row);
  });
  row.querySelector(".trophy-btn").addEventListener("click", function(e) {
    e.stopPropagation();
    openAchievementPicker(p.nick, this);
  });
  return row;
}

/* ===== Upload avatar ===== */
async function uploadAvatar(nick, file, imgEl) {
  var path = encodeURIComponent(nick) + ".png";
  imgEl.style.opacity = "0.4";
  try {
    var res = await fetch(
      SUPABASE.URL + "/storage/v1/object/" + SUPABASE.BUCKET + "/" + path,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE.KEY, Authorization: "Bearer " + SUPABASE.KEY,
          "Content-Type": file.type || "image/png", "x-upsert": "true",
        },
        body: file,
      }
    );
    if (!res.ok) { var errText = await res.text(); throw new Error("Upload failed: " + errText); }
    imgEl.src = supabaseAvatarUrl(nick);
    imgEl.onerror = null;
    writeLog("Avatar uploaded", nick);
  } catch (err) {
    console.error(err); alert("Upload error: " + err.message);
  } finally {
    imgEl.style.opacity = "1";
  }
}

/* ===== Toggle visibility ===== */
async function onToggle(nick, visible, row) {
  if (visible) { st.hiddenNicks.delete(nick); } else { st.hiddenNicks.add(nick); }
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
          apikey: SUPABASE.KEY, Authorization: "Bearer " + SUPABASE.KEY,
          "Content-Type": "application/json", Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify({ nick: nick }),
      });
    }
    if (!res2.ok) { var errBody = await res2.text(); throw new Error("HTTP " + res2.status + ": " + errBody); }
    writeLog(visible ? "Player shown" : "Player hidden", nick);
  } catch (err) {
    console.error("Supabase error:", err);
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
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function escAttr(str) {
  return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function debounce(fn, ms) {
  var t = 0;
  return function() { var args = arguments; clearTimeout(t); t = setTimeout(function() { fn.apply(null, args); }, ms); };
}

/* ===== Write log ===== */
async function writeLog(action, details) {
  try {
    await fetch(SUPABASE.URL + "/rest/v1/admin_log", {
      method: "POST",
      headers: {
        apikey: SUPABASE.KEY, Authorization: "Bearer " + SUPABASE.KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: action,
        details: details || null,
        email: st.adminEmail || null,
      }),
    });
  } catch (e) { console.warn("Log write failed:", e); }
}

/* ===== Load log ===== */
async function loadLog() {
  var logList = document.getElementById("logList");
  if (!logList) return;
  logList.innerHTML = '<p class="loading-msg">Loading…</p>';
  try {
    var res = await fetch(
      SUPABASE.URL + "/rest/v1/admin_log?select=*&order=created_at.desc&limit=200",
      { headers: { apikey: SUPABASE.KEY, Authorization: "Bearer " + SUPABASE.KEY } }
    );
    var rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) {
      logList.innerHTML = '<p class="loading-msg">No log entries yet.</p>';
      return;
    }
    var html = '<div class="log-wrap"><table class="log-table"><thead><tr><th>Time</th><th>Who</th><th>Action</th><th>Details</th></tr></thead><tbody>';
    rows.forEach(function(r) {
      var d = new Date(r.created_at);
      var timeStr = d.toLocaleDateString("uk-UA") + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      html += '<tr>' +
        '<td class="log-time">' + escHtml(timeStr) + '</td>' +
        '<td class="log-details" style="color:var(--accent);font-size:12px;">' + escHtml(r.email || "—") + '</td>' +
        '<td class="log-action">' + escHtml(r.action) + '</td>' +
        '<td class="log-details">' + escHtml(r.details || "—") + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    logList.innerHTML = html;
  } catch (e) {
    logList.innerHTML = '<p style="color:#ff7676;padding:16px 0;text-align:center;">Failed to load log: ' + escHtml(e.message) + '</p>';
  }
}

/* ===== Clear log ===== */
async function clearLog() {
  if (!confirm("Clear entire activity log? This cannot be undone.")) return;
  try {
    var res = await fetch(
      SUPABASE.URL + "/rest/v1/admin_log?id=gte.0",
      { method: "DELETE", headers: { apikey: SUPABASE.KEY, Authorization: "Bearer " + SUPABASE.KEY } }
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    document.getElementById("logList").innerHTML = '<p class="loading-msg">Log cleared.</p>';
  } catch (e) { alert("Failed to clear log: " + e.message); }
}

/* ===== Export CSV ===== */
function exportCSV() {
  var rows = [["Rank", "Nickname", "Rating", "Δ7d", "Δ1d", "Group", "Status"]];
  var visible = st.players.filter(function(p) { return !st.hiddenNicks.has(p.nick); });
  visible.forEach(function(p, i) {
    var d7 = calcDelta(p.series, 7);
    var d1 = calcDelta(p.series, 1);
    var grp = p.rating != null ? getGroup(p.rating).name : "—";
    rows.push([
      i + 1, p.nick,
      p.rating != null ? Number(p.rating).toFixed(1) : "—",
      d7 != null ? (d7 > 0 ? "+" : "") + d7.toFixed(1) : "—",
      d1 != null ? (d1 > 0 ? "+" : "") + d1.toFixed(1) : "—",
      grp, "Visible",
    ]);
  });
  var csv = rows.map(function(r) {
    return r.map(function(c) {
      var s = String(c);
      return (s.includes(",") || s.includes('"') || s.includes("\n")) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",");
  }).join("\n");
  var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "esb_leaderboard_" + new Date().toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

/* ===== Dashboard ===== */
function renderDashboard() {
  var sec = document.getElementById("sectionDashboard");
  if (!sec) return;

  var total   = st.players.length;
  var hidden  = st.hiddenNicks.size;
  var visible = total - hidden;
  var achCount = st.achievements.length;
  var totalBadges = Object.values(st.playerAchievements).reduce(function(s, set) { return s + set.size; }, 0);

  var ratings = st.players
    .filter(function(p) { return !st.hiddenNicks.has(p.nick) && p.rating != null; })
    .map(function(p) { return p.rating; });
  var avgRating = ratings.length ? (ratings.reduce(function(s, r) { return s + r; }, 0) / ratings.length).toFixed(1) : "—";
  var maxRating = ratings.length ? Math.max.apply(null, ratings).toFixed(1) : "—";

  var withDelta = st.players
    .filter(function(p) { return p.series && p.series.length > 1; })
    .map(function(p) { return { nick: p.nick, delta7: calcDelta(p.series, 7) }; });

  var gainers = withDelta.filter(function(p) { return p.delta7 != null && p.delta7 > 0; })
    .sort(function(a, b) { return b.delta7 - a.delta7; }).slice(0, 5);
  var losers  = withDelta.filter(function(p) { return p.delta7 != null && p.delta7 < 0; })
    .sort(function(a, b) { return a.delta7 - b.delta7; }).slice(0, 5);

  var groupDist = GROUPS.map(function(g) {
    var cnt = st.players.filter(function(p) {
      return !st.hiddenNicks.has(p.nick) && p.rating != null && getGroup(p.rating).name === g.name;
    }).length;
    return { name: g.name, color: g.color, count: cnt };
  }).filter(function(g) { return g.count > 0; });

  function moverHtml(list, isGain) {
    if (!list.length) return '<p class="loading-msg" style="padding:6px 0;">No data</p>';
    return list.map(function(p, i) {
      var color = isGain ? "#52d18a" : "#ff7676";
      var sign  = isGain ? "+" : "";
      return '<div class="mover-row">' +
        '<span class="mover-rank">' + (i + 1) + '</span>' +
        '<span class="mover-nick">' + escHtml(p.nick) + '</span>' +
        '<span class="mover-delta" style="color:' + color + '">' + sign + p.delta7.toFixed(1) + '</span>' +
        '</div>';
    }).join("");
  }

  sec.innerHTML =
    '<div class="dash-grid">' +
      '<div class="dash-card"><div class="dash-card-val">' + visible + '</div><div class="dash-card-label">Visible players</div></div>' +
      '<div class="dash-card"><div class="dash-card-val" style="color:#ff7676">' + hidden + '</div><div class="dash-card-label">Hidden players</div></div>' +
      '<div class="dash-card"><div class="dash-card-val">' + avgRating + '</div><div class="dash-card-label">Avg rating</div></div>' +
      '<div class="dash-card"><div class="dash-card-val">' + maxRating + '</div><div class="dash-card-label">Top rating</div></div>' +
      '<div class="dash-card"><div class="dash-card-val">' + achCount + '</div><div class="dash-card-label">Achievements</div></div>' +
      '<div class="dash-card"><div class="dash-card-val">' + totalBadges + '</div><div class="dash-card-label">Badges assigned</div></div>' +
    '</div>' +
    '<p class="dash-h3">📈 Top gainers (7 days)</p>' + moverHtml(gainers, true) +
    '<p class="dash-h3">📉 Top losers (7 days)</p>'  + moverHtml(losers, false) +
    '<p class="dash-h3">🎮 Group distribution</p>' +
    '<div>' +
    groupDist.map(function(g) {
      var pct = visible > 0 ? Math.round(g.count / visible * 100) : 0;
      return '<div class="group-bar-row">' +
        '<span class="group-bar-dot" style="background:' + g.color + '"></span>' +
        '<span class="group-bar-name">' + escHtml(g.name) + '</span>' +
        '<div class="group-bar-track"><div class="group-bar-fill" style="width:' + pct + '%;background:' + g.color + '"></div></div>' +
        '<span class="group-bar-count">' + g.count + '</span>' +
        '</div>';
    }).join("") +
    '</div>';
}

/* ===== Boot ===== */
loginBtn.addEventListener("click", tryLogin);
if (emailInput) emailInput.addEventListener("keydown", function(e) { if (e.key === "Enter") passwordInput.focus(); });
passwordInput.addEventListener("keydown", function(e) { if (e.key === "Enter") tryLogin(); });
if (logoutBtn) logoutBtn.addEventListener("click", logout);
if (adminSearch) adminSearch.addEventListener("input", debounce(function() {
  st.searchQuery = adminSearch.value; renderList();
}, 120));

document.addEventListener("DOMContentLoaded", function() {
  /* Tab buttons */
  var tabPlayers = document.getElementById("tabPlayers");
  var tabAch     = document.getElementById("tabAchievements");
  var tabDash    = document.getElementById("tabDashboard");
  var tabLog     = document.getElementById("tabLog");
  if (tabPlayers) tabPlayers.addEventListener("click", function() { switchTab("players"); });
  if (tabAch)     tabAch.addEventListener("click",     function() { switchTab("achievements"); });
  if (tabDash)    tabDash.addEventListener("click",    function() { switchTab("dashboard"); });
  if (tabLog)     tabLog.addEventListener("click",     function() { switchTab("log"); });

  /* Export CSV button */
  var exportBtn = document.getElementById("exportCsvBtn");
  if (exportBtn) exportBtn.addEventListener("click", exportCSV);

  /* Clear log button */
  var clearLogBtnEl = document.getElementById("clearLogBtn");
  if (clearLogBtnEl) clearLogBtnEl.addEventListener("click", clearLog);

  /* New achievement form */
  var addAchBtn    = document.getElementById("addAchBtn");
  var addAchForm   = document.getElementById("addAchForm");
  var achSaveBtn   = document.getElementById("achSaveBtn");
  var achCancelBtn = document.getElementById("achCancelBtn");
  var achIconInput = document.getElementById("achIconInput");
  var achIconName  = document.getElementById("achIconName");

  if (addAchBtn) addAchBtn.addEventListener("click", function() {
    addAchForm.style.display = addAchForm.style.display === "none" ? "flex" : "none";
  });
  if (achCancelBtn) achCancelBtn.addEventListener("click", function() {
    addAchForm.style.display = "none";
    document.getElementById("achNameInput").value = "";
    document.getElementById("achUrlInput").value = "";
    achIconInput.value = ""; achIconName.textContent = "No file";
  });
  if (achIconInput) achIconInput.addEventListener("change", function() {
    achIconName.textContent = achIconInput.files[0] ? achIconInput.files[0].name : "No file";
  });
  if (achSaveBtn) achSaveBtn.addEventListener("click", function() {
    var name = document.getElementById("achNameInput").value.trim();
    var url  = document.getElementById("achUrlInput").value.trim();
    var file = achIconInput.files[0];
    if (!name) { alert("Enter achievement name."); return; }
    if (!file) { alert("Choose an icon image."); return; }
    createAchievement(name, url, file);
  });
});

if (getCookie(ADMIN_CFG.COOKIE)) {
  st.adminEmail = getCookie("esb_admin_email") || "";
  enterPanel();
} else {
  if (emailInput) emailInput.focus();
}
