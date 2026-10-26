# 更新日志

本文件记录所有值得注意的变更。版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 1.0.1

### 修复

- **配置页不再错误显示「必需服务：qqgmAiHooks（未加载）」**。

  `qqgmAiHooks` 是主插件用 `ctx.root.set()` 挂上去的普通对象，不是 Koishi 的 Service。
  写 `inject` 会让 Koishi 等一个永远不会注册的服务。

  改为运行时探测（`ctx.get()`）+ `ready` 重试。

- 移除 package.json 里无效的 `koishi.service.required` 字段。
- 依赖改为 `peerDependencies`：`@nestim/koishi-plugin-qq-group-manager >= 1.2.5`。

## 1.0.0

### 首个公开版本

- **情绪标签**：提示词只列情绪与数量，模型按 `[表情: 开心]` 表达想发哪类图
- **概率控制**：文字发完后再掷一次随机，命中才补图
- **先文后图**：由 `afterReply` 钩子负责，保证顺序是「文字 → 图片」
- **多图库**：扫描目录下所有图库，按 `file_hash` 去重
- **去重窗口**：每个会话记住最近发过的 N 张，选图优先避开
- **限流**：同群/同用户最小间隔 + 每小时上限
- **群白黑名单**：允许列表 / 屏蔽列表
- **明确要图**：用户说「来个表情包」「斗图」时跳过概率限制，直接发一张
