import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const plugin = require('../index.js');

// 只依赖 qqgmAiHooks 的公开契约，不跨仓库 require 主插件
function createFakeHooks() {
  const sections = new Set();
  const filters = new Set();
  const afters = new Set();
  return {
    version: 1,
    registerPromptSection(fn) {
      sections.add(fn);
      return () => sections.delete(fn);
    },
    registerOutputFilter(fn) {
      filters.add(fn);
      return () => filters.delete(fn);
    },
    registerAfterReply(fn) {
      afters.add(fn);
      return () => afters.delete(fn);
    },
    async collectSections(ctx) {
      const out = [];
      for (const fn of sections) {
        const text = await fn(ctx);
        if (text && String(text).trim()) out.push(String(text).trim());
      }
      return out;
    },
    async applyFilters(text, ctx) {
      let current = String(text);
      for (const fn of filters) {
        const next = await fn(current, ctx);
        if (next == null) return null;
        current = String(next);
      }
      return current;
    },
    async runAfterReply(ctx) {
      for (const fn of afters) await fn(ctx);
    },
    get counts() {
      return { sections: sections.size, filters: filters.size, afters: afters.size };
    },
  };
}

const FIXTURES = path.resolve('test/fixtures');
const baseConfig = {
  memeRoot: 'pack',
  memeProbability: 1,
  allowDirect: true,
  allowedGroups: [],
  blockedGroups: [],
  minIntervalSeconds: 0,
  maxPerHour: 99,
  debug: false,
};

function makeCtx(registry) {
  const warnings = [];
  const handlers = {};
  let dispose = null;
  const logger = {
    info() {},
    warn(message) {
      warnings.push(String(message));
    },
  };
  return {
    ctx: {
      baseDir: FIXTURES,
      logger: () => logger,
      on(event, handler) {
        if (event === 'dispose') dispose = handler;
        else handlers[event] = handler;
      },
      qqgmAiHooks: registry,
      get(key) { return key === 'qqgmAiHooks' ? registry : undefined; },
    },
    warnings,
    fireReady() {
      if (handlers.ready) handlers.ready();
    },
    runDispose() {
      if (dispose) dispose();
    },
  };
}

test('注册表情包提示词、过滤器与 afterReply', async () => {
  const registry = createFakeHooks();
  const { ctx } = makeCtx(registry);
  plugin.apply(ctx, baseConfig);

  const counts = registry.counts;
  assert.equal(counts.sections, 1, '应注册一个提示词段');
  assert.equal(counts.filters, 1, '应注册一个输出过滤器');
  assert.equal(counts.afters, 1, '应注册一个 afterReply');

  const sections = await registry.collectSections({});
  assert.equal(sections.length, 1);
  assert.match(sections[0], /【表情包能力】/);
  assert.match(sections[0], /happy/);
});

test('dispose 后注销全部钩子', async () => {
  const registry = createFakeHooks();
  const { ctx, runDispose } = makeCtx(registry);
  plugin.apply(ctx, baseConfig);
  runDispose();
  assert.equal(registry.counts.sections, 0);
  assert.equal(registry.counts.filters, 0);
  assert.equal(registry.counts.afters, 0);
});

test('没有 qqgmAiHooks 时安全跳过：ready 后才给出提示', () => {
  const { ctx, warnings, fireReady } = makeCtx(undefined);
  assert.doesNotThrow(() => plugin.apply(ctx, baseConfig));
  assert.equal(warnings.length, 0, 'apply 阶段不应立即告警（主插件可能稍后挂载）');
  fireReady();
  assert.ok(warnings.some((line) => /qqgmAiHooks/.test(line)), 'ready 后应提示缺少扩展点');
});

test('主插件晚于本插件挂载时，ready 能补挂成功', async () => {
  let registry;
  const warnings = [];
  const handlers = {};
  const logger = { info() {}, warn: (m) => warnings.push(String(m)) };
  const ctx = {
    baseDir: FIXTURES,
    logger: () => logger,
    on(event, handler) {
      handlers[event] = handler;
    },
    get(key) {
      return key === 'qqgmAiHooks' ? registry : undefined;
    },
  };
  plugin.apply(ctx, baseConfig);
  assert.equal(warnings.length, 0);

  // 模拟主插件此时才把扩展点挂上
  registry = createFakeHooks();
  handlers.ready();

  const counts = registry.counts;
  assert.equal(counts.sections, 1, 'ready 后应补挂提示词段');
  assert.equal(counts.filters, 1);
  assert.equal(counts.afters, 1);
  assert.ok(!warnings.some((line) => /未找到/.test(line)));
});

test('inject 为空，不声明 Koishi 服务依赖', () => {
  assert.deepEqual(plugin.inject, [], 'inject 应为空数组，避免 Koishi 等待不存在的服务');
});
