"use strict";

const QS = window.QUESTIONS || [];
const byId = new Map(QS.map((q) => [q.id, q]));
const SECTION_ORDER = ["政治理论", "常识判断", "言语理解与表达", "数量关系", "判断推理", "资料分析"];
const SECTION_SHORT = {
  "政治理论": "政治", "常识判断": "常识", "言语理解与表达": "言语",
  "数量关系": "数量", "判断推理": "判断", "资料分析": "资料",
};
const DIFF_LABEL = { 1: "易", 2: "中", 3: "难" };
const SLOW_MS = 120000; // 单题超过 2 分钟算“耗时”

/* ---------------- storage ---------------- */
const DB = {
  get(k, d) {
    try {
      const v = localStorage.getItem("kg." + k);
      return v == null ? d : JSON.parse(v);
    } catch (e) { return d; }
  },
  set(k, v) {
    localStorage.setItem("kg." + k, JSON.stringify(v));
    schedulePush();
  },
};

function isServerMode() {
  return location.protocol === "http:" || location.protocol === "https:";
}

function fullState() {
  const o = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("kg.")) o[k] = localStorage.getItem(k);
  }
  return o;
}

function restoreState(o) {
  if (!o) return;
  Object.keys(o).forEach((k) => {
    if (k.startsWith("kg.")) localStorage.setItem(k, o[k]);
  });
}

function fullStateObj() {
  return {
    progress: DB.get("progress", {}),
    favs: DB.get("favs", []),
    exams: DB.get("exams", []),
    settings: DB.get("settings", null),
    shenlun: DB.get("shenlun", {}),
  };
}

function restoreStateObj(o) {
  if (!o || typeof o !== "object") return;
  if (o.progress && typeof o.progress === "object") {
    localStorage.setItem("kg.progress", JSON.stringify(o.progress));
  }
  if (Array.isArray(o.favs)) localStorage.setItem("kg.favs", JSON.stringify(o.favs));
  if (Array.isArray(o.exams)) localStorage.setItem("kg.exams", JSON.stringify(o.exams));
  if (o.settings && typeof o.settings === "object") {
    localStorage.setItem("kg.settings", JSON.stringify(o.settings));
  }
  if (o.shenlun && typeof o.shenlun === "object") {
    localStorage.setItem("kg.shenlun", JSON.stringify(o.shenlun));
  }
}

function supabaseBase() {
  const s = DB.get("settings", {});
  return (s.supabaseUrl || "").replace(/\/+$/, "");
}

async function supabaseGet() {
  const s = DB.get("settings", {});
  if (!s.supabaseUrl || !s.supabaseKey) return null;
  const r = await fetch(supabaseBase() + "/rest/v1/kg_data?select=data&id=eq.me", {
    headers: { apikey: s.supabaseKey, Authorization: "Bearer " + s.supabaseKey },
  });
  if (!r.ok) throw new Error("supabase get " + r.status);
  const rows = await r.json();
  return rows && rows[0] && rows[0].data;
}

async function supabasePut(obj) {
  const s = DB.get("settings", {});
  if (!s.supabaseUrl || !s.supabaseKey) return;
  const r = await fetch(supabaseBase() + "/rest/v1/kg_data?id=eq.me", {
    method: "PUT",
    headers: {
      apikey: s.supabaseKey,
      Authorization: "Bearer " + s.supabaseKey,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ id: "me", data: obj }),
  });
  if (!r.ok) throw new Error("supabase put " + r.status);
}

let _pushTimer = null;
function schedulePush() {
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(async () => {
    const s = DB.get("settings", {});
    if (s.supabaseUrl && s.supabaseKey) {
      supabasePut(fullStateObj()).catch(() => {});
    } else if (isServerMode()) {
      fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fullState()),
      }).catch(() => {});
    }
  }, 400);
}

async function bootSync() {
  const s = DB.get("settings", {});
  if (s.supabaseUrl && s.supabaseKey) {
    try {
      const d = await supabaseGet();
      if (d) restoreStateObj(d);
    } catch (e) {}
  } else if (isServerMode()) {
    try {
      const r = await fetch("/api/data", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      if (d && Object.keys(d).length) restoreState(d);
    } catch (e) {}
  }
}

function getProgress() { return DB.get("progress", {}); }
function setProgress(p) { DB.set("progress", p); }
function getSettings() {
  return DB.get("settings", { guokao: "2026-11-29", jiangsu: "2026-12-06" });
}
function setSettings(s) { DB.set("settings", s); }
function getFavs() { return DB.get("favs", []); }
function getExams() { return DB.get("exams", []); }

/* ---------------- utils ---------------- */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function renderText(s) {
  if (!s) return "";
  const lines = String(s).split("\n");
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (!ln) { out += "<br>"; continue; }
    const prev = i > 0 ? lines[i - 1].trim() : "";
    const needBreak = i > 0 && (
      /[。！？；：）]$/.test(prev) || /^[①②③④⑤⑥⑦⑧⑨⑩]/.test(ln)
    );
    out += (needBreak ? "<br>" : "") + esc(ln);
  }
  return out;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d - today) / 86400000);
}

function fmtCountdown(dateStr) {
  const n = daysUntil(dateStr);
  if (n == null) return "—";
  if (n < 0) return "已过";
  return "还剩 " + n + " 天";
}

function qTag(q) {
  if (q.set) return "第 " + q.set + " 套 · 第 " + q.num + " 题";
  if (q.paper) {
    return q.paper.replace(/（网友回忆题目）?/g, "").replace(/\(.*\)/g, "").trim() + " · 第 " + q.num + " 题";
  }
  return "第 " + q.num + " 题";
}

