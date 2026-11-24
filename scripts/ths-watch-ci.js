#!/usr/bin/env node
/**
 * 同花顺「重生之散户一哥」发帖监控 —— 云端版（GitHub Actions 用）
 *
 * 与本地版区别：
 *   - 不弹 Windows 通知，只推送到手机（ntfy / Bark / 企业微信 / PushPlus / Server酱 / 飞书）
 *   - 每次运行都在全新机器上，所以每次都重新用 Chrome 取一次同花顺令牌
 *   - 已读记录存在 state.json 里，由 workflow 的 actions/cache 负责缓存
 *
 * 环境变量（配一个就够）：
 *   NTFY_URL         安卓/鸿蒙首选，如 https://ntfy.sh/my_topic_abc
 *   BARK_URL         iPhone，如 https://api.day.app/xxxx
 *   PUSHPLUS_TOKEN   微信推送
 *   WECOM_WEBHOOK    企业微信群机器人
 *   SERVERCHAN_KEY   Server酱
 *   FEISHU_WEBHOOK   飞书群机器人
 *   USER_CODE        可选，默认 1179giyc4jr06d6785e69e
 *   NAME             可选，默认 重生之散户一哥
 *   CHROME_PATH      可选，Chrome 可执行文件路径
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = __dirname;
const STATE_PATH = path.join(ROOT, 'state.json');
const API = 'https://t.10jqka.com.cn/user_center/open/api/content/v2/get_by_uid';

const USER_CODE = process.env.USER_CODE || '1179giyc4jr06d6785e69e';
const NAME = process.env.NAME || '重生之散户一哥';
const NTFY_URL = (process.env.NTFY_URL || '').trim();
const BARK_URL = (process.env.BARK_URL || '').trim();
const WECOM = (process.env.WECOM_WEBHOOK || '').trim();
const PUSHPLUS = (process.env.PUSHPLUS_TOKEN || '').trim();
const SERVERCHAN = (process.env.SERVERCHAN_KEY || '').trim();
const FEISHU = (process.env.FEISHU_WEBHOOK || '').trim();

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/google/chrome/chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z';

function log(msg) {
  console.log(`[${nowIso()}] ${msg}`);
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(s) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2), 'utf8');
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function fmtTime(ms) {
  // 统一按北京时间显示
  const d = new Date(Number(ms) || Date.now());
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${bj.getUTCMonth() + 1}-${p(bj.getUTCDate())} ${p(bj.getUTCHours())}:${p(bj.getUTCMinutes())}`;
}

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

async function httpJson(url, method = 'GET') {
  const res = await fetch(url, { method });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** 用无头 Chrome 打开一次同花顺页面，读出风控令牌 */
async function getCookie() {
  const chrome = findChrome();
  if (!chrome) throw new Error('找不到 Chrome，无法获取同花顺令牌');

  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = path.join(os.tmpdir(), `ths_profile_${Date.now()}`);
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--mute-audio',
      '--no-first-run',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let ws = null;
  try {
    let version = null;
    for (let i = 0; i < 80; i++) {
      await sleep(250);
      try {
        version = await httpJson(`http://127.0.0.1:${port}/json/version`);
        if (version && version.webSocketDebuggerUrl) break;
      } catch {}
    }
    if (!version || !version.webSocketDebuggerUrl) throw new Error('Chrome 调试端口未就绪');

    const pageUrl = `https://t.10jqka.com.cn/lgt/user_page/?user_code=${encodeURIComponent(USER_CODE)}`;
    const tab = await httpJson(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(pageUrl)}`, 'PUT');
    if (!tab || !tab.webSocketDebuggerUrl) throw new Error('无法新建标签页');

    ws = new WebSocket(tab.webSocketDebuggerUrl);
    let nextId = 1;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });

    await send('Runtime.enable');
    for (let i = 0; i < 25; i++) {
      await sleep(700);
      const r = await send('Runtime.evaluate', { expression: 'document.cookie', returnByValue: true });
      const cookie = (r && r.result && r.result.result && r.result.result.value) || '';
      if (/(?:^|;\s*)v=/.test(cookie)) {
        log('已获取同花顺令牌');
        return cookie;
      }
    }
    throw new Error('等待令牌超时');
  } finally {
    try {
      if (ws) ws.close();
    } catch {}
    try {
      child.kill('SIGKILL');
    } catch {}
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {}
  }
}

async function fetchPosts(cookie) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      Cookie: cookie,
      Referer: `https://t.10jqka.com.cn/lgt/user_page/?user_code=${encodeURIComponent(USER_CODE)}`,
      Origin: 'https://t.10jqka.com.cn',
      'User-Agent': UA,
    },
    body: JSON.stringify({ user_code: USER_CODE }),
  });
  const text = await res.text();
  if (res.status === 403) throw new Error('接口返回 403（令牌被拒或被风控）');
  if (!res.ok) throw new Error(`接口返回 HTTP ${res.status}`);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('接口返回的不是 JSON：' + text.slice(0, 120));
  }
  if (json.status_code !== 0 || !json.data || !Array.isArray(json.data.contents)) {
    throw new Error('接口返回异常：' + JSON.stringify(json).slice(0, 200));
  }
  return json.data.contents
    .filter((c) => c && c.info && c.info.id)
    .map((c) => ({
      id: String(c.info.id),
      ctime: Number(c.info.ctime) || 0,
      url: c.info.jump_url || c.info.client_url || '',
      text: stripHtml(c.abstract && c.abstract.content),
      like: (c.stat && c.stat.like_num) || 0,
      comment: (c.stat && c.stat.comment_num) || 0,
    }))
    .sort((a, b) => a.ctime - b.ctime);
}

