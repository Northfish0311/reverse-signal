/* 反指看板 · KOL 反向指标追踪器
 * 纯前端，localStorage 存储，打开即用。 */
(function () {
  "use strict";
  var KEY = "reverse-signal:v1";
  var signals = load();

  /* ---------- 存储 ---------- */
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (e) { return []; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(signals)); } catch (e) {}
  }

  /* ---------- 工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function nowStr() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
           " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /* ---------- 反指计算 ---------- */
  // result: "win"=他赢了(你反向就亏) / "lose"=他亏了(你反向就赚) / "pending"
  function compute(kol) {
    var list = kol ? signals.filter(function (s) { return s.kol === kol; }) : signals;
    var total = list.length;
    var decided = list.filter(function (s) { return s.result !== "pending"; });
    var loses = decided.filter(function (s) { return s.result === "lose"; }).length; // 他错的次数
    var wins = decided.filter(function (s) { return s.result === "win"; }).length;
    var wrongRate = decided.length ? loses / decided.length : 0; // 他错的概率 = 反向胜率
    var winRate = decided.length ? wins / decided.length : 0;
    var stars = decided.length ? Math.min(18, Math.round(wrongRate * 20)) : 0;
    return {
      total: total, decided: decided.length, loses: loses, wins: wins,
      wrongRate: wrongRate, winRate: winRate, stars: stars,
      confidence: Math.round(wrongRate * 100)
    };
  }
  function tier(stars) {
    if (stars === 0) return "尚未认证";
    if (stars <= 2) return "疑似随机波动";
    if (stars <= 5) return "初露反指锋芒";
    if (stars <= 9) return "稳定反向输出";
    if (stars <= 13) return "资深反向指标";
    if (stars <= 17) return "殿堂级反指";
    return "★ 十八星 · 历史级反指 ★";
  }

  /* ---------- 渲染统计 ---------- */
  function renderStats() {
    var c = compute($("filter-kol").value);
    $("stat-total").textContent = c.total;
    $("stat-stars").textContent = c.stars + " ★";
    $("stat-star-tier").textContent = tier(c.stars);
    $("stat-confidence").textContent = c.decided ? c.confidence + "%" : "--%";
    $("stat-winrate").textContent = c.decided ? Math.round(c.winRate * 100) + "%" : "--%";
  }

  /* ---------- 渲染列表 ---------- */
  function renderList() {
    var kol = $("filter-kol").value;
    var list = kol ? signals.filter(function (s) { return s.kol === kol; }) : signals;
    list = list.slice().reverse();
    var body = $("signal-body");
    body.innerHTML = "";
    $("empty-hint").style.display = list.length ? "none" : "block";
    list.forEach(function (s) {
      var tr = document.createElement("tr");
      var tagClass = s.result === "win" ? "win" : s.result === "lose" ? "lose" : "pending";
      var tagText = s.result === "win" ? "他赢" : s.result === "lose" ? "他亏(反指中)" : "待验证";
      tr.innerHTML =
        "<td>" + esc(s.time) + "</td>" +
        "<td>" + esc(s.kol) + "</td>" +
        "<td>" + esc(s.asset) + "</td>" +
        '<td><span class="dir-' + esc(s.dir) + '">' + (s.dir === "多" ? "看多" : "看空") + "</span></td>" +
        "<td>" + (s.entry ? esc(s.entry) : "—") + "</td>" +
        '<td><span class="tag ' + tagClass + '" id="tag-' + s.id + '">' + tagText + "</span></td>" +
        "<td>" +
          '<button class="row-btn" data-act="win" data-id="' + s.id + '">他赢</button>' +
          '<button class="row-btn" data-act="lose" data-id="' + s.id + '">他亏</button>' +
          '<button class="row-btn" data-act="del" data-id="' + s.id + '">删</button>' +
        "</td>";
      body.appendChild(tr);
    });
  }

  /* ---------- KOL 下拉刷新 ---------- */
  function refreshKolSelectors() {
    var kols = [];
    signals.forEach(function (s) { if (kols.indexOf(s.kol) === -1) kols.push(s.kol); });
    ["filter-kol", "cert-kol"].forEach(function (selId) {
      var sel = $(selId);
      var cur = sel.value;
      sel.innerHTML = selId === "filter-kol"
        ? '<option value="">全部 KOL</option>'
        : '<option value="">选择 KOL</option>';
      kols.forEach(function (k) {
        var o = document.createElement("option");
        o.value = k; o.textContent = k; sel.appendChild(o);
      });
      if (kols.indexOf(cur) !== -1) sel.value = cur;
    });
  }

  /* ---------- 添加 ---------- */
  $("add-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var sig = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      time: nowStr(),
      kol: $("f-kol").value.trim(),
      asset: $("f-asset").value.trim(),
      dir: $("f-dir").value,
      entry: $("f-entry").value.trim(),
      note: $("f-note").value.trim(),
      result: "pending"
    };
    signals.push(sig);
    save();
    this.reset();
    refreshKolSelectors();
    renderAll();
  });

  /* ---------- 列表操作（事件委托） ---------- */
  $("signal-body").addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-act]");
    if (!btn) return;
    var id = btn.getAttribute("data-id");
    var act = btn.getAttribute("data-act");
    var idx = signals.findIndex(function (s) { return s.id === id; });
    if (idx === -1) return;
    if (act === "del") {
      signals.splice(idx, 1);
    } else if (act === "win" || act === "lose") {
      signals[idx].result = act;
    }
    save();
    refreshKolSelectors();
    renderAll();
  });

  /* ---------- 过滤 ---------- */
  $("filter-kol").addEventListener("change", function () { renderStats(); renderList(); });

  /* ---------- 导出 / 导入 ---------- */
  $("btn-export").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(signals, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "reverse-signal-" + Date.now() + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("btn-import").addEventListener("click", function () { $("file-import").click(); });
  $("file-import").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (Array.isArray(data)) {
          signals = signals.concat(data);
          save(); refreshKolSelectors(); renderAll();
        }
      } catch (err) { alert("导入失败：文件格式不正确"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  /* ---------- 清空 ---------- */
  $("btn-clear").addEventListener("click", function () {
    if (confirm("确定清空所有记录？此操作不可恢复。")) {
      signals = []; save(); refreshKolSelectors(); renderAll();
    }
  });

  /* ---------- 反指证书 ---------- */
  $("btn-cert").addEventListener("click", function () {
    var kol = $("cert-kol").value;
    var out = $("cert-output");
    if (!kol) { out.classList.add("hidden"); return; }
    var c = compute(kol);
    if (!c.decided) { alert("该 KOL 还没有已验证的结果，无法生成证书。"); return; }
    var stars = "★".repeat(c.stars) + "☆".repeat(Math.max(0, 18 - c.stars));
    var quotes = [
      "「他一喊单，我就反手。这些年，全靠他养着我。」",
      "「市场唯一的确定性，就是他一定错。」",
      "「感谢灯哥，让我在反向的道路上越走越宽。」",
      "「别人看K线，我看他反着来。」"
    ];
    var q = quotes[Math.floor(Math.random() * quotes.length)];
    out.innerHTML =
      '<h3>反向指标认证证书</h3>' +
      '<div class="cert-sub">CERTIFICATE OF REVERSE INDICATOR · No.' + (kol.charCodeAt(0) * 7 + c.stars * 13) + '</div>' +
      '<div class="c-stars">' + stars + '</div>' +
      '<div class="cert-grid">' +
        '<div class="c-item"><div class="c-k">认证对象</div><div class="c-v">' + esc(kol) + "</div></div>" +
        '<div class="c-item"><div class="c-k">反向置信度</div><div class="c-v">' + c.confidence + "%</div></div>" +
        '<div class="c-item"><div class="c-k">样本数</div><div class="c-v">' + c.decided + "</div></div>" +
      "</div>" +
      '<div class="c-quote">' + q + "</div>" +
      '<div class="c-foot">经反指看板·反向指标追踪器 严谨（且充满讽刺）地统计认证 &nbsp;|&nbsp; ' + nowStr() + "</div>";
    out.classList.remove("hidden");
  });

  /* ---------- 初始化 ---------- */
  function renderAll() { refreshKolSelectors(); renderStats(); renderList(); }
  renderAll();
})();
