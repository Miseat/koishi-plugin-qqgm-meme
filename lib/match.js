/**
 * 表情包匹配：
 * - caption 原文 / 包含 / 关键词 → 定位到具体一张的“情绪标签”
 * - 情绪词（中文别名或 tag）→ 从该情绪里随机抽一张
 * 拿不准返回 null。
 *
 * 关键点：很多情绪标签只有 1 张图（baka/sigh/see/fool/surprised/...），
 * 如果只按标签抽，就永远是同一张。这里把“小标签”映射到一个更大的同族标签池，
 * 同时避开最近刚发过的图，保证轮换。
 */

const PUNCT = /[\s，。！？、；：,.!?;:（）()【】\[\]“”"'‘’…~～]/g;

const TAG_ALIASES = {
  happy: ['开心', '高兴', '好耶', '得意', '满意'],
  like: ['喜欢', '比心', '卖萌'],
  color: ['花痴', '心动', '爱心眼'],
  meow: ['猫', '猫爪', '可爱'],
  daily: ['干饭', '吃饭', '饿', '日常'],
  sleep: ['睡觉', '困', '晚安'],
  morning: ['早上好', '早安', '你好', '打招呼'],
  work: ['摸鱼', '躺平', '下班'],
  cpu: ['加班', '累', '卡'],
  sad: ['难过', '委屈', '求饶', '哭', '道歉', '对不起'],
  sigh: ['无语', '叹气', '无奈'],
  confused: ['困惑', '疑惑', '问号', '加载', '懵', '思考'],
  surprised: ['震惊', '惊讶', '吓', '啊'],
  see: ['看戏', '围观', '看到'],
  fool: ['拒绝', '不行', '不要'],
  givemoney: ['打赏', '给钱', '钱包', '求钱'],
  baka: ['嫌弃', '吐槽', '傻瓜'],
  angry: ['生气', '愤怒', '不爽'],
  shy: ['害羞', '脸红', '偷看', '腼腆'],
};

/** 小标签 → 同族大标签（第一个是自己）。用来扩充候选池，避免永远同一张。 */
const TAG_FAMILY = {
  baka: ['baka', 'angry'],
  sigh: ['sigh', 'sad'],
  see: ['see', 'confused'],
  fool: ['fool', 'angry'],
  surprised: ['surprised', 'confused'],
  like: ['like', 'happy'],
  color: ['color', 'happy'],
  meow: ['meow', 'happy'],
  sleep: ['sleep', 'daily'],
  morning: ['morning', 'happy'],
  work: ['work', 'daily'],
  cpu: ['cpu', 'sad'],
  givemoney: ['givemoney', 'happy'],
  shy: ['shy', 'happy'],
};

const HUGE_TAGS = ['happy', 'daily', 'angry', 'sad', 'confused'];

function normalize(text) {
  return String(text || '').replace(PUNCT, '').toLowerCase();
}

function tokenize(text) {
  const out = new Set();
  const source = String(text || '').toLowerCase();
  for (const part of source.split(/[^\u4e00-\u9fa5a-z0-9]+/)) {
    if (!part) continue;
    if (/^[a-z0-9]+$/.test(part)) {
      if (part.length >= 2) out.add(part);
      continue;
    }
    if (part.length <= 2) {
      out.add(part);
      continue;
    }
    out.add(part);
    for (let i = 0; i < part.length - 1; i += 1) out.add(part.slice(i, i + 2));
  }
  return [...out];
}

function resolveTag(pack, query) {
  const q = normalize(query);
  if (!q) return null;
  for (const tag of pack.tags.keys()) {
    if (normalize(tag) === q) return tag;
    for (const alias of TAG_ALIASES[tag] || []) {
      const a = normalize(alias);
      if (a === q || q.includes(a)) return tag;
    }
  }
  return null;
}

function memeKey(meme) {
  return `${meme.pack}/${meme.path}`;
}

/** 该标签的候选池：自己 + 同族标签，去重 */
function candidatesForTag(pack, tag) {
  const names = TAG_FAMILY[tag] || [tag];
  const seen = new Set();
  const out = [];
  for (const name of names) {
    for (const meme of pack.tags.get(name) || []) {
      const key = memeKey(meme);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ meme, tag: name });
    }
  }
  return out;
}

