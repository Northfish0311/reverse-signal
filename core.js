(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SignalCore = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  const MAX_RECORDS = 5000;
  const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
  const MIN_SAMPLES = 20;
  const RESULTS = ["pending", "win", "lose"];
  function makeId() { return "s-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12); }
  function field(value, name, max, required = false) {
    if (value === undefined || value === null) value = "";
    if (typeof value !== "string") throw new Error(name + "必须是文本");
    const text = value.trim();
    if (required && !text) throw new Error(name + "不能为空");
    if (text.length > max) throw new Error(name + "超过长度限制（" + max + " 字）");
    return text;
  }
  function tweetUrl(raw) {
    if (typeof raw !== "string") return null;
    try {
      const url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : "https://" + raw.trim());
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) return null;
      if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname.toLowerCase())) return null;
      const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/);
      return match ? { user: match[1], id: match[2], url: "https://x.com/" + match[1] + "/status/" + match[2] } : null;
    } catch (_) { return null; }
  }
  function normalize(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("记录必须是对象");
    const id = record.id == null ? makeId() : field(record.id, "记录 ID", 100, true);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("记录 ID 格式不正确");
    if (!["多", "空"].includes(record.dir)) throw new Error("请选择看多或看空");
    if (!RESULTS.includes(record.result)) throw new Error("验证结果不正确");
    const time = field(record.time, "记录时间", 40, true);
    if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(time) || !Number.isFinite(Date.parse(time.replace(" ", "T")))) throw new Error("记录时间格式不正确");
    const source = field(record.sourceUrl, "原文链接", 500);
    const parsed = source ? tweetUrl(source) : null;
    if (source && !parsed) throw new Error("原文链接必须是有效的 X / Twitter 推文链接");
    return { id, time,
      kol: field(record.kol, "KOL 名称", 100, true), asset: field(record.asset, "标的", 80, true),
      dir: record.dir, entry: field(record.entry, "参考价", 100), note: field(record.note, "原话或备注", 10000),
      sourceUrl: parsed ? parsed.url : "", result: record.result };
  }
  function parseRecords(value) {
    const list = Array.isArray(value) ? value : value && value.version === 2 ? value.signals : null;
    if (!Array.isArray(list)) throw new Error("文件必须是记录数组或版本 2 的备份文件");
    if (list.length > MAX_RECORDS) throw new Error("单个备份最多包含 " + MAX_RECORDS + " 条记录");
    return list.map((record, index) => {
      try { return normalize(record); }
      catch (error) { throw new Error("第 " + (index + 1) + " 条：" + error.message); }
    });
  }
  function fingerprint(record) { return JSON.stringify([record.time, record.kol, record.asset, record.dir, record.entry, record.note, record.sourceUrl]); }
  function mergeRecords(existing, incoming) {
    const ids = new Set(existing.map(s => s.id));
    const prints = new Set(existing.map(fingerprint));
    const records = existing.slice(); let skipped = 0;
    for (const record of incoming) {
      const print = fingerprint(record);
      if (ids.has(record.id) || prints.has(print)) { skipped++; continue; }
      if (records.length >= MAX_RECORDS) throw new Error("记录总数不能超过 " + MAX_RECORDS + " 条");
      ids.add(record.id); prints.add(print); records.push(record);
    }
    return { records, added: records.length - existing.length, skipped };
  }
  function restoreRecords(existing, beforeDeletion) {
    const records = mergeRecords(existing, beforeDeletion).records;
    const positions = new Map(beforeDeletion.map((record, index) => [record.id, index]));
    // Keep current values, restore original positions, then retain later imports.
    return records.sort((a, b) => (positions.get(a.id) ?? beforeDeletion.length) - (positions.get(b.id) ?? beforeDeletion.length));
  }
  function compute(records) {
    const wins = records.filter(s => s.result === "win").length;
    const loses = records.filter(s => s.result === "lose").length;
    const decided = wins + loses, wrongRate = decided ? loses / decided : null;
    return { total: records.length, wins, loses, decided, pending: records.length - decided,
      wrongRate, winRate: decided ? wins / decided : null,
      stars: decided >= MIN_SAMPLES ? Math.round(wrongRate * 18) : null };
  }
  function detectDirection(text) {
    const long = /做多|看多|多单|买入|抄底|加仓|看涨|暴涨|翻多|满仓|冲高|\blong\b|\bbullish\b/i.test(text);
    const short = /做空|看空|空单|卖出|清仓|止盈|看跌|暴跌|翻空|减仓|逃顶|\bshort\b|\bbearish\b/i.test(text);
    return long === short ? "" : long ? "多" : "空";
  }
  function detectAsset(text) {
    const patterns = [[/\bBTC\b|比特币|大饼/i, "BTC"], [/\bETH\b|以太/i, "ETH"], [/黄金|\bXAU\b/i, "黄金"], [/纳指|纳斯达克|\bNAS100\b/i, "纳斯达克"]];
    const matches = patterns.filter(([pattern]) => pattern.test(text));
    return matches.length === 1 ? matches[0][1] : "";
  }
  function parseTweet(data, parsed) {
    const tweet = data && data.tweet, text = tweet ? tweet.text : data && data.text;
    if (typeof text !== "string" || !text.trim()) throw new Error("接口没有返回可用的推文正文");
    const author = tweet ? tweet.author && tweet.author.screen_name : data.user_screen_name;
    return { kol: typeof author === "string" && author.trim() ? author.trim().slice(0, 100) : parsed.user,
      asset: detectAsset(text), dir: detectDirection(text), entry: "", note: text.slice(0, 10000), sourceUrl: parsed.url };
  }
  return { MAX_RECORDS, MAX_BACKUP_BYTES, MIN_SAMPLES, makeId, tweetUrl, normalize, parseRecords, mergeRecords, restoreRecords, compute, parseTweet };
});
