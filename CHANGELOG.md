# Changelog

## [v0.1.2] - 2026-08-17

### 新增

- **托盘余额显示（成本控制）**：DeepSeek 全面涨价的背景下，托盘菜单直接显示账户余额。从 `~/.dsh/.credentials.yaml` 只读扫描 `DEEPSEEK_API_KEY`（兼容 `DEEPSEEK_API_KEY: '…'` / `"…"` / 裸值，块标量等歧义情况直接拒绝），请求官方 `https://api.deepseek.com/user/balance`（10s 超时）。菜单带「刷新余额」与「打开 DeepSeek 控制台」。密钥只用于 Authorization 头，**绝不落日志**；失败静默降级为单行提示，不影响任何功能。实测当前余额：`¥12.39`。
- **内置 Router Standard 预设**：任务感知的思维模式路由预设，预设选择器可选「Router Standard (experimental)」。源码在 `vendor/agent-presets/router-standard/`，来自 [dsh-router-standard](https://github.com/yjh051108/dsh-router-standard)（MIT，© 2026 yjh051108），由 `scripts/vendor-agent-presets.mjs` 在 `dsh-bundle` 安装后拷入后端内置预设目录；授权与衍生来源声明见 `THIRD_PARTY_NOTICES.md`。
- **预设 A/B 基准（`scripts/bench`）**：可复现的首轮载荷测量 harness，见 [scripts/bench/BENCH.md](./scripts/bench/BENCH.md)。

### 完善

- 预设选择器里 router-standard 的中文描述补充完整（首轮瘦身机制 + 弱模型推理成本优化说明）。

### Router Standard 优化

- 首轮只暴露一句话 persona + shell/编辑器（RL 接口还原，首轮系统提示大幅缩短）；首次工具调用后放开完整标准工具集。
- 针对弱模型（Flash）按任务分类注入推理引导，首轮不铺开全部工具，避免模型在庞大工具面与长系统提示上浪费推理与 token。
- 修正 `router-core.mjs` 中重复的注释行。

### 实测数据（deepseek-v4-flash）

首轮系统提示载荷（确定性测量，零 API 成本，详见 `scripts/bench/BENCH.md`）：

| 预设 | section 文本 | 工具 schema | 首轮总载荷 | 工具数 |
|---|---|---|---|---|
| standard | 4,495 字符 | 29,045 字符 | **33,540 字符** | 26 |
| router-standard | 46 字符 | 6,802 字符 | **6,848 字符** | 2 |

→ 首轮总载荷 **-79.6%**（section 文本 **-99%**），工具面 26 → 2。真实任务（统计当前目录 `.mjs` 文件数）两者均在 1 个 assistant turn 内完成，router-standard 只用 1 次工具调用（直接 `pwsh`）vs standard 的 2 次（`glob` + `pwsh`）。

## [v0.1.1] - 2026-08-14

- 修复：桌宠位置钳制（拖拽越界后位置卡死）。

## [v0.1.0] - 2026-08-12

- 首次发布：Electron 桌面壳 + DeepSeek Harness 后端，含主窗口、托盘/快捷键/开机自启/系统通知、桌面萌宠（原创角色「蓝汐」，EmoteLab 素材）、新手向导、任务完成监听、右键「用 FISHCODE 打开」、视觉服务一键配置、启动加载页、CI 四平台构建（Windows / macOS arm64 / Linux）。
- 随依赖分发的第三方组件：`@deepseek-ai/dsh`、`@anionex/dsh-vision-toolkit` 等，许可证随包分发。

[unreleased]: https://github.com/yoke626/Fishcode/compare/v0.1.1...HEAD
[v0.1.2]: https://github.com/yoke626/Fishcode/compare/v0.1.1...v0.1.2
[v0.1.1]: https://github.com/yoke626/Fishcode/compare/v0.1.0...v0.1.1
[v0.1.0]: https://github.com/yoke626/Fishcode/releases/tag/v0.1.0