function qShort(q) {
  if (q.set) return "第" + q.set + "套·" + q.num;
  const p = q.paper ? q.paper.replace(/（网友回忆题目）?/g, "").replace(/\(.*\)/g, "").trim() : "";
  return (p ? p.slice(0, 10) : "") + "·" + q.num;
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2200);
}

function pct(part, whole) {
  return whole ? Math.round((part / whole) * 100) : 0;
}

/* ---------------- derived stats ---------------- */
function collectStats() {
  const progress = getProgress();
  let answered = 0, correct = 0, skipped = 0;
  const wrong = [], slow = [];
  const bySection = {};
  SECTION_ORDER.forEach((s) => (bySection[s] = { answered: 0, correct: 0, slow: 0, total: 0 }));
  let favs = new Set(getFavs());

  QS.forEach((q) => {
    const sec = bySection[q.section] || (bySection[q.section] = { answered: 0, correct: 0, slow: 0, total: 0 });
    sec.total++;
    const p = progress[q.id];
    if (!p) return;
    if (p.skip) { skipped++; return; }
    if (p.choice) {
      answered++;
      sec.answered++;
      if (p.correct) { correct++; sec.correct++; }
      else { wrong.push(q.id); }
      if (p.ms && p.ms >= SLOW_MS) { slow.push(q.id); sec.slow++; }
    }
  });
  return { answered, correct, wrong, slow, skipped, bySection, favs };
}

/* ---------------- question renderer ---------------- */
function hasRealOptions(q) {
  const opts = q.options || [];
  if (!opts.length) return false;
  return opts.some((o) => (o.text && !/^见(图|上图|下图|左图|右图|示意图)?$/.test(String(o.text).trim())) || o.image);
}

function isUnrecognized(q) {
  return String(q.note || "").includes("无法识别");
}

function questionHTML(q, state) {
  const p = state.progress[q.id] || {};
  let html = "";
  if (q.material) {
    let mat = "";
    if (typeof q.material === "string") {
      mat = renderText(q.material);
    } else if (q.material && typeof q.material === "object") {
      mat = renderText(q.material.text || "") + (q.material.image ? `<img src="${esc(q.material.image)}" alt="材料配图" />` : "");
    }
    html += `<details class="q-material"><summary>阅读材料</summary><div>${mat}</div></details>`;
  }
  html += `<div class="q-meta">`;
  html += `<span class="tag">${esc(q.section)}</span>`;
  html += `<span class="tag">${esc(qTag(q))}</span>`;
  html += `<span class="tag">${esc(q.source || "")}</span>`;
  if (isUnrecognized(q)) {
    html += `<span class="tag figure">扫描题 · 暂无配图</span>`;
  } else if (q.hasFigure || q.note) {
    html += `<span class="tag figure">图片题：请对照原卷 PDF 第 ${q.page} 页</span>`;
  }
  html += `</div>`;
  html += `<p class="q-stem">${renderText(q.stem)}</p>`;
  if (q.stem_image) {
    html += `<div class="q-figure"><img class="q-img" src="${esc(q.stem_image)}" alt="题干配图" /></div>`;
  }
  if (q.figureDesc) {
    html += `<div class="q-figure">${renderText(q.figureDesc)}</div>`;
  }

  if (isUnrecognized(q)) {
    html += `<div class="q-material unrecognized">【原卷扫描题】由于原卷是扫描件无法定位，请对照原卷 PDF 查看（或跳至下一题）。</div>`;
  } else if (hasRealOptions(q)) {
    html += `<div class="options">`;
    q.options.forEach((o) => {
      let cls = "opt";
      if (state.revealed) {
        if (o.key === q.answer) cls += " correct";
        else if (o.key === state.choice) cls += " wrong";
        else cls += " dim";
      }
      const disabled = state.revealed ? "disabled" : "";
      html += `<button class="${cls}" data-key="${o.key}" ${disabled}>
        <span class="opt-key">${esc(o.key)}</span>
        <span>${renderText(o.text)}${o.image ? `<img class="q-img" src="${esc(o.image)}" alt="选项 ${esc(o.key)} 图" />` : ""}</span>
      </button>`;
    });
    html += `</div>`;
  } else if (q.answer) {
    const hint = q.stem_image
      ? "本题为合并截图，请看上方整题图片后作答。"
      : `本题选项为图形，无法在网页显示。请打开原卷 PDF 第 ${q.page} 页查看图形后作答。`;
    html += `<div class="q-material">${hint}</div>`;
    html += `<div class="field"><label>手动填答案（A / B / C / D）</label>
      <input type="text" id="manual-answer" maxlength="4" style="text-transform:uppercase" /></div>`;
    html += `<div class="btn-row"><button class="btn primary" id="submit-manual">提交</button></div>`;
  }
  return html;
}

function explanationHTML(q, state) {
  if (!state.revealed) return "";
  const ok = state.choice === q.answer;
  const verdict = ok
    ? `<p class="verdict ok">回答正确</p>`
    : `<p class="verdict no">回答错误 · 正确答案 ${esc(q.answer)}</p>`;
  const body = q.explanation ? renderText(q.explanation) : "本题为真题，暂无文字解析，答案仅供参考。";
  return `<div class="explain">
    <div class="explain-title">解析</div>
    ${verdict}
    <div>${body}</div>
  </div>`;
}

/* ---------------- router ---------------- */
const views = {
  dashboard: renderDashboard,
  practice: renderPractice,
  exam: renderExam,
  wrong: renderWrong,
  fav: renderFav,
  stats: renderStats,
  settings: renderSettings,
};

function navigate(name) {
  document.querySelectorAll(".nav-item").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.view === name);
  });
  clearInterval(window._timerId);
  views[name]();
  window.scrollTo(0, 0);
}

