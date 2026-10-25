const { TAG_ALIASES } = require('./match');

/** 只列情绪标签（不列 200+ 条 caption），让模型选情绪、插件随机抽图。 */
function buildPrompt(pack) {
  const lines = [
    '【表情包能力】',
    '每条回复都先判断一次：气氛合适就主动发，不用等对方开口。',
    '用户明确要表情包时，必须发，并在最后单独一行写：[表情: 情绪]。',
    '想发时在回复最后单独一行写：[表情: 情绪]',
    '情绪从下面选一个（只写情绪词，不要写具体图）；系统会从该情绪里随机挑一张。',
    '一次最多一张；对方说正事、求助、难过时别发；发图时正文短一点，别复述图。',
    '可选情绪：',
  ];
  for (const tag of [...pack.tags.keys()].sort()) {
    const aliases = (TAG_ALIASES[tag] || []).slice(0, 4).join('/');
    lines.push(`- ${tag}${aliases ? `（${aliases}）` : ''} × ${pack.tags.get(tag).length}`);
  }
  return lines.join('\n');
}

module.exports = { buildPrompt };