/* ------------------------------ 推送渠道 ------------------------------ */

/** ntfy：安卓/鸿蒙首选，免费、无需注册，点击通知直达原帖 */
async function pushNtfy(title, body, link) {
  if (!NTFY_URL) return false;
  try {
    const u = new URL(NTFY_URL);
    const topic = u.pathname.replace(/^\/+/, '');
    if (!topic) throw new Error('NTFY_URL 里缺少 topic');
    u.pathname = '/';
    const res = await fetch(u.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        title,
        message: body,
        click: link,
        priority: 4,
        tags: ['chart_with_upwards_trend'],
      }),
    });
    const txt = await res.text();
    log(`ntfy 响应 ${res.status}: ${txt.slice(0, 150)}`);
    return res.ok;
  } catch (e) {
    log('ntfy 推送失败: ' + (e && e.message));
    return false;
  }
}

/** Bark：iPhone 专用 */
async function pushBark(title, body, link) {
  if (!BARK_URL) return false;
  const root = BARK_URL.replace(/\/+$/, '');
  const url =
    `${root}/${encodeURIComponent(title)}/${encodeURIComponent(body)}` +
    `?url=${encodeURIComponent(link)}&group=${encodeURIComponent('同花顺')}&level=timeSensitive`;
  try {
    const res = await fetch(url);
    const txt = await res.text();
    log(`Bark 响应 ${res.status}: ${txt.slice(0, 200)}`);
    return res.ok;
  } catch (e) {
    log('Bark 推送失败: ' + (e && e.message));
    return false;
  }
}

/** PushPlus：推到微信，需实名才有 200 条/天额度 */
async function pushPushPlus(title, body, link) {
  if (!PUSHPLUS) return false;
  try {
    const res = await fetch('https://www.pushplus.plus/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: PUSHPLUS,
        title,
        content: `${body}<br><a href="${link}">查看原帖</a>`,
        template: 'html',
      }),
    });
    const txt = await res.text();
    log(`PushPlus 响应 ${res.status}: ${txt.slice(0, 150)}`);
    return res.ok;
  } catch (e) {
    log('PushPlus 推送失败: ' + (e && e.message));
    return false;
  }
}

/** 飞书自定义机器人 */
async function pushFeishu(title, body, link) {
  if (!FEISHU) return false;
  try {
    const res = await fetch(FEISHU, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text: `${title}\n${body}\n原帖：${link}` } }),
    });
    const txt = await res.text();
    log(`飞书响应 ${res.status}: ${txt.slice(0, 150)}`);
    return res.ok;
  } catch (e) {
    log('飞书推送失败: ' + (e && e.message));
    return false;
  }
}

async function pushWecom(title, body, link) {
  if (!WECOM) return;
  const content = `**${title}**\n${body}\n[查看原帖](${link})`;
  await fetch(WECOM, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'markdown', markdown: { content } }),
  }).catch(() => {});
}