document.querySelectorAll(".nav-item").forEach((b) => {
  b.addEventListener("click", () => navigate(b.dataset.view));
});
const shenlunBtn = document.getElementById("nav-shenlun");
if (shenlunBtn) shenlunBtn.addEventListener("click", () => { location.href = "shenlun.html"; });

function updateSideCountdown() {
  const s = getSettings();
  document.getElementById("side-countdown").textContent =
    "国考 " + fmtCountdown(s.guokao) + " · 省考 " + fmtCountdown(s.jiangsu);
}

/* ---------------- dashboard ---------------- */
function renderDashboard() {
  const s = getSettings();
  const st = collectStats();
  const guokao = daysUntil(s.guokao);
  const jiangsu = daysUntil(s.jiangsu);
  const total = QS.length;
  const acc = pct(st.correct, st.answered);
  const unrec = QS.filter((q) => isUnrecognized(q)).length;

  const main = document.getElementById("main");
  main.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">仪表盘</h1>
      <p class="page-desc">先保分，再提分。把会做的做对、做快，难题果断跳过。</p>
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>考试倒计时</h3>
        <div class="countdown-big">国考 ${fmtCountdown(s.guokao)}</div>
        <div class="countdown-big" style="margin-top:8px">江苏省考 ${fmtCountdown(s.jiangsu)}</div>
        <p class="small muted" style="margin-top:10px">倒计时日期可在「设置」中修改。</p>
      </div>
      <div class="card">
        <h3>总体进度</h3>
        <div class="grid-3">
          <div><div class="stat-num">${st.answered}<span class="small muted"> / ${total}</span></div><div class="stat-label">已作答</div></div>
          <div><div class="stat-num">${acc}%</div><div class="stat-label">正确率</div></div>
          <div><div class="stat-num">${st.wrong.length}</div><div class="stat-label">错题</div></div>
          <div style="margin-top:8px"><div class="stat-num">${st.slow.length}</div><div class="stat-label">耗时题</div></div>
          <div style="margin-top:8px"><div class="stat-num">${st.skipped}</div><div class="stat-label">已跳过</div></div>
          <div style="margin-top:8px"><div class="stat-num">${st.favs.size}</div><div class="stat-label">收藏</div></div>
          <div style="margin-top:8px"><div class="stat-num">${unrec}</div><div class="stat-label">暂缺配图</div></div>
        </div>
        ${unrec ? `<p class="small muted" style="margin-top:10px">有 ${unrec} 道扫描题暂无配图，刷题时已默认跳过（可在「专项刷题」里取消跳过）。</p>` : ""}
      </div>
    </div>

    <div class="card">
      <h3>各模块正确率</h3>
      ${SECTION_ORDER.map((sec) => {
        const d = st.bySection[sec] || { answered: 0, correct: 0 };
        const a = pct(d.correct, d.answered);
        return `<div class="bar-row">
          <div class="bar-label">${sec}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${a}%"></div></div>
          <div class="bar-value">${a}% · ${d.answered}/${d.total}</div>
        </div>`;
      }).join("")}
    </div>

    <div class="card">
      <h3>六周冲刺路线（时间不固定也能用）</h3>
      <p class="small" style="max-width:72ch;line-height:1.9">
        你的情况：资料分析、数量关系已学完课程，言语、判断、常识、申论还没系统学；
        国考还剩 <b>${guokao}</b> 天，江苏省考随后。时间按「有多少做多少」，但顺序按下面的优先级来。
      </p>
      <div class="small" style="max-width:72ch;line-height:1.9">
        <p style="margin:0 0 8px"><b>① 现在到 10 月底 · 补最大头</b>：主攻言语理解、判断推理的方法课
        （这两块加起来 65 题、占行测一半），同时资料分析每天 15 题保持手感。</p>
        <p style="margin:0 0 8px"><b>② 11 月上半月 · 刷题强化</b>：按模块刷「言语 20 + 判断 20 + 资料 15」，
        错题当天重做；周末做一套整卷模拟。</p>
        <p style="margin:0 0 8px"><b>③ 11 月下半月 · 冲刺</b>：每周 2～3 套整卷限时模拟，练时间分配；
        政治理论和常识用碎片时间刷；数量关系只做会做的。</p>
        <p style="margin:0 0 12px"><b>④ 申论</b>：不占大块时间，每周固定几次看理论 + 练一道题的结构框架即可，
        提分主力放在行测。</p>
      </div>
      <h3>今天如果只有零散时间，按这个顺序</h3>
      <ol class="small" style="max-width:72ch;line-height:1.9;padding-left:1.2em">
        <li>先做 <b>言语 20 题 + 判断 20 题</b>（占分最多，你最需要补）。</li>
        <li>有富余再做 <b>资料分析 15 题</b>（你学过，别丢手感）。</li>
        <li>睡前刷 <b>常识 / 政治 10 题</b>。</li>
        <li>周末挤 2 小时做 <b>一套整卷模拟</b>。</li>
      </ol>
      <div class="btn-row">
        <button class="btn primary" onclick="navigate('practice')">开始专项刷题</button>
        <button class="btn" onclick="navigate('exam')">去做一套模拟</button>
      </div>
    </div>`;
}

/* ---------------- practice ---------------- */
let prac = null;

function renderPractice() {
  if (!prac) {
    renderPracticeSetup();
    return;
  }
  renderPracticeQuestion();
}

function renderPracticeSetup() {
  const main = document.getElementById("main");
  main.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">专项刷题</h1>
      <p class="page-desc">逐题作答、立即看解析。不会的就点「跳过」，不浪费时间。</p>
    </div>
    <div class="card">
      <h3>选择模块</h3>
      <div class="btn-row" id="sec-picker"></div>
      <div class="field" style="margin-top:18px">
        <label>题目来源</label>
        <div class="btn-row" id="mode-picker"></div>
      </div>
      <label style="display:flex;gap:8px;align-items:center;font-size:14px;margin-top:6px">
        <input type="checkbox" id="include-figure" />
        <span>包含图片题（图形推理等，需对照原卷 PDF）</span>
      </label>
      <label style="display:flex;gap:8px;align-items:center;font-size:14px;margin-top:6px">
        <input type="checkbox" id="skip-unrec" checked />
        <span>跳过无法识别的扫描题（暂无配图）</span>
      </label>
      <div class="btn-row">
        <button class="btn primary" id="start-practice">开始</button>
      </div>
    </div>`;

  const secPicker = document.getElementById("sec-picker");
  let chosenSection = "全部";
  const secs = ["全部", ...SECTION_ORDER];
  secs.forEach((sec) => {
    const b = document.createElement("button");
    b.className = "btn" + (sec === chosenSection ? " primary" : "");
    b.textContent = sec;
    b.addEventListener("click", () => {
      chosenSection = sec;
      secPicker.querySelectorAll(".btn").forEach((x) => x.classList.remove("primary"));
      b.classList.add("primary");
    });
    secPicker.appendChild(b);
  });

  let chosenMode = "order";
  const modes = [["order", "顺序练习"], ["random", "随机练习"], ["new", "只做没做过的"], ["wrong", "只做错题"]];
  const modePicker = document.getElementById("mode-picker");
  modes.forEach(([val, label]) => {
    const b = document.createElement("button");
    b.className = "btn" + (val === chosenMode ? " primary" : "");
    b.textContent = label;
    b.addEventListener("click", () => {
      chosenMode = val;
      modePicker.querySelectorAll(".btn").forEach((x) => x.classList.remove("primary"));
      b.classList.add("primary");
    });
    modePicker.appendChild(b);
  });

  document.getElementById("start-practice").addEventListener("click", () => {
    const includeFigure = document.getElementById("include-figure").checked;
    const skipUnrec = document.getElementById("skip-unrec").checked;
    const progress = getProgress();
    let pool = QS.slice();
    if (chosenSection !== "全部") pool = pool.filter((q) => q.section === chosenSection);
    if (!includeFigure) pool = pool.filter((q) => !q.hasFigure);
    if (skipUnrec) pool = pool.filter((q) => !isUnrecognized(q));
    if (chosenMode === "new") pool = pool.filter((q) => !progress[q.id] || !progress[q.id].choice);
    if (chosenMode === "wrong") pool = pool.filter((q) => progress[q.id] && progress[q.id].choice && !progress[q.id].correct);
    if (chosenMode === "random") pool = shuffle(pool);
    if (!pool.length) { toast("这个条件下没有题目了"); return; }
    prac = { list: pool.map((q) => q.id), idx: 0, startTs: Date.now() };
    renderPractice();
  });
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function currentPracQuestion() {
  return byId.get(prac.list[prac.idx]);
}

function renderPracticeQuestion() {
  const q = currentPracQuestion();
  const progress = getProgress();
  const p = progress[q.id] || {};
  const revealed = !!p.choice;
  const main = document.getElementById("main");
  main.innerHTML = `
    <div class="page-head" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div>
        <h1 class="page-title">专项刷题</h1>
        <p class="page-desc">第 ${prac.idx + 1} / ${prac.list.length} 题 · 已用时 <span id="timer" class="mono">0:00</span></p>
      </div>
      <div class="btn-row" style="margin:0">
        <button class="btn" id="btn-prev">上一题</button>
        <button class="btn" id="btn-skip">跳过</button>
        <button class="btn" id="btn-fav">${getFavs().includes(q.id) ? "★ 已收藏" : "☆ 收藏"}</button>
        <button class="btn primary" id="btn-next">下一题</button>
      </div>
    </div>
    <div class="card">
      ${questionHTML(q, { progress, revealed, choice: p.choice })}
      ${isUnrecognized(q) ? `<div class="btn-row"><button class="btn primary" id="btn-next-unrec">下一题</button></div>` : ""}
      ${explanationHTML(q, { revealed, choice: p.choice })}
      <div class="btn-row" id="diff-row">
        <span class="small muted" style="align-self:center">这题对你来说：</span>
        ${[1, 2, 3].map((d) => `<button class="btn ${p.diff === d ? "primary" : ""}" data-diff="${d}">${DIFF_LABEL[d]}</button>`).join("")}
      </div>
    </div>`;

  const start = Date.now();
  const timerEl = document.getElementById("timer");
  const t = setInterval(() => {
    const sec = Math.floor((Date.now() - start) / 1000);
    timerEl.textContent = Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }, 1000);
  window._timerId = t;

  function finish(choice, correct, skip) {
    clearInterval(t);
    const prog = getProgress();
    const prev = prog[q.id] || {};
    prog[q.id] = {
      ...prev,
      choice,
      correct,
      skip: !!skip,
      ts: Date.now(),
      ms: Date.now() - start,
    };
    setProgress(prog);
  }

  main.querySelectorAll(".opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (revealed) return;
      const choice = btn.dataset.key;
      const correct = choice === q.answer;
      finish(choice, correct, false);
      renderPracticeQuestion();
    });
  });

  const manual = document.getElementById("submit-manual");
  if (manual) {
    manual.addEventListener("click", () => {
      const val = (document.getElementById("manual-answer").value || "").trim().toUpperCase();
      if (!val) { toast("先输入答案"); return; }
      const correct = val === q.answer;
      finish(val, correct, false);
      renderPracticeQuestion();
    });
  }

  document.getElementById("btn-prev").addEventListener("click", () => {
    if (prac.idx > 0) { prac.idx--; renderPracticeQuestion(); }
  });
  document.getElementById("btn-next").addEventListener("click", () => {
    if (prac.idx < prac.list.length - 1) { prac.idx++; renderPracticeQuestion(); }
    else { toast("本组已完成"); prac = null; renderPracticeSetup(); }
  });
  function skipCurrent() {
    finish(null, false, true);
    if (prac.idx < prac.list.length - 1) { prac.idx++; renderPracticeQuestion(); }
    else { toast("本组已完成"); prac = null; renderPracticeSetup(); }
  }
  document.getElementById("btn-skip").addEventListener("click", skipCurrent);
  const nextUnrec = document.getElementById("btn-next-unrec");
  if (nextUnrec) nextUnrec.addEventListener("click", skipCurrent);
  document.getElementById("btn-fav").addEventListener("click", () => {
    const favs = getFavs();
    const i = favs.indexOf(q.id);
    if (i >= 0) favs.splice(i, 1); else favs.push(q.id);
    DB.set("favs", favs);
    renderPracticeQuestion();
  });
  document.querySelectorAll("#diff-row [data-diff]").forEach((b) => {
    b.addEventListener("click", () => {
      const prog = getProgress();
      const prev = prog[q.id] || {};
      prog[q.id] = { ...prev, diff: Number(b.dataset.diff) };
      setProgress(prog);
      renderPracticeQuestion();
    });
  });
}

