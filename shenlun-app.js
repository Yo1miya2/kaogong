"use strict";

const SL = window.SHENLUN || [];
const SL_KEY = "kg.shenlun";

function getSL() {
  try { return JSON.parse(localStorage.getItem(SL_KEY)) || {}; } catch (e) { return {}; }
}
function setSL(o) {
  localStorage.setItem(SL_KEY, JSON.stringify(o));
  push();
}

function isServer() {
  return location.protocol === "http:" || location.protocol === "https:";
}
function fullFlat() {
  const o = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("kg.")) o[k] = localStorage.getItem(k);
  }
  return o;
}
function restoreFlat(o) {
  if (!o) return;
  Object.keys(o).forEach((k) => { if (k.startsWith("kg.")) localStorage.setItem(k, o[k]); });
}
function fullObj() {
  const j = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || d); } catch (e) { return d; } };
  return {
    progress: j("kg.progress", "{}"),
    favs: j("kg.favs", "[]"),
    exams: j("kg.exams", "[]"),
    settings: j("kg.settings", "null"),
    shenlun: getSL(),
  };
}
function restoreObj(d) {
  if (!d || typeof d !== "object") return;
  if (d.progress) localStorage.setItem("kg.progress", JSON.stringify(d.progress));
  if (Array.isArray(d.favs)) localStorage.setItem("kg.favs", JSON.stringify(d.favs));
  if (Array.isArray(d.exams)) localStorage.setItem("kg.exams", JSON.stringify(d.exams));
  if (d.settings) localStorage.setItem("kg.settings", JSON.stringify(d.settings));
  if (d.shenlun) localStorage.setItem(SL_KEY, JSON.stringify(d.shenlun));
}
function supCfg() {
  try { return JSON.parse(localStorage.getItem("kg.settings") || "{}"); } catch (e) { return {}; }
}
async function supGet() {
  const s = supCfg();
  if (!s.supabaseUrl || !s.supabaseKey) return null;
  const r = await fetch(s.supabaseUrl.replace(/\/+$/, "") + "/rest/v1/kg_data?select=data&id=eq.me", {
    headers: { apikey: s.supabaseKey, Authorization: "Bearer " + s.supabaseKey },
  });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows && rows[0] && rows[0].data;
}
function supPut(obj) {
  const s = supCfg();
  if (!s.supabaseUrl || !s.supabaseKey) return;
  fetch(s.supabaseUrl.replace(/\/+$/, "") + "/rest/v1/kg_data?id=eq.me", {
    method: "PUT",
    headers: {
      apikey: s.supabaseKey,
      Authorization: "Bearer " + s.supabaseKey,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ id: "me", data: obj }),
  }).catch(() => {});
}

let _t = null;
function push() {
  clearTimeout(_t);
  _t = setTimeout(() => {
    const s = supCfg();
    if (s.supabaseUrl && s.supabaseKey) supPut(fullObj());
    else if (isServer()) {
      fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fullFlat()),
      }).catch(() => {});
    }
  }, 400);
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 1600);
}

let currentId = null;

function renderList() {
  const data = getSL();
  const zhuan = SL.filter((e) => e.type === "专项");
  const tao = SL.filter((e) => e.type === "套题");
  const btn = (e) => {
    const d = data[e.id] || {};
    let done = 0;
    e.questions.forEach((q) => { if (d[q.num] && d[q.num].done) done++; });
    return `<button class="sl-item ${e.id === currentId ? "on" : ""}" data-id="${e.id}">
      ${esc(e.title.slice(0, 22))}${e.title.length > 22 ? "…" : ""}
      <span style="opacity:.55"> ${done}/${e.questions.length}</span>
    </button>`;
  };
  document.getElementById("sl-list").innerHTML =
    `<h2>专项练习</h2>` + zhuan.map(btn).join("") +
    `<h2>套题刷题</h2>` + tao.map(btn).join("");
  document.querySelectorAll(".sl-item").forEach((b) => {
    b.addEventListener("click", () => { currentId = b.dataset.id; renderList(); renderMain(); });
  });
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function renderMain() {
  const e = SL.find((x) => x.id === currentId) || SL[0];
  if (!e) { document.getElementById("sl-main").innerHTML = `<div class="empty">暂无申论数据</div>`; return; }
  currentId = e.id;
  const data = getSL();
  const mats = e.materials.map((m) => `
    <details class="q-material"><summary>${esc(m.label)}</summary><div style="white-space:pre-wrap">${esc(m.text)}</div></details>`).join("");
  const qs = e.questions.map((q) => {
    const d = (data[e.id] && data[e.id][q.num]) || {};
    return `<div class="sl-q">
      <h3>${esc(q.num)}</h3>
      <p class="qt">${esc(q.text)}</p>
      <textarea data-id="${e.id}" data-num="${esc(q.num)}" placeholder="在这里写你的答案…">${esc(d.answer || "")}</textarea>
      <label class="done-row"><input type="checkbox" data-done="${e.id}" data-num="${esc(q.num)}" ${d.done ? "checked" : ""}> 标记为已做</label>
    </div>`;
  }).join("");
  document.getElementById("sl-main").innerHTML = `
    <h1 class="sl-title">${esc(e.title)}</h1>
    <p class="sl-meta">${e.type === "套题" ? "完整申论套题" : "专项练习"} · ${e.questions.length} 道题 · ${e.materials.length} 段材料</p>
    ${mats}
    ${qs}`;

  document.querySelectorAll("textarea[data-id]").forEach((ta) => {
    ta.addEventListener("input", () => {
      const d = getSL();
      if (!d[e.id]) d[e.id] = {};
      if (!d[e.id][ta.dataset.num]) d[e.id][ta.dataset.num] = {};
      d[e.id][ta.dataset.num].answer = ta.value;
      setSL(d);
    });
  });
  document.querySelectorAll("input[data-done]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const d = getSL();
      if (!d[e.id]) d[e.id] = {};
      if (!d[e.id][cb.dataset.num]) d[e.id][cb.dataset.num] = {};
      d[e.id][cb.dataset.num].done = cb.checked;
      setSL(d);
      renderList();
    });
  });
}

(async () => {
  const s = supCfg();
  if (s.supabaseUrl && s.supabaseKey) {
    const d = await supGet().catch(() => null);
    if (d) restoreObj(d);
  } else if (isServer()) {
    const r = await fetch("/api/data", { cache: "no-store" }).catch(() => null);
    if (r && r.ok) {
      const d = await r.json().catch(() => null);
      if (d && Object.keys(d).length) restoreFlat(d);
    }
  }
  renderList();
  renderMain();
})();
