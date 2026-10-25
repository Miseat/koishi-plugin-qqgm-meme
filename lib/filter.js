const fs = require('node:fs');
const path = require('node:path');
const { h } = require('koishi');
const { pickMeme, pickRandomMeme, memeKey } = require('./match');

const MARKER_RE = /\[表情[:：]\s*([^\]\n]{1,100})\]/g;
const EXPLICIT_RE = /(表情包|斗图|发个表情|来个表情|来张表情|发张表情|发表情|来张图|发张图|发个图)/;
const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function extractRequestText(session) {
  return String(session?.content || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[CQ:[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isExplicitRequest(session) {
  return EXPLICIT_RE.test(extractRequestText(session));
}

function createLimiter(config) {
  const state = new Map();
  const minInterval = Math.max(0, Number(config.minIntervalSeconds ?? 15)) * 1000;
  const maxPerHour = Math.max(1, Number(config.maxPerHour ?? 8));
  return (key, force = false) => {
    const now = Date.now();
    const item = state.get(key) || { last: 0, window: now, count: 0 };
    if (now - item.window >= 3600_000) {
      item.window = now;
      item.count = 0;
    }
    if (!force && now - item.last < minInterval) return false;
    if (item.count >= maxPerHour) return false;
    item.last = now;
    item.count += 1;
    state.set(key, item);
    return true;
  };
}

async function sendMeme(session, meme, logger) {
  if (!session?.send) {
    logger?.warn?.('[meme] 当前会话不可发送，跳过图片');
    return false;
  }
  try {
    const buffer = fs.readFileSync(meme.abs);
    const mime = MIME[path.extname(meme.abs).toLowerCase()] || 'image/jpeg';
    await session.send(h.image(`data:${mime};base64,${buffer.toString('base64')}`));
    logger?.info?.(`[meme] sent ${meme.pack}/${meme.path} tag=${meme.tag}`);
    return true;
  } catch (error) {
    logger?.warn?.(`[meme] 发送失败：${String(error)}`);
    return false;
  }
}

/**
 * 产出两个钩子：
 * - filter：解析 [表情: 情绪]，掷概率；命中则暂存/直接发图，并从正文删标记
 * - afterReply：文字发完后，把暂存的图补上（保证先文字后图片）
 *
 * 用户明确要表情包时（“来个表情包/斗图/发个表情”），跳过概率与最小间隔，
 * 直接发一张；AI 没给标记时，从请求里找情绪，找不到就随机挑一张。
 *
 * 去重：每个会话记住最近发过的 N 张，选图时优先避开，避免来回就那几张。
 */
function createFilter(pack, config = {}, logger, rng = Math.random) {
  const pending = new WeakMap();
  const limiter = createLimiter(config);
  const allowedGroups = (config.allowedGroups || []).map(String);
  const blockedGroups = (config.blockedGroups || []).map(String);
  const probability = Math.max(0, Math.min(1, Number(config.memeProbability ?? 0.3)));
  const recentLimit = Math.max(0, Number(config.recentLimit ?? 8));
  const recentByScope = new Map();

  const allowed = (ctx) => {
    if (ctx?.session?.isDirect) return config.allowDirect !== false;
    const groupId = String(ctx?.groupId || ctx?.session?.guildId || '');
    if (blockedGroups.includes(groupId)) return false;
    if (allowedGroups.length && !allowedGroups.includes(groupId)) return false;
    return true;
  };

  const limiterKey = (ctx) => (
    ctx?.session?.isDirect
      ? `direct:${ctx.session.userId}`
      : String(ctx?.groupId || ctx?.session?.guildId || '')
  );

  const recentFor = (scope) => recentByScope.get(scope) || [];

  const rememberRecent = (scope, meme) => {
    if (!recentLimit || !meme) return;
    const list = recentByScope.get(scope) || [];
    const key = memeKey(meme);
    const next = [key, ...list.filter((item) => item !== key)].slice(0, recentLimit);
    recentByScope.set(scope, next);
  };

  const filter = async (text, ctx) => {
    const raw = String(text || '');
    const explicit = isExplicitRequest(ctx?.session);
    const matches = [...raw.matchAll(MARKER_RE)];
    const scope = limiterKey(ctx);
    const recent = recentFor(scope);

    let cleaned = raw;
    let picked = null;
    if (matches.length) {
      cleaned = raw.replace(MARKER_RE, '').replace(/\n{3,}/g, '\n\n').trim();
      picked = pickMeme(pack, matches[0][1].trim(), rng, { recent });
      if (!picked) {
        logger?.warn?.(`[meme] 没有匹配到表情：${matches[0][1].trim()}`);
        return cleaned;
      }
    } else if (explicit) {
      const requestText = extractRequestText(ctx?.session);
      picked = pickMeme(pack, requestText, rng, { recent }) || pickRandomMeme(pack, rng, { recent });
      if (!picked) return raw;
    } else {
      return raw;
    }

    if (!allowed(ctx)) {
      if (config.debug) logger?.info?.('[meme] 当前会话不允许发表情');
      return cleaned;
    }

    // 明确要表情包：跳过概率与最小间隔；普通回复按 memeProbability 随机
    if (!explicit && rng() >= probability) {
      if (config.debug) logger?.info?.(`[meme] 本次未命中（p=${probability}）`);
      return cleaned;
    }

    if (!limiter(scope, explicit)) {
      if (config.debug) logger?.info?.('[meme] 触发限流');
      return cleaned;
    }

    rememberRecent(scope, picked.meme);

    // 只有标记、没有正文：直接发图
    if (!cleaned) {
      await sendMeme(ctx?.session, picked.meme, logger);
      return null;
    }

    // 有正文：先记下，等文字发完再补图
    pending.set(ctx.session, picked.meme);
    return cleaned;
  };

  const afterReply = async (ctx) => {
    const meme = pending.get(ctx.session);
    if (!meme) return;
    pending.delete(ctx.session);
    await sendMeme(ctx.session, meme, logger);
  };

  return { filter, afterReply };
}

module.exports = { createFilter, sendMeme, MARKER_RE, isExplicitRequest };