/* ---------------- exam ---------------- */
let exam = null;

function renderExam() {
  const main = document.getElementById("main");
  if (!exam) {
    const last = getExams().slice(-1)[0];
    main.innerHTML = `
      <div class="page-head">
        <h1 class="page-title">模拟考试</h1>
        <p class="page-desc">整套 130 题 · 限时 120 分钟，练真实考场的时间分配。</p>
      </div>
      <div class="card">
        <h3>选择一套试卷</h3>
        <div class="btn-row">
          ${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<button class="btn" data-set="${n}">第 ${n} 套</button>`).join("")}
        </div>
        <p class="small muted" style="margin-top:14px">
          提示：每套约 10 道图形推理题是图片，网页里显示不了，可对照原卷 PDF 作答；没作答的题按错误计。
        </p>
      </div>
      <div class="card">
        <h3>历史成绩</h3>
        ${last ? examHistoryHTML() : `<div class="empty">还没有模拟记录。</div>`}
      </div>`;
    main.querySelectorAll("[data-set]").forEach((b) => {
      b.addEventListener("click", () => startExam(Number(b.dataset.set)));
    });
    return;
  }
  if (exam.submitted) { renderExamResult(); return; }
  renderExamQuestion();
}

function startExam(setNo) {
  const list = QS.filter((q) => q.set === setNo).sort((a, b) => a.num - b.num);
  if (!list.length) { toast("这套题没有数据"); return; }
  exam = {
    set: setNo,
    list,
    answers: {},
    flags: new Set(),
    idx: 0,
    startTs: Date.now(),
    deadline: Date.now() + 120 * 60000,
    submitted: false,
  };
  renderExam();
}

function examRemaining() {
  return Math.max(0, Math.floor((exam.deadline - Date.now()) / 1000));
}

function renderExamQuestion() {
  const q = exam.list[exam.idx];
  const main = document.getElementById("main");
  const remaining = examRemaining();
  main.innerHTML = `
    <div class="page-head">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          <h1 class="page-title">第 ${exam.set} 套 · 模拟考试</h1>
          <p class="page-desc">第 ${exam.idx + 1} / ${exam.list.length} 题 · 剩余 <span id="exam-timer" class="mono">${fmt(remaining)}</span></p>
        </div>
        <button class="btn primary" id="exam-submit">交卷</button>
      </div>
    </div>
    <div class="card">
      <div class="q-meta">
        <span class="tag">${esc(q.section)}</span>
        <span class="tag">第 ${q.num} 题</span>
        ${q.hasFigure ? `<span class="tag figure">图片题：请对照原卷 PDF 第 ${q.page} 页</span>` : ""}
      </div>
      ${q.material ? `<details class="q-material"><summary>阅读材料</summary><div>${renderText(q.material)}</div></details>` : ""}
      <p class="q-stem">${renderText(q.stem)}</p>
      <div class="options">
        ${(q.options || []).map((o) => {
          const chosen = exam.answers[q.num] === o.key;
          return `<button class="opt ${chosen ? "selected" : ""}" data-key="${o.key}">
            <span class="opt-key">${esc(o.key)}</span><span>${renderText(o.text)}</span>
          </button>`;
        }).join("") || `<div class="q-material">此题选项为图形，请对照原卷 PDF 第 ${q.page} 页查看。</div>`}
      </div>
      <div class="btn-row">
        <button class="btn" id="exam-prev">上一题</button>
        <button class="btn" id="exam-flag">${exam.flags.has(q.num) ? "★ 已标记" : "☆ 标记"}</button>
        <button class="btn" id="exam-next">下一题</button>
      </div>
      <h3 style="margin-top:20px">答题卡</h3>
      <div class="sheet">
        ${exam.list.map((x) => {
          const cls = ["sheet-cell"];
          if (exam.answers[x.num]) cls.push("done");
          if (exam.flags.has(x.num)) cls.push("flag");
          if (x.num === q.num) cls.push("current");
          return `<button class="${cls.join(" ")}" data-num="${x.num}">${x.num}</button>`;
        }).join("")}
      </div>
    </div>`;

  main.querySelectorAll(".opt").forEach((b) => {
    b.addEventListener("click", () => {
      exam.answers[q.num] = b.dataset.key;
      renderExamQuestion();
    });
  });
  main.querySelectorAll(".sheet-cell").forEach((b) => {
    b.addEventListener("click", () => {
      exam.idx = exam.list.findIndex((x) => x.num === Number(b.dataset.num));
      renderExamQuestion();
    });
  });
  document.getElementById("exam-prev").addEventListener("click", () => {
    if (exam.idx > 0) { exam.idx--; renderExamQuestion(); }
  });
  document.getElementById("exam-next").addEventListener("click", () => {
    if (exam.idx < exam.list.length - 1) { exam.idx++; renderExamQuestion(); }
  });
  document.getElementById("exam-flag").addEventListener("click", () => {
    if (exam.flags.has(q.num)) exam.flags.delete(q.num); else exam.flags.add(q.num);
    renderExamQuestion();
  });
  document.getElementById("exam-submit").addEventListener("click", () => {
    if (confirm("确定交卷吗？")) submitExam();
  });

  clearInterval(window._timerId);
  window._timerId = setInterval(() => {
    const el = document.getElementById("exam-timer");
    if (el) el.textContent = fmt(examRemaining());
    if (examRemaining() <= 0) submitExam();
  }, 1000);
}

function fmt(sec) {
  return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
}

function submitExam() {
  clearInterval(window._timerId);
  exam.submitted = true;
  // persist answers into progress
  const progress = getProgress();
  exam.list.forEach((q) => {
    const choice = exam.answers[q.num] || null;
    const prev = progress[q.id] || {};
    if (choice) {
      progress[q.id] = { ...prev, choice, correct: choice === q.answer, ts: Date.now(), ms: null, exam: true };
    }
  });
  setProgress(progress);
  const correct = exam.list.filter((q) => exam.answers[q.num] === q.answer).length;
  const bySection = {};
  exam.list.forEach((q) => {
    const sec = bySection[q.section] || (bySection[q.section] = { t: 0, c: 0 });
    sec.t++;
    if (exam.answers[q.num] === q.answer) sec.c++;
  });
  const exams = getExams();
  exams.push({ set: exam.set, date: Date.now(), correct, total: exam.list.length, bySection });
  DB.set("exams", exams);
  renderExamResult();
}

function renderExamResult() {
  const main = document.getElementById("main");
  const last = getExams().slice(-1)[0];
  const acc = pct(last.correct, last.total);
  main.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">第 ${last.set} 套 · 成绩单</h1>
      <p class="page-desc">${new Date(last.date).toLocaleString()}</p>
    </div>
    <div class="card">
      <div class="grid-3">
        <div><div class="stat-num">${last.correct}<span class="small muted"> / ${last.total}</span></div><div class="stat-label">答对</div></div>
        <div><div class="stat-num">${acc}%</div><div class="stat-label">正确率</div></div>
        <div><div class="stat-num">${last.total - last.correct}</div><div class="stat-label">答错/未答</div></div>
      </div>
      <h3 style="margin-top:20px">分模块</h3>
      ${SECTION_ORDER.map((sec) => {
        const d = last.bySection[sec];
        if (!d) return "";
        return `<div class="bar-row">
          <div class="bar-label">${sec}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct(d.c, d.t)}%"></div></div>
          <div class="bar-value">${d.c}/${d.t}</div>
        </div>`;
      }).join("")}
    </div>
    <div class="card">
      <h3>逐题回看</h3>
      <div class="sheet">
        ${exam.list.map((q) => {
          const cls = ["sheet-cell"];
          if (exam.answers[q.num]) cls.push("done");
          if (exam.flags.has(q.num)) cls.push("flag");
          return `<button class="${cls.join(" ")}" data-num="${q.num}">${q.num}</button>`;
        }).join("")}
      </div>
      <div class="btn-row">
        <button class="btn" id="exam-back">返回模拟考试首页</button>
      </div>
    </div>`;

  // review click goes to a focused review
  main.querySelectorAll(".sheet-cell").forEach((b) => {
    b.addEventListener("click", () => {
      const q = exam.list.find((x) => x.num === Number(b.dataset.num));
      reviewQuestion(q);
    });
  });
  document.getElementById("exam-back").addEventListener("click", () => {
    exam = null;
    renderExam();
  });
}

