import { test } from 'node:test';
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
      },
      qqgmAiHooks: registry,
    },
    warnings,
    runDispose() {
      if (dispose) dispose();
    },
  };
}

test('注册表情包提示词、过滤器与 afterReply', async () => {
  const registry = createFakeHooks();
  const { ctx, runDispose } = makeCtx(registry);
  plugin.apply(ctx, baseConfig);

  const counts = registry.counts;
  assert.equal(counts.sections, 1, '应注册一个提示词段');
  assert.equal(counts.filters, 1, '应注册一个输出过滤器');
  assert.equal(counts.afters, 1, '应注册一个 afterReply');

  const sections = await registry.collectSections({});
  assert.equal(sections.length, 1);
  assert.match(sections[0], /【表情包能力】/);
  assert.match(sections[0], /happy/);

  runDispose();
  assert.equal((await registry.collectSections({})).length, 0);
});

test('没有 qqgmAiHooks 时安全跳过', () => {
  const { ctx, warnings } = makeCtx(undefined);
  assert.doesNotThrow(() => plugin.apply(ctx, baseConfig));
  assert.ok(warnings.some((line) => /qqgmAiHooks/.test(line)));
});