function pickFrom(pool, rng, recent) {
  if (!pool.length) return null;
  const avoid = new Set(Array.isArray(recent) ? recent : []);
  const fresh = pool.filter((item) => !avoid.has(memeKey(item.meme)));
  const list = fresh.length ? fresh : pool;
  const index = Math.min(list.length - 1, Math.floor(rng() * list.length));
  return list[index];
}

/**
 * @returns {{meme: object, tag: string, matchedBy: 'caption'|'keyword'|'tag'}|null}
 * @param options.recent 最近发过的图（memeKey 数组），用于避开重复
 */
function pickMeme(pack, query, rng = Math.random, options = {}) {
  const q = normalize(query);
  if (!q || !pack || !pack.memes.length) return null;
  const recent = options.recent || [];

  // 1) caption 原文 / 包含：用它定位到标签，再从该标签的同族池里随机
  //    不能直接返回这一张，否则“嫌弃”永远发 xianqi.jpg
  let hintedTag = null;
  for (const meme of pack.memes) {
    if (normalize(meme.caption) === q) { hintedTag = meme.tag; break; }
  }
  if (!hintedTag) {
    for (const meme of pack.memes) {
      const caption = normalize(meme.caption);
      if (caption.includes(q) || (q.length >= 4 && q.includes(caption))) { hintedTag = meme.tag; break; }
    }
  }
  if (hintedTag) {
    const picked = pickFrom(candidatesForTag(pack, hintedTag), rng, recent);
    if (picked) return { meme: picked.meme, tag: picked.tag, matchedBy: 'caption' };
  }

  // 2) 关键词打分（够强才认）
  const tokens = tokenize(query);
  if (tokens.length) {
    let best = null;
    let bestScore = 0;
    for (const meme of pack.memes) {
      const haystack = normalize(`${meme.caption} ${meme.keywords} ${meme.tag}`);
      let hit = 0;
      for (const token of tokens) if (haystack.includes(token)) hit += 1;
      const score = hit / Math.max(1, tokens.length);
      if (score > bestScore) {
        bestScore = score;
        best = meme;
      }
    }
    if (best && bestScore >= 0.5) {
      const picked = pickFrom(candidatesForTag(pack, best.tag), rng, recent) || { meme: best, tag: best.tag };
      return { meme: picked.meme, tag: picked.tag, matchedBy: 'keyword' };
    }
  }

  // 3) 情绪词 → 该情绪（含同族）里随机一张
  const tag = resolveTag(pack, query);
  if (tag) {
    const picked = pickFrom(candidatesForTag(pack, tag), rng, recent);
    if (picked) return { meme: picked.meme, tag: picked.tag, matchedBy: 'tag' };
  }

  return null;
}

/** 明确要表情包但说不清情绪时：从几个大标签里随机，避开最近发过的 */
function pickRandomMeme(pack, rng = Math.random, options = {}) {
  if (!pack || !pack.memes.length) return null;
  const recent = options.recent || [];
  const pool = [];
  for (const tag of HUGE_TAGS) {
    for (const meme of pack.tags.get(tag) || []) pool.push({ meme, tag });
  }
  const source = pool.length ? pool : pack.memes.map((meme) => ({ meme, tag: meme.tag }));
  const picked = pickFrom(source, rng, recent);
  return picked ? { meme: picked.meme, tag: picked.tag, matchedBy: 'random' } : null;
}

module.exports = {
  pickMeme,
  pickRandomMeme,
  resolveTag,
  normalize,
  tokenize,
  memeKey,
  TAG_ALIASES,
  TAG_FAMILY,
};
