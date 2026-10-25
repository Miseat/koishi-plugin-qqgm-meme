/**
 * qqgm-meme：依附于 @nestim/koishi-plugin-qq-group-manager 的表情包插件。
 *
 * - 提示词里只列情绪标签，让 AI 用 [表情: 情绪] 表达“想发哪类图”
 * - 输出过滤器按 memeProbability 完全随机决定这次到底发不发
 * - 命中后从该情绪里随机抽一张，等文字回复发送完再补图（afterReply）
 */
const path = require('node:path');
const { Schema } = require('koishi');
const { loadPacks } = require('./lib/loader');
const { buildPrompt } = require('./lib/prompt');
const { createFilter } = require('./lib/filter');

const name = 'qqgm-meme';
const inject = ['qqgmAiHooks'];

const Config = Schema.object({
  memeRoot: Schema.string().default('data/memes')
    .description('表情包根目录（相对 Koishi baseDir）；每个子目录是一个图库，含 memes.json 与图片。'),
  memeProbability: Schema.number().min(0).max(1).step(0.01).default(0.3)
    .description('文字回复后追加表情包的概率（0~1，完全随机）。'),
  allowDirect: Schema.boolean().default(true)
    .description('私聊是否允许发表情包。'),
  allowedGroups: Schema.array(String).role('table').default([])
    .description('允许发表情包的群号；留空 = 所有群。'),
  blockedGroups: Schema.array(String).role('table').default([])
    .description('禁止发表情包的群号。'),
  minIntervalSeconds: Schema.natural().min(0).max(3600).default(15)
    .description('同一个群/用户两次表情包的最小间隔（秒）。'),
  maxPerHour: Schema.natural().min(1).max(200).default(8)
    .description('同一个群/用户每小时最多发几张。'),
  recentLimit: Schema.natural().min(0).max(50).default(8)
    .description('每个群记住最近发过的几张，选图时优先避开，避免来回就那几张。'),
  debug: Schema.boolean().default(false)
    .description('日志里打印匹配/概率/限流细节。'),
});

function apply(ctx, config) {
  const logger = ctx.logger('qqgm-meme');
  const root = path.resolve(ctx.baseDir || process.cwd(), String(config.memeRoot || 'data/memes'));

  let pack;
  try {
    pack = loadPacks(root);
  } catch (error) {
    logger.warn(`加载表情包失败：${String(error)}`);
    return;
  }
  if (!pack.memes.length) {
    logger.warn(`表情包里没有可用图片：${root}`);
    return;
  }

  const hooks = ctx.qqgmAiHooks
    || (ctx.root && typeof ctx.root.get === 'function' ? ctx.root.get('qqgmAiHooks') : null)
    || (ctx.nestimQqGroupManager && ctx.nestimQqGroupManager.aiHooks);
  if (!hooks || typeof hooks.registerPromptSection !== 'function') {
    logger.warn('未找到 qqgmAiHooks 扩展点（需要 @nestim/koishi-plugin-qq-group-manager >= 1.2.5），表情包插件不启用');
    return;
  }
  if (typeof hooks.registerAfterReply !== 'function') {
    logger.warn('当前 qqgmAiHooks 不支持 registerAfterReply（需要主插件 >= 1.2.5），表情包插件不启用');
    return;
  }

  const prompt = buildPrompt(pack);
  const { filter, afterReply } = createFilter(pack, config, logger);

  const offPrompt = hooks.registerPromptSection(() => prompt);
  const offFilter = hooks.registerOutputFilter(filter);
  const offAfter = hooks.registerAfterReply(afterReply);

  const total = pack.memes.length;
  const packs = pack.packs.map((item) => `${item.name}(${item.count})`).join('、');
  logger.info(`已加载表情包 ${pack.packs.length} 个图库 / ${total} 张：${packs}`);
  logger.info(`[meme] 追加概率=${config.memeProbability}，间隔=${config.minIntervalSeconds}s，每小时上限=${config.maxPerHour}，去重窗口=${config.recentLimit ?? 8}`);
  if (config.debug) logger.info(`[debug] root=${root} 情绪=${[...pack.tags.keys()].join(',')}`);

  ctx.on('dispose', () => {
    offPrompt();
    offFilter();
    offAfter();
  });
}

module.exports = { name, inject, Config, apply };
