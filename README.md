# @nestim/koishi-plugin-qqgm-meme

Koishi 表情包插件，配合 [`@nestim/koishi-plugin-qq-group-manager`](https://www.npmjs.com/package/@nestim/koishi-plugin-qq-group-manager) 使用。

**让 AI 用 `[表情: 情绪]` 表达想发哪类图，插件按概率从本地图库抽一张，补在文字后面。**

## 相关插件

| 插件 | 说明 |
| --- | --- |
| [`@nestim/koishi-plugin-qq-group-manager`](https://github.com/Miseat/koishi-plugin-qq-group-manager) | **主插件**：群管、自动管控、AI 回复、记忆库、识图、定时提醒 |
| [`@nestim/koishi-plugin-qqgm-chat-style`](https://github.com/Miseat/koishi-plugin-qqgm-chat-style) | 聊天风格：主风格 + 按概率叠加的追加风格 |
| **`@nestim/koishi-plugin-qqgm-meme`** | 本插件：表情包 |

三个包都依赖主插件暴露的 `qqgmAiHooks` 扩展点，可以一起装，也可以只装需要的。

## 特性

| 能力 | 说明 |
| --- | --- |
| **情绪标签** | 提示词只列情绪与数量，不把全部 caption 塞进去；模型按 `[表情: 开心]` 表达 |
| **概率控制** | 文字发完后再掷一次随机，命中才补图，避免话没说完就甩图 |
| **先文后图** | 由 `afterReply` 钩子负责，保证顺序是「文字 → 图片」 |
| **多图库** | 扫描目录下所有图库，按 `file_hash` 去重，同一个图不会重复入库 |
| **去重窗口** | 每个会话记住最近发过的 N 张，选图优先避开，不会来回就那几张 |
| **限流** | 同群/同用户最小间隔 + 每小时上限 |
| **群白黑名单** | 允许列表 / 屏蔽列表，留空表示不限 |
| **明确要图** | 用户说「来个表情包」「斗图」时跳过概率限制，直接发一张 |

## 安装

```sh
npm i @nestim/koishi-plugin-qqgm-meme
```

需要先启用主插件（`>= 1.2.5`，提供 `registerAfterReply`）。

## 准备图库

```text
data/memes/
├── 图库甲/
│   ├── memes.json
│   └── memes/
│       ├── happy/001.jpg
│       └── angry/002.jpg
└── 图库乙/
    ├── memes.json
    └── memes/...
```

`memes.json` 描述每张图的标签与 caption。加载时会校验图片是否存在，缺图会被跳过。

## 配置

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| 表情包根目录 | `data/memes` | 相对 Koishi 数据目录 |
| 追加概率 | `0.3` | 文字回复后补图的概率（0~1） |
| 私聊允许 | `true` | 私聊是否发表情包 |
| 允许群号 | `[]` | 留空 = 所有群 |
| 屏蔽群号 | `[]` | |
| 最小间隔 | `15` | 同群/同用户两次表情包的最小间隔（秒） |
| 每小时上限 | `8` | 同群/同用户每小时最多几张 |
| 去重窗口 | `8` | 记住最近几张，选图时避开 |
| 调试日志 | `false` | 打印匹配/概率/限流细节 |

## 与主插件的接口

只依赖 `ctx.qqgmAiHooks`（接口版本 >= 1）：

- `registerPromptSection()` —— 告诉模型有哪些情绪可用
- `registerOutputFilter()` —— 解析 `[表情: 情绪]` 标记、掷概率
- `registerAfterReply()` —— 文字发完后补图

不注册群管指令，不碰触发逻辑和上下文，不读写数据库。

## 开源

MIT。欢迎改、欢迎提 PR。

- GitHub: <https://github.com/Miseat/koishi-plugin-qqgm-meme>
- 主插件: <https://github.com/Miseat/koishi-plugin-qq-group-manager>
- 风格插件: <https://github.com/Miseat/koishi-plugin-qqgm-chat-style>
