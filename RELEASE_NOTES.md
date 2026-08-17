# FISHCODE v0.1.2

DeepSeek 全面涨价的背景下，本版聚焦**成本控制**与**预设能力**。

## 新增

- **托盘余额显示**：托盘菜单直接显示 DeepSeek 账户余额（只读扫描 `~/.dsh/.credentials.yaml` 的 `DEEPSEEK_API_KEY`，密钥仅用于请求头、绝不落日志；失败静默降级为单行提示）。一键「刷新余额」、一键「打开 DeepSeek 控制台」。实测当前余额：`¥12.39`。
- **内置 Router Standard 预设**：任务感知的思维模式路由预设，预设选择器可选「Router Standard (experimental)」。源码来自 [dsh-router-standard](https://github.com/yjh051108/dsh-router-standard)（MIT，© 2026 yjh051108），署名与衍生来源声明见 `THIRD_PARTY_NOTICES.md`。
- **预设 A/B 基准**（`scripts/bench/`）：可复现的首轮载荷测量 harness，实测数据见 `scripts/bench/BENCH.md`。

## 完善与优化（router-standard）

- 预设选择器的 router-standard 中文描述补充完整。
- 首轮只暴露一句话 persona + shell/编辑器（RL 接口还原）；首次工具调用后放开完整标准工具集。
- 针对弱模型（Flash）按任务分类注入推理引导，避免在庞大工具面与长系统提示上浪费推理与 token。
- 修正 `router-core.mjs` 中重复的注释行。

## 实测数据（deepseek-v4-flash）

首轮系统提示载荷（确定性测量，零 API 成本）：

| 预设 | section 文本 | 工具 schema | 首轮总载荷 | 工具数 |
|---|---|---|---|---|
| standard | 4,495 字符 | 29,045 字符 | **33,540 字符** | 26 |
| router-standard | 46 字符 | 6,802 字符 | **6,848 字符** | 2 |

→ 首轮总载荷 **-79.6%**（其中 section 文本 -99%），工具面 26 → 2。首轮之后完整工具集自动放开。

真实任务（统计当前目录 `.mjs` 文件数）：两者均在 1 个 assistant turn 内完成；router-standard 只用 1 次工具调用（直接 `pwsh`），standard 为 2 次（`glob` + `pwsh`）。
