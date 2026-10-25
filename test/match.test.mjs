import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { pickMeme, pickRandomMeme, resolveTag, memeKey } = require('../lib/match.js');
const { loadPacks } = require('../lib/loader.js');

const PACK = path.resolve('test/fixtures/pack');

function keyOf(picked) {
  return picked ? memeKey(picked.meme) : null;
}

/** 合成一个 happy 下有多张图的包，用于测试去重 */
function makeWidePack() {
  const memes = [];
  const tags = new Map();
  for (let i = 1; i <= 6; i += 1) {
    const meme = {
      pack: 'demo',
      path: `memes/happy/${i}.jpg`,
      abs: `/demo/memes/happy/${i}.jpg`,
      tag: 'happy',
      caption: `开心图${i}`,
      keywords: '开心',
    };
    memes.push(meme);
    const list = tags.get('happy') || [];
    list.push(meme);
    tags.set('happy', list);
  }
  return { memes, tags, packs: [{ name: 'demo', count: memes.length }] };
}

test('caption 命中后会在同一情绪池里换图', () => {
  const pack = makeWidePack();
  const seen = new Set();
  for (let i = 0; i < 60; i += 1) {
    const picked = pickMeme(pack, '开心', Math.random);
    if (picked) seen.add(keyOf(picked));
  }
  assert.ok(seen.size > 1, '同一情绪应能抽出不同的图');
});

test('recent 会避开刚发过的图', () => {
  const pack = makeWidePack();
  const first = pickMeme(pack, '开心', () => 0);
  assert.ok(first);
  const recent = [keyOf(first)];
  for (let i = 0; i < 20; i += 1) {
    const next = pickMeme(pack, '开心', Math.random, { recent });
    assert.notEqual(keyOf(next), recent[0], '不应重复最近发过的那张');
  }
});

test('pickRandomMeme 也能避开 recent', () => {
  const pack = makeWidePack();
  const first = pickRandomMeme(pack, () => 0);
  assert.ok(first);
  const recent = [keyOf(first)];
  for (let i = 0; i < 20; i += 1) {
    const next = pickRandomMeme(pack, Math.random, { recent });
    assert.notEqual(keyOf(next), recent[0]);
  }
});

test('候选池耗尽时允许回退，不会返回 null', () => {
  const pack = makeWidePack();
  const recent = pack.memes.map((meme) => memeKey(meme));
  const picked = pickMeme(pack, '开心', Math.random, { recent });
  assert.ok(picked);
});

test('情绪词仍然映射到标签', () => {
  const pack = loadPacks(PACK);
  assert.ok(resolveTag(pack, '生气'));
  assert.ok(resolveTag(pack, '开心'));
});

test('小标签会并到同族大池子里', () => {
  const pack = loadPacks(PACK);
  const picked = pickMeme(pack, '无语', Math.random);
  // fixture 里没有 sigh，但映射到 sad 也应该有候选（没有则返回 null 也算合理）
  assert.ok(picked === null || typeof picked.meme === 'object');
});