function reviewQuestion(q) {
  const choice = exam.answers[q.num] || null;
  const revealed = true;
  const main = document.getElementById("main");
  main.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">第 ${exam.set} 套 · 第 ${q.num} 题</h1>
      <p class="page-desc">${esc(q.section)}</p>
    </div>
    <div class="card">
      ${questionHTML(q, { progress: {}, revealed, choice })}
      ${explanationHTML(q, { revealed, choice })}
      <div class="btn-row"><button class="btn" id="review-back">返回成绩单</button></div>
    </div>`;
  document.getElementById("review-back").addEventListener("click", renderExamResult);
}

function examHistoryHTML() {
  const exams = getExams().slice().reverse();
  return `<table class="tbl">
    <tr><th>时间</th><th>试卷</th><th>得分</th><th>正确率</th></tr>
    ${exams.map((e) => `<tr>
      <td>${new Date(e.date).toLocaleDateString()}</td>
      <td>第 ${e.set} 套</td>
      <td>${e.correct}/${e.total}</td>
      <td>${pct(e.correct, e.total)}%</td>
    </tr>`).join("")}
  </table>`;
}

/* ---------------- wrong / fav / stats / settings ---------------- */
function questionListHTML(ids, emptyMsg, title, desc, returnView) {
  const main = document.getElementById("main");
  main.innerHTML = `
    <div class="page-head"><h1 class="page-title">${title}</h1><p class="page-desc">${desc}</p></div>`;
  if (!ids.length) { main.innerHTML += `<div class="empty">${emptyMsg}</div>`; return; }
  const rows = ids.map((id) => {
    const q = byId.get(id);
    const p = getProgress()[id] || {};
    const diff = p.diff ? DIFF_LABEL[p.diff] : "—";
    return `<tr>
      <td style="white-space:nowrap">${esc(qShort(q))}</td>
      <td style="white-space:nowrap">${esc(SECTION_SHORT[q.section] || q.section)}</td>
      <td>${esc(q.stem.slice(0, 52))}${q.stem.length > 52 ? "…" : ""}</td>
      <td style="white-space:nowrap">${diff}</td>
      <td><button class="btn ghost" data-open="${id}">查看</button></td>
    </tr>`;
  }).join("");
  main.innerHTML += `<div class="card"><table class="tbl">
    <tr><th>位置</th><th>模块</th><th>题干</th><th>难度</th><th></th></tr>${rows}</table></div>`;
  main.querySelectorAll("[data-open]").forEach((b) => {
    b.addEventListener("click", () => openSingle(byId.get(b.dataset.open), ids, returnView));
  });
}

function openSingle(q, list, returnView) {
  const progress = getProgress();
  const p = progress[q.id] || {};
  const revealed = !!p.choice;
  const main = document.getElementById("main");
  main.innerHTML = `
    <div class="page-head"><h1 class="page-title">${esc(qTag(q))}</h1>
    <p class="page-desc">${esc(q.section)}</p></div>
    <div class="card">
      ${questionHTML(q, { progress, revealed, choice: p.choice })}
      ${explanationHTML(q, { revealed, choice: p.choice })}
      <div class="btn-row"><button class="btn" id="single-back">返回列表</button></div>
    </div>`;
  document.getElementById("single-back").addEventListener("click", () => {
    (returnView || renderWrong)();
  });
}

function renderWrong() {
  const st = collectStats();
  questionListHTML(st.wrong, "还没有错题，继续保持。", "错题本", "做错的题都收在这里，反复重做直到会。", renderWrong);
}

function renderFav() {
  const ids = getFavs().filter((id) => byId.has(id));
  questionListHTML(ids, "还没有收藏的题。", "收藏", "你觉得值得再看的题。", renderFav);
}

function renderStats() {
  const st = collectStats();
  const progress = getProgress();
  const main = document.getElementById("main");

  const diff = { 1: { t: 0, c: 0 }, 2: { t: 0, c: 0 }, 3: { t: 0, c: 0 } };
  let timed = 0, timeSum = 0;
  QS.forEach((q) => {
    const p = progress[q.id];
    if (!p || !p.choice) return;
    if (p.diff && diff[p.diff]) {
      diff[p.diff].t++;
      if (p.correct) diff[p.diff].c++;
    }
    if (p.ms) { timed++; timeSum += p.ms; }
  });
  const avgSec = timed ? Math.round(timeSum / timed / 1000) : 0;

  main.innerHTML = `
    <div class="page-head"><h1 class="page-title">统计</h1>
    <p class="page-desc">用数据看自己哪里在丢分、哪里在浪费时间。</p></div>

    <div class="grid-2">
      <div class="card">
        <h3>分模块正确率</h3>
        ${SECTION_ORDER.map((sec) => {
          const d = st.bySection[sec] || { answered: 0, correct: 0 };
          return `<div class="bar-row"><div class="bar-label">${sec}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${pct(d.correct, d.answered)}%"></div></div>
            <div class="bar-value">${d.correct}/${d.answered}</div></div>`;
        }).join("")}
      </div>
      <div class="card">
        <h3>难度自评</h3>
        <p class="small muted">按你标记的“易/中/难”看正确率，能直观看出难题是不是在硬耗时间。</p>
        ${[1, 2, 3].map((d) => {
          const x = diff[d];
          return `<div class="bar-row"><div class="bar-label">${DIFF_LABEL[d]}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${pct(x.c, x.t)}%;background:${d === 3 ? "var(--blue)" : "var(--accent)"}"></div></div>
            <div class="bar-value">${x.c}/${x.t}</div></div>`;
        }).join("")}
        <p class="small muted" style="margin-top:12px">平均单题用时：<b>${avgSec} 秒</b>（超过 120 秒会记为耗时题）。</p>
      </div>
    </div>

    <div class="card">
      <h3>耗时题（速度训练重点）</h3>
      ${st.slow.length
        ? `<p class="small muted">这些题你用时超过 2 分钟，建议重做并刻意提速。</p>` + quickListHTML(st.slow)
        : `<div class="empty">还没有耗时题。做专项刷题时会自动计时。</div>`}
    </div>

    <div class="card">
      <h3>模拟考试记录</h3>
      ${getExams().length ? examHistoryHTML() : `<div class="empty">还没有模拟记录。</div>`}
    </div>`;

  main.querySelectorAll("[data-open]").forEach((b) => {
    b.addEventListener("click", () => openSingle(byId.get(b.dataset.open), st.slow, renderStats));
  });
}

function quickListHTML(ids) {
  return `<table class="tbl">${ids.slice(0, 50).map((id) => {
    const q = byId.get(id);
    const p = getProgress()[id] || {};
    const sec = p.ms ? Math.round(p.ms / 1000) : 0;
    return `<tr><td style="white-space:nowrap">${esc(qShort(q))}</td>
      <td style="white-space:nowrap">${esc(SECTION_SHORT[q.section] || q.section)}</td>
      <td>${esc(q.stem.slice(0, 44))}…</td>
      <td style="white-space:nowrap" class="mono">${sec} 秒</td>
      <td><button class="btn ghost" data-open="${id}">查看</button></td></tr>`;
  }).join("")}</table>`;
}

function renderSettings() {
  const s = getSettings();
  const main = document.getElementById("main");
  main.innerHTML = `
    <div class="page-head"><h1 class="page-title">设置</h1>
    <p class="page-desc">同步与备份都在这里。</p></div>

    <div class="card">
      <h3>云同步（出门在外也能 iPad ↔ 电脑互通）</h3>
      <p class="small muted">
        用免费的 Supabase 账号即可，不用下载任何东西。配置一次后，所有设备只要打开同一个网站就自动同步。
        具体步骤见「使用说明.md」里的「云同步」一节。每个设备第一次使用时都要粘贴一次下面的两个值。
      </p>
      <div class="field"><label>Supabase 项目地址（URL）</label><input id="set-sup-url" placeholder="https://xxxx.supabase.co" value="${esc(s.supabaseUrl || "")}"></div>
      <div class="field"><label>anon 公开密钥</label><input id="set-sup-key" placeholder="eyJhbGciOi..." value="${esc(s.supabaseKey || "")}"></div>
      <div class="btn-row">
        <button class="btn primary" id="save-sup">保存并测试连接</button>
        <span class="small" id="sup-status" style="align-self:center"></span>
      </div>
    </div>

    <div class="card">
      <h3>手动备份 / 恢复（零配置）</h3>
      <p class="small muted">
        点「生成备份」，把下面那串文字复制出来存好（备忘录、微信文件传输助手都行）。
        换设备时把它粘回下面，点「从粘贴内容恢复」。
      </p>
      <div class="btn-row">
        <button class="btn" id="gen-backup">生成备份</button>
        <button class="btn" id="copy-backup">复制备份</button>
      </div>
      <div class="field" style="margin-top:10px">
        <textarea id="backup-area" rows="6" style="width:100%;max-width:680px;font-family:monospace;font-size:12px;padding:10px;border:1px solid var(--line-strong);border-radius:6px"></textarea>
      </div>
      <div class="btn-row"><button class="btn" id="restore-backup">从粘贴内容恢复</button></div>
    </div>

    <div class="card">
      <h3>考试日期</h3>
      <div class="field"><label>国考笔试日期</label><input type="date" id="set-guokao" value="${esc(s.guokao)}"></div>
      <div class="field"><label>江苏省考笔试日期</label><input type="date" id="set-jiangsu" value="${esc(s.jiangsu)}"></div>
      <div class="btn-row"><button class="btn primary" id="save-settings">保存</button></div>
    </div>
    <div class="card">
      <h3>数据管理</h3>
      <p class="small muted">清除后会清空所有答题进度、错题、收藏和模拟记录，题库本身不受影响。</p>
      <div class="btn-row"><button class="btn" id="reset-data" style="border-color:var(--accent);color:var(--accent)">清空学习数据</button></div>
    </div>`;

  document.getElementById("save-settings").addEventListener("click", () => {
    setSettings({
      ...s,
      guokao: document.getElementById("set-guokao").value || "2026-11-29",
      jiangsu: document.getElementById("set-jiangsu").value || "2026-12-06",
    });
    updateSideCountdown();
    toast("已保存");
  });

  document.getElementById("save-sup").addEventListener("click", async () => {
    const st = document.getElementById("sup-status");
    const url = document.getElementById("set-sup-url").value.trim();
    const key = document.getElementById("set-sup-key").value.trim();
    setSettings({ ...s, supabaseUrl: url, supabaseKey: key });
    if (!url || !key) { st.textContent = "请把两个值都填上"; st.style.color = "var(--accent)"; return; }
    st.textContent = "正在测试…"; st.style.color = "var(--muted)";
    try {
      const d = await supabaseGet();
      if (d) restoreStateObj(d);
      st.textContent = "连接成功，已从云端读取数据";
      st.style.color = "var(--green)";
      updateSideCountdown();
      setTimeout(() => navigate("dashboard"), 600);
    } catch (e) {
      st.textContent = "连接失败，请检查 URL 和密钥（或先创建 kg_data 表）";
      st.style.color = "var(--accent)";
    }
  });

  document.getElementById("gen-backup").addEventListener("click", () => {
    document.getElementById("backup-area").value = JSON.stringify(fullStateObj());
  });
  document.getElementById("copy-backup").addEventListener("click", async () => {
    const area = document.getElementById("backup-area");
    if (!area.value) { document.getElementById("gen-backup").click(); }
    try {
      await navigator.clipboard.writeText(area.value);
      toast("已复制");
    } catch (e) {
      area.select();
      toast("已选中，长按复制即可");
    }
  });
  document.getElementById("restore-backup").addEventListener("click", () => {
    const raw = document.getElementById("backup-area").value.trim();
    if (!raw) { toast("先粘贴备份内容"); return; }
    try {
      restoreStateObj(JSON.parse(raw));
      toast("已恢复");
      updateSideCountdown();
      setTimeout(() => navigate("dashboard"), 500);
    } catch (e) {
      toast("恢复失败：内容格式不对");
    }
  });

  document.getElementById("reset-data").addEventListener("click", () => {
    if (confirm("确定清空所有学习数据吗？此操作不可撤销。")) {
      ["progress", "favs", "exams"].forEach((k) => {
        localStorage.removeItem("kg." + k);
        schedulePush();
      });
      toast("已清空");
      renderSettings();
      updateSideCountdown();
    }
  });
}

/* ---------------- image fault tolerance ---------------- */
document.addEventListener("error", (e) => {
  const el = e.target;
  if (el && el.tagName === "IMG") {
    const src = el.getAttribute("src") || "";
    const name = src.split("/").pop() || src;
    const span = document.createElement("span");
    span.className = "img-fail";
    span.textContent = "图片加载失败：" + name;
    el.replaceWith(span);
  }
}, true);

/* ---------------- boot ---------------- */
(async () => {
  await bootSync();
  updateSideCountdown();
  navigate("dashboard");
})();
