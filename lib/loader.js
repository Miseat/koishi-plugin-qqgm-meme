const fs = require('node:fs');
const path = require('node:path');

/** 读取单个表情包目录（memes.json + 图片），跳过缺失/坏条目。 */
function readPack(dir) {
  const file = path.join(dir, 'memes.json');
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const memes = [];
  for (const item of data.memes || []) {
    if (!item || !item.path || !item.caption) continue;
    const rel = String(item.path).replace(/\\/g, '/');
    const abs = path.join(dir, rel);
    if (!fs.existsSync(abs)) continue;
    memes.push({
      path: rel,
      abs,
      pack: String(data.id || path.basename(dir)),
      packName: String(data.name || data.id || path.basename(dir)),
      hash: String(item.file_hash || ''),
      tag: String(item.tag || '').trim(),
      caption: String(item.caption).trim(),
      keywords: String(item.keywords || '').trim(),
    });
  }
  return {
    id: String(data.id || path.basename(dir)),
    name: String(data.name || data.id || path.basename(dir)),
    memes,
  };
}

/**
 * 加载一个根目录下的所有表情包：
 * - root/memes.json 存在 → 当成单个图库（向后兼容）
 * - 否则扫描 root 的子目录，每个含 memes.json 的子目录是一个图库
 * 按 file_hash（没有则按绝对路径）去重。
 */
function loadPacks(rootDir) {
  const dirs = [];
  if (fs.existsSync(path.join(rootDir, 'memes.json'))) {
    dirs.push(rootDir);
  } else if (fs.existsSync(rootDir)) {
    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(path.join(rootDir, entry.name));
    }
  }

  const packs = [];
  const memes = [];
  const seen = new Set();
  for (const dir of dirs) {
    let pack;
    try {
      pack = readPack(dir);
    } catch {
      continue;
    }
    if (!pack || !pack.memes.length) continue;
    let added = 0;
    for (const meme of pack.memes) {
      const key = meme.hash || meme.abs;
      if (seen.has(key)) continue;
      seen.add(key);
      memes.push(meme);
      added += 1;
    }
    if (added) packs.push({ id: pack.id, name: pack.name, count: added });
  }

  const tags = new Map();
  for (const meme of memes) {
    if (!meme.tag) continue;
    if (!tags.has(meme.tag)) tags.set(meme.tag, []);
    tags.get(meme.tag).push(meme);
  }

  return { packs, memes, tags };
}

module.exports = { loadPacks, readPack };
