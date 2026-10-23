(function () {
  "use strict";
  const core = window.SignalCore;
  const KEY = "reverse-signal:v1";
  const $ = id => document.getElementById(id);
  let signals = [], editId = null, storageBlocked = false, undoRecords = null;
  let requestId = 0, controller = null, certKol = "";

  function notice(text, error = false) {
    $("notice").textContent = text;
    $("notice").className = error ? "notice error" : "notice";
    $("notice").hidden = !text;
  }
  try {
    const stored = localStorage.getItem(KEY);
    if (stored !== null) signals = core.parseRecords(JSON.parse(stored));
  } catch (error) {
    storageBlocked = true;
    notice("本地数据未能读取，原始数据没有改动。请先导出原始备份；修复备份后可清空并重新导入。原因：" + error.message, true);
  }
  function persist(next, message) {
    if (storageBlocked) { notice("本地数据异常，已停止写入以保护原始记录。请先导出原始备份。", true); return false; }
    if (new Blob([backup(next)]).size > core.MAX_BACKUP_BYTES) {
      notice("记录超过 2 MB 备份容量上限，本次修改未保存。请先导出备份，再整理旧记录。", true); return false;
    }
    try { localStorage.setItem(KEY, JSON.stringify(next)); }
    catch (_) { notice("保存失败，原有记录未改动。请导出备份并检查浏览器存储权限或剩余空间。", true); return false; }
    signals = next; notice(message); renderAll(); return true;
  }
  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function percent(rate) { return rate === null ? "--" : Math.round(rate * 100) + "%"; }
  function kolRecords() { const kol = $("filter-kol").value; return signals.filter(s => !kol || s.kol === kol); }
  function visibleRecords() { const result = $("filter-result").value; return kolRecords().filter(s => !result || s.result === result); }
  function refreshSelectors() {
    const kols = [...new Set(signals.map(s => s.kol))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    ["filter-kol", "cert-kol"].forEach(id => {
      const select = $(id), value = select.value;
      select.replaceChildren(new Option(id === "filter-kol" ? "全部 KOL" : "选择 KOL", ""));
      kols.forEach(kol => select.add(new Option(kol, kol)));
      if (kols.includes(value)) select.value = value;
    });
  }
  function renderStats() {
    const c = core.compute(kolRecords());
    $("stat-total").textContent = c.total;
    $("stat-decided").textContent = "已验证 " + c.decided + " · 待验证 " + c.pending;
    $("stat-stars").textContent = c.stars === null ? "--" : c.stars + " / 18";
    $("stat-star-tier").textContent = c.stars === null ? "样本不足 " + core.MIN_SAMPLES + " 条" : "娱乐评分 · 非交易信号";
    $("stat-confidence").textContent = percent(c.wrongRate);
    $("stat-wrong-count").textContent = "判错 " + c.loses + " / 已验证 " + c.decided;
    $("stat-winrate").textContent = percent(c.winRate);
    $("stat-right-count").textContent = "判对 " + c.wins + " / 已验证 " + c.decided;
  }
  function renderList() {
    const list = visibleRecords().slice().reverse(), body = $("signal-body");
    body.replaceChildren(); $("record-count").textContent = list.length + " 条";
    $("empty-hint").hidden = !!list.length;
    $("empty-hint").textContent = signals.length ? "没有符合筛选条件的记录" : "暂无观点记录";
    list.forEach(s => {
      const tr = node("tr"), who = node("td"), asset = node("td");
      who.append(node("strong", s.kol), node("span", s.time, "record-time"));
      asset.append(node("strong", s.asset), node("span", s.dir === "多" ? "看多" : "看空", "direction " + (s.dir === "多" ? "long" : "short")));
      const evidence = node("td", undefined, "evidence");
      if (s.note) {
        const details = node("details");
        details.append(node("summary", s.note.slice(0, 70) + (s.note.length > 70 ? "…" : "")), node("p", s.note));
        evidence.append(details);
      } else evidence.append(node("span", "暂无原话", "muted"));
      if (s.sourceUrl) {
        const link = node("a", "查看原文");
        link.href = s.sourceUrl; link.target = "_blank"; link.rel = "noopener noreferrer";
        evidence.append(link);
      }
      const result = node("td"), select = node("select", undefined, "result-select " + s.result);
      select.setAttribute("aria-label", s.kol + " · " + s.asset + " 的验证结果");
      [["pending", "待验证"], ["win", "判对"], ["lose", "判错"]].forEach(([value, label]) => select.add(new Option(label, value)));
      select.value = s.result;
      select.addEventListener("change", () => {
        if (!persist(signals.map(record => record.id === s.id ? { ...record, result: select.value } : record), "验证结果已保存")) select.value = s.result;
      });
      result.append(select);
      const actions = node("td", undefined, "row-actions"), edit = node("button", "编辑", "row-btn");
      edit.addEventListener("click", () => editRecord(s));
      const remove = node("button", "删除", "row-btn danger");
      remove.addEventListener("click", () => {
        const before = signals.slice();
        if (persist(signals.filter(record => record.id !== s.id), "记录已删除，可撤销")) {
          undoRecords = before; $("btn-undo").hidden = false;
          if (editId === s.id) resetForm();
        }
      });
      actions.append(edit, remove);
      tr.append(who, asset, node("td", s.entry || "--", "entry-price"), evidence, result, actions);
      body.append(tr);
    });
  }
  function cancelRequest() {
    requestId++;
    if (controller) controller.abort();
    controller = null;
    $("btn-fetch-x").disabled = false; $("btn-fetch-x").textContent = "识别链接";
  }
  function resetForm() {
    cancelRequest(); editId = null; $("add-form").reset();
    $("x-url").value = ""; $("x-status").textContent = "";
    $("form-title").textContent = "记录观点"; $("btn-submit").textContent = "保存记录";
    $("btn-cancel").hidden = true;
  }
  function editRecord(record) {
    if (editId !== record.id && draftExists() && !confirm("放弃当前未保存的内容，编辑这条记录？")) return;
    cancelRequest(); editId = record.id;
    ["kol", "asset", "dir", "entry", "note"].forEach(key => $("f-" + key).value = record[key]);
    $("f-source").value = record.sourceUrl; $("x-url").value = record.sourceUrl; $("x-status").textContent = "";
    $("form-title").textContent = "编辑观点"; $("btn-submit").textContent = "保存修改";
    $("btn-cancel").hidden = false; $("f-kol").focus();
  }
  function draftExists() { return ["kol", "asset", "dir", "entry", "note"].some(key => $("f-" + key).value.trim()); }
  function nowStr() {
    const date = new Date(), pad = n => String(n).padStart(2, "0");
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
  }
  $("add-form").addEventListener("submit", event => {
    event.preventDefault(); cancelRequest();
    const previous = signals.find(s => s.id === editId);
    try {
      if (editId && !previous) throw new Error("这条记录已不存在，请取消编辑后重新录入");
      const record = core.normalize({ id: editId || core.makeId(), time: previous ? previous.time : nowStr(),
        kol: $("f-kol").value, asset: $("f-asset").value, dir: $("f-dir").value,
        entry: $("f-entry").value, note: $("f-note").value, sourceUrl: $("f-source").value,
        result: previous ? previous.result : "pending" });
      if (!editId && signals.length >= core.MAX_RECORDS) throw new Error("已达到记录数量上限，请先导出备份");
      const next = editId ? signals.map(s => s.id === editId ? record : s) : signals.concat(record);
      if (persist(next, editId ? "修改已保存" : "观点已记录")) {
        resetForm(); undoRecords = null; $("btn-undo").hidden = true;
      }
    } catch (error) { notice(error.message, true); }
  });
  $("btn-cancel").addEventListener("click", resetForm);
  $("add-form").addEventListener("input", () => {
    if (controller) { cancelRequest(); $("x-status").textContent = "已取消识别，保留手动输入"; }
  });
  $("x-url").addEventListener("input", () => { if (controller) cancelRequest(); $("x-status").textContent = ""; });
  $("btn-fetch-x").addEventListener("click", async () => {
    const parsed = core.tweetUrl($("x-url").value);
    if (!parsed) { $("x-status").textContent = "请输入完整的 X / Twitter 推文链接"; return; }
    if (draftExists() && !confirm("用这条推文替换当前未保存的表单内容？")) return;
    cancelRequest(); const current = requestId;
    ["kol", "asset", "dir", "entry", "note"].forEach(key => $("f-" + key).value = "");
    $("f-source").value = "";
    $("btn-fetch-x").disabled = true; $("btn-fetch-x").textContent = "识别中…";
    $("x-status").textContent = "正在读取推文…";
    for (const host of ["https://api.fxtwitter.com/", "https://api.vxtwitter.com/"]) {
      const abort = new AbortController(); controller = abort;
      const timeout = setTimeout(() => abort.abort(), 8000);
      try {
        const response = await fetch(host + parsed.user + "/status/" + parsed.id, { signal: abort.signal, credentials: "omit", referrerPolicy: "no-referrer" });
        if (!response.ok) throw new Error("读取失败");
        const tweet = core.parseTweet(await response.json(), parsed);
        if (current !== requestId) return;
        ["kol", "asset", "dir", "entry", "note"].forEach(key => $("f-" + key).value = tweet[key]);
        $("f-source").value = tweet.sourceUrl;
        $("x-status").textContent = "已读取 @" + tweet.kol + (!tweet.dir || !tweet.asset ? "；标的或方向待确认" : "；请核对标的和方向");
        cancelRequest(); return;
      } catch (_) {
        if (current !== requestId) return;
        $("x-status").textContent = "主接口不可用，正在尝试备用接口…";
      } finally { clearTimeout(timeout); }
    }
    if (current === requestId) {
      cancelRequest(); $("f-source").value = parsed.url;
      $("x-status").textContent = "读取失败，未填入任何推文内容。可手动录入；原文链接已保留。";
    }
  });
  function download(text, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = node("a"); a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function backup(records) { return JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), signals: records }); }
  $("btn-export").addEventListener("click", () => {
    try {
      const data = storageBlocked ? localStorage.getItem(KEY) : backup(signals);
      if (data === null) throw new Error("浏览器中没有可导出的数据");
      download(data, "reverse-signal-" + (storageBlocked ? "raw-" : "") + Date.now() + ".json");
      notice("备份已生成" + (storageBlocked ? "，本地原始数据仍未改动" : ""));
    } catch (error) { notice("无法导出：" + error.message, true); }
  });
  $("btn-import").addEventListener("click", () => $("file-import").click());
  $("file-import").addEventListener("change", async event => {
    const file = event.target.files[0]; event.target.value = "";
    if (!file) return;
    try {
      if (file.size > core.MAX_BACKUP_BYTES) throw new Error("备份文件不能超过 2 MB");
      const imported = core.parseRecords(JSON.parse(await file.text()));
      const merged = core.mergeRecords(signals, imported);
      persist(merged.records, "导入完成：新增 " + merged.added + " 条，跳过重复 " + merged.skipped + " 条");
    } catch (error) { notice("导入失败，现有数据未改动：" + error.message, true); }
  });
  $("btn-clear").addEventListener("click", () => {
    if (!signals.length && !storageBlocked) return;
    if (!confirm(storageBlocked ? "确认已导出原始备份？清空会删除当前无法读取的原始数据，不能撤销。" : "清空全部 " + signals.length + " 条记录？建议先导出备份。")) return;
    const before = signals.slice(), wasBlocked = storageBlocked; storageBlocked = false;
    if (persist([], "记录已清空")) {
      resetForm(); undoRecords = wasBlocked ? null : before; $("btn-undo").hidden = !undoRecords;
    } else storageBlocked = wasBlocked;
  });
  $("btn-undo").addEventListener("click", () => {
    if (!undoRecords) return;
    try {
      // Merge restored records without overwriting changes made after the deletion.
      const restored = core.mergeRecords(signals, undoRecords).records;
      if (persist(restored, "已恢复删除的记录")) { undoRecords = null; $("btn-undo").hidden = true; }
    } catch (error) { notice("无法撤销：" + error.message, true); }
  });
  function renderCertificate() {
    const out = $("cert-output"); out.replaceChildren(); out.hidden = true;
    if (!certKol) return;
    const c = core.compute(signals.filter(s => s.kol === certKol));
    if (!c.total) { certKol = ""; return; }
    out.hidden = false;
    out.append(node("span", "REVERSE SIGNAL / 历史样本", "cert-kicker"), node("h3", "反指观察证书"), node("p", certKol, "cert-name"));
    const grid = node("div", undefined, "cert-grid");
    [["历史判错比例", percent(c.wrongRate)], ["已验证样本", String(c.decided)], ["娱乐星级", c.stars === null ? "暂不评级" : c.stars + " / 18"]].forEach(([label, value]) => {
      const item = node("div"); item.append(node("span", label), node("strong", value)); grid.append(item);
    });
    out.append(grid, node("p", c.decided < core.MIN_SAMPLES ? "样本不足，暂不评级。" : "保持怀疑，让记录说话。", "cert-quote"), node("p", "手动验证 · 截至 " + nowStr() + " · 不代表未来胜率或实际交易收益", "cert-foot"));
  }
  $("btn-cert").addEventListener("click", () => {
    certKol = $("cert-kol").value;
    if (!certKol) { notice("请先选择一个 KOL", true); return; } renderCertificate();
  });
  $("cert-kol").addEventListener("change", () => { certKol = ""; renderCertificate(); });
  $("filter-kol").addEventListener("change", () => { renderStats(); renderList(); });
  $("filter-result").addEventListener("change", () => { renderStats(); renderList(); });
  window.addEventListener("storage", event => {
    if (event.key !== KEY && event.key !== null) return;
    storageBlocked = true;
    notice("数据已在另一个窗口更改。为避免覆盖，当前窗口暂停写入；请刷新页面后继续。", true);
  });
  function renderAll() { refreshSelectors(); renderStats(); renderList(); renderCertificate(); }
  renderAll();
})();
