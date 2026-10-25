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
/**
 * 不写 inject。
 *
 * qqgmAiHooks 是主插件用 ctx.root.set() 挂上去的普通对象，不是 Koishi Service。
 * inject 只解析 Service，写了反而让 Koishi 一直等一个不会出现的服务（配置页会显示未就绪）。
 * 这里改成运行时探测，拿不到就等 ready 再试，最后才给一条明确日志。
 */
const inject = [];

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

  // 只用 get() 读取：直接访问未注册属性会触发 Koishi 的 "not registered" 告警
  const findHooks = () => {
    const read = (target, key) => {
      try {
        return target && typeof target.get === 'function' ? target.get(key) : null;
      } catch {
        return null;
      }
    };
    return read(ctx.root, 'qqgmAiHooks')
      || read(ctx, 'qqgmAiHooks')
      || (read(ctx.root, 'nestimQqGroupManager') || {}).aiHooks
      || (read(ctx, 'nestimQqGroupManager') || {}).aiHooks
      || null;
  };

  const offs = [];
  let mounted = false;

  const mount = (hooks) => {
    mounted = true;
    const prompt = buildPrompt(pack);
    const { filter, afterReply } = createFilter(pack, config, logger);

    offs.push(hooks.registerPromptSection(() => prompt));
    offs.push(hooks.registerOutputFilter(filter));
    offs.push(hooks.registerAfterReply(afterReply));

    const total = pack.memes.length;
    const packs = pack.packs.map((item) => `${item.name}(${item.count})`).join('、');
    logger.info(`已加载表情包 ${pack.packs.length} 个图库 / ${total} 张：${packs}`);
    logger.info(`[meme] 追加概率=${config.memeProbability}，间隔=${config.minIntervalSeconds}s，每小时上限=${config.maxPerHour}，去重窗口=${config.recentLimit ?? 8}`);
    if (config.debug) logger.info(`[debug] root=${root} 情绪=${[...pack.tags.keys()].join(',')}`);
  };

  const tryMount = () => {
    if (mounted) return true;
    const hooks = findHooks();
    if (!hooks || typeof hooks.registerPromptSection !== 'function') return false;
    if (typeof hooks.registerAfterReply !== 'function') {
      logger.warn('当前 qqgmAiHooks 不支持 registerAfterReply（需要主插件 >= 1.2.5），表情包插件不启用');
      return false;
    }
    mount(hooks);
    return true;
  };

  if (!tryMount()) {
    ctx.on('ready', () => {
      if (mounted) return;
      if (!tryMount()) {
        logger.warn(
          '未找到 qqgmAiHooks 扩展点：请确认已启用并与本插件同时加载 @nestim/koishi-plugin-qq-group-manager（>= 1.2.5）',
        );
      }
    });
  }

  ctx.on('dispose', () => {
    for (const off of offs) {
      try {
        off();
      } catch { /* 忽略 */ }
    }
    offs.length = 0;
    mounted = false;
  });
}

module.exports = { name, inject, Config, apply };