async function pushServerChan(title, body) {
  if (!SERVERCHAN) return;
  await fetch(
    `https://sctapi.ftqq.com/${encodeURIComponent(SERVERCHAN)}.send?title=${encodeURIComponent(
      title,
    )}&desp=${encodeURIComponent(body)}`,
  ).catch(() => {});
}

async function pushAll(title, body, link, plain) {
  const results = [];
  results.push(await pushNtfy(title, body, link));
  results.push(await pushBark(title, body, link));
  results.push(await pushPushPlus(title, body, link));
  results.push(await pushFeishu(title, body, link));
  await pushWecom(title, body, link);
  await pushServerChan(title, plain || body);
  return results.some(Boolean);
}

async function notifyNewPost(post) {
  const title = `${NAME} 发新帖了`;
  const snippet = post.text.slice(0, 120) || '（图片/无文字内容）';
  const body = `${fmtTime(post.ctime)}｜赞${post.like} 评${post.comment}｜${snippet}`;
  log(`推送：${title} / ${body.slice(0, 60)}…`);
  return pushAll(title, body, post.url, snippet + '\n' + post.url);
}

/* ------------------------------ 主流程 ------------------------------ */

async function main() {
  const test = process.argv.includes('--test');
  const state = loadState();
  const hasChannel = NTFY_URL || BARK_URL || PUSHPLUS || FEISHU || WECOM || SERVERCHAN;

  if (test) {
    if (!hasChannel) {
      console.error('一个推送渠道都没配置：NTFY_URL / BARK_URL / PUSHPLUS_TOKEN / FEISHU_WEBHOOK / WECOM_WEBHOOK');
      process.exit(1);
    }
    const ok = await pushAll(
      `${NAME} 监控测试`,
      '这是一条测试推送。真实推送会带发帖时间、点赞评论数和正文摘要，点开直达原帖。',
      'https://t.10jqka.com.cn/lgt/user_page/?user_code=' + encodeURIComponent(USER_CODE),
    );
    console.log(ok ? '测试推送完成，检查手机' : '测试推送失败，检查配置的推送地址');
    process.exit(ok ? 0 : 1);
  }

  try {
    const cookie = await getCookie();
    const posts = await fetchPosts(cookie);
    if (!posts.length) throw new Error('没有拿到任何帖子');

    const latest = posts[posts.length - 1];
    const seen = new Set(state.seenIds || []);
    const initialized = Array.isArray(state.seenIds);
    const fresh = posts.filter((p) => !seen.has(p.id));

    if (!initialized) {
      state.seenIds = posts.map((p) => p.id).slice(-200);
      state.initializedAt = Date.now();
      state.failCount = 0;
      saveState(state);
      log(`初始化完成，当前最新 ${latest.id} [${fmtTime(latest.ctime)}]，之后有新帖会推送`);
      log('（首次运行不推送旧帖；想验证推送链路，用 workflow_dispatch 勾 test）');
      return;
    }

    if (!fresh.length) {
      state.failCount = 0;
      state.lastCheckAt = Date.now();
      saveState(state);
      log(`无新帖（最新 ${latest.id} [${fmtTime(latest.ctime)}]）`);
      return;
    }

    for (const p of fresh) {
      log(`发现新帖 ${p.id} [${fmtTime(p.ctime)}] ${p.text.slice(0, 60)}`);
      await notifyNewPost(p);
      seen.add(p.id);
    }
    state.seenIds = [...seen].slice(-200);
    state.failCount = 0;
    state.lastCheckAt = Date.now();
    state.lastNotifyAt = Date.now();
    saveState(state);
  } catch (e) {
    state.failCount = (state.failCount || 0) + 1;
    state.lastError = String((e && e.message) || e);
    saveState(state);
    log(`检查失败(${state.failCount}): ${state.lastError}`);

    if (state.failCount === 3 || state.failCount % 30 === 0) {
      await pushAll(
        `${NAME} 监控异常`,
        `连续 ${state.failCount} 次检查失败：${state.lastError}。可能是同花顺改版或风控加强。`,
        'https://github.com/' + (process.env.GITHUB_REPOSITORY || ''),
      );
    }
    process.exit(state.failCount >= 3 ? 1 : 0);
  }
}

main().catch((e) => {
  console.error('未捕获异常', e);
  process.exit(1);
});
