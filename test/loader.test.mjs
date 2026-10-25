import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { loadPacks } = require('../lib/loader.js');
const { pickMeme } = require('../lib/match.js');
const { buildPrompt } = require('../lib/prompt.js');

const PACK = path.resolve('test/fixtures/pack');
const MULTI = path.resolve('test/fixtures/multi');

test('加载单个图库：跳过缺失图片', () => {
  const pack = loadPacks(PACK);
  assert.equal(pack.memes.length, 2);
  assert.equal(pack.packs.length, 1);
  assert.ok(pack.memes.every((meme) => meme.caption && meme.abs));
});

test('加载多个图库并按 file_hash 去重', () => {
  const pack = loadPacks(MULTI);
  assert.equal(pack.memes.length, 2);
  assert.equal(pack.packs.length, 1, '全是重复条目的图库应被跳过');
  assert.equal(pack.packs[0].id, 'fixture');
});

test('caption 原文精确匹配', () => {
  const pack = loadPacks(PACK);
  const hit = pickMeme(pack, '气鼓鼓叉腰，额头怒气符号，蒸汽直冒');
  assert.ok(hit);
  assert.equal(hit.meme.tag, 'angry');
  assert.equal(hit.matchedBy, 'caption');
});

test('关键词匹配', () => {
  const pack = loadPacks(PACK);
  assert.equal(pickMeme(pack, '好耶')?.meme.tag, 'happy');
  assert.equal(pickMeme(pack, '生气')?.meme.tag, 'angry');
});

test('情绪词从对应情绪里随机抽一张', () => {
  const pack = loadPacks(PACK);
  const hit = pickMeme(pack, '高兴', () => 0);
  assert.ok(hit);
  assert.equal(hit.tag, 'happy');
  assert.equal(hit.matchedBy, 'tag');
});

test('匹配不到返回 null', () => {
  const pack = loadPacks(PACK);
  assert.equal(pickMeme(pack, '完全无关的一句话'), null);
  assert.equal(pickMeme(pack, ''), null);
});

test('提示词只列情绪和数量，不列全部 caption', () => {
  const text = buildPrompt(loadPacks(PACK));
  assert.match(text, /【表情包能力】/);
  assert.match(text, /\[表情: 情绪\]/);
  assert.match(text, /happy（开心\/高兴/);
  assert.match(text, /× 1/);
  assert.doesNotMatch(text, /气鼓鼓叉腰/);
});
