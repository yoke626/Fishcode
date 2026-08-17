# Agent-Preset A/B Bench

对比会话预设在同一模型下的**首轮系统提示载荷**与真实任务表现。基准没有硬编码数值，每次运行都重新测量，可复现。

## 测什么

dsh 每个模型请求的 prompt = 系统提示 section 文本 + 工具 schema（API 的 `tools` 字段）。两者都计费。本基准：

1. **首轮载荷（确定性、零 API 成本）**：骑在 dsh-headless 上，为每个预设新建一个 Agent、`mount` 预设，然后用与真实请求完全相同的 `systemPrompt.assemble({ scope: agent, agent })` 触发首轮组装（`assembleContextFor` 的形状——scope 必须是 **agent 对象**，否则 agent 作用域处理器不参与分发，测量会失真），读出最终组装结果的 section 文本字符数与工具 schema 序列化字符数。
2. **真实任务（可选 `--live`，消耗少量 token）**：给 Agent 发一条真实任务，记录工具调用数、assistant 轮数、输出字符数。

首轮是路径决定的昂贵轮次（铺开全部 sections + 26 个工具 schema）。瘦掉它意味着第一轮请求的 prompt token 直接下降。

## 用法

```bash
# 首轮载荷对比（零成本，默认 standard vs router-standard）
node scripts/bench/run-bench.mjs

# 指定预设
node scripts/bench/run-bench.mjs --preset router-standard --preset standard

# 加一轮真实任务（消耗少量 token）
node scripts/bench/run-bench.mjs --live --task "Count the .mjs files in the current working directory."
```

机制：把 bench profile 拷进 `~/.dsh/profiles/bench/`，用仓库自己的 dsh CLI 按预设分别启动（`cordis.patch.yml` 关掉 stock 的一次性 runner，插入 `bench-runner`）。

## 实测数据

模型：`deepseek-v4-flash`（reasoningEffort: high）。环境：Windows，pwsh。

### 首轮系统提示载荷（确定性测量）

| 预设 | section 文本 | 工具 schema | 首轮总载荷 | 工具数 |
|---|---|---|---|---|
| standard | 4,495 字符 | 29,045 字符 | **33,540 字符** | 26 |
| router-standard | 46 字符 | 6,802 字符 | **6,848 字符** | 2 |

→ 首轮总载荷 **-79.6%**；其中 section 文本 **-99%**（4,495 → 46 字符）。
→ 工具面从 26 个 schema 收到 `pwsh` + `str_replace_editor`（RL 接口还原：首轮只有 shell/编辑器，模型「想一段、做一段」）。

> 首轮瘦身是**第一轮专用**：会话出现首次 `tool/call` 后，`router-bootstrap` 返回 `{ ...assembled, sections, contexts: [] }` 恢复完整标准工具集（`router-bootstrap.mjs:104`）。

### 真实任务（live）

任务：`Count the .mjs files in the current working directory. Report just the number.`

| 预设 | 工具调用数 | 工具 | assistant 轮数 | 输出 |
|---|---|---|---|---|
| standard | 2 | glob, pwsh | 1 | 1 字符 |
| router-standard | 1 | pwsh | 1 | 1 字符 |

→ 首轮只有 shell/编辑器时，模型直接用 `pwsh` 完成，未多出一次 `glob` 调用；两者都在 1 个 assistant turn 内完成任务。

### 结论

- 在**路径决定的昂贵首轮**上，router-standard 把系统提示 + 工具 schema 载荷压缩 79.6%（section 文本压缩 99%），直接降低首轮 prompt token 成本。
- 瘦身没有损害任务完成能力：真实任务同等完成，且工具调用数未增加。
- 首轮之后完整工具集自动放开，后续轮次不受影响。

## 注意

- `run-bench.mjs` 依赖仓库的 `dsh-bundle`（`npm ci` 之后）。`bench-runner.mjs` 里的使用计数解析 DeepSeek snake_case usage 字段；headless 驱动的会话事件当前不携带 usage，故 live 表里的 token 数留空——首轮载荷字符数就是最直接的 token 代理。
