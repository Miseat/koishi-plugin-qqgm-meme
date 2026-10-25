import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createFilter } = require('../lib/filter.js');
const { loadPacks } = require('../lib/loader.js');

const PACK = path.resolve('test/fixtures/pack');
const logger = { info() {}, warn() {} };

function makeSession(overrides = {}) {
  const sent = [];
  return {
    sent,
    guildId: '1103369527',
    userId: '692400912',
    messageId: 'm1',
    isDirect: false,
    send: async (segment) => sent.push(segment),
    ...overrides,
  };
}

function makeFilter(overrides = {}, rng = () => 0) {
  const pack = loadPacks(PACK);
  return createFilter(pack, {
    memeProbability: 1,
    minIntervalSeconds: 0,
    maxPerHour: 99,
    allowedGroups: [],
    blockedGroups: [],
    allowDirect: true,
    debug: false,
    ...overrides,
  }, logger, rng);
}

test('命中概率后：正文去掉标记，afterReply 再发图', async () => {
  const session = makeSession();
  const { filter, afterReply } = makeFilter();
  const out = await filter('行吧\n[表情: 开心]', { session, groupId: '1103369527' });
  assert.equal(out, '行吧');
  assert.equal(session.sent.length, 0, '文字发送前不应先发图');

  // 模拟引擎先发文字
  session.sent.push('text');
  await afterReply({ session, groupId: '1103369527', mode: 'reply', text: '行吧' });
  assert.equal(session.sent.length, 2);
  assert.equal(session.sent[0], 'text');
  assert.equal(session.sent[1].type, 'img');
  assert.match(session.sent[1].attrs.src, /^data:image\/jpeg;base64,/);
});

test('只有标记时直接发图并返回 null', async () => {
  const session = makeSession();
  const { filter } = makeFilter();
  const out = await filter('[表情: 开心]', { session, groupId: '1103369527' });
  assert.equal(out, null);
  assert.equal(session.sent.length, 1);
  assert.equal(session.sent[0].type, 'img');
});

test('概率未命中：只删标记，不发图', async () => {
  const session = makeSession();
  const { filter, afterReply } = makeFilter({ memeProbability: 0 });
  const out = await filter('哈哈 [表情: 开心]', { session, groupId: '1103369527' });
  assert.equal(out, '哈哈');
  await afterReply({ session, groupId: '1103369527', mode: 'reply', text: '哈哈' });
  assert.equal(session.sent.length, 0);
});

test('匹配不到情绪：只删标记，不发图', async () => {
  const session = makeSession();
  const { filter } = makeFilter();
  const out = await filter('嗯 [表情: 完全不存在]', { session, groupId: '1103369527' });
  assert.equal(out, '嗯');
  assert.equal(session.sent.length, 0);
});

test('限流：间隔内第二次不再发图', async () => {
  const session = makeSession();
  const { filter } = makeFilter({ minIntervalSeconds: 60 });
  await filter('[表情: 开心]', { session, groupId: '1103369527' });
  const out = await filter('[表情: 生气]', { session, groupId: '1103369527' });
  assert.equal(out, '');
  assert.equal(session.sent.length, 1);
});

test('群限制：不在允许列表时不发图', async () => {
  const session = makeSession();
  const { filter } = makeFilter({ allowedGroups: ['999'] });
  await filter('[表情: 开心]', { session, groupId: '1103369527' });
  assert.equal(session.sent.length, 0);
});

test('私聊：allowDirect=false 时不发图', async () => {
  const session = makeSession({ isDirect: true, guildId: undefined });
  const { filter } = makeFilter({ allowDirect: false });
  await filter('[表情: 开心]', { session, groupId: 'private:692400912' });
  assert.equal(session.sent.length, 0);
});

test('没有标记时原样返回', async () => {
  const session = makeSession();
  const { filter } = makeFilter();
  assert.equal(await filter('普通回复', { session, groupId: '1103369527' }), '普通回复');
  assert.equal(session.sent.length, 0);
});

test('用户明确要表情包：没有标记也发', async () => {
  const session = makeSession({ content: '来个表情包' });
  const { filter, afterReply } = makeFilter({ memeProbability: 0 });
  const out = await filter('行', { session, groupId: '1103369527' });
  assert.equal(out, '行');
  await afterReply({ session, groupId: '1103369527', mode: 'reply', text: '行' });
  assert.equal(session.sent.length, 1);
  assert.equal(session.sent[0].type, 'img');
});

test('用户明确要表情包：有标记时跳过概率', async () => {
  const session = makeSession({ content: '斗图，来个表情包' });
  const { filter, afterReply } = makeFilter({ memeProbability: 0 });
  const out = await filter('来 [表情: 开心]', { session, groupId: '1103369527' });
  assert.equal(out, '来');
  await afterReply({ session, groupId: '1103369527', mode: 'reply', text: '来' });
  assert.equal(session.sent.length, 1);
});

test('普通回复仍然受概率限制', async () => {
  const session = makeSession({ content: '今天好累' });
  const { filter, afterReply } = makeFilter({ memeProbability: 0 });
  const out = await filter('那就早点睡 [表情: 开心]', { session, groupId: '1103369527' });
  assert.equal(out, '那就早点睡');
  await afterReply({ session, groupId: '1103369527', mode: 'reply', text: '那就早点睡' });
  assert.equal(session.sent.length, 0);
});
