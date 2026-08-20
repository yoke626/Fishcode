# Changelog

## [v0.1.6] - 2026-08-20

### 新增

- **内置 dsh-routing-suite**：集成 `dsh-super-injector` 运行时注入器（v0.3.3）与 Router Standard / Router Spec 思维模式路由预设。
  - `dsh-super-injector` 提供 `dev_*` 工具全家桶（注入、热重载、卸载、插件状态、路由自愈等）。
  - 预设选择器新增 **Router Standard (experimental)** 与 **Router Spec (experimental)**。

## [v0.1.5] - 2026-08-19

### 升级

- **dsh 后端升级到 `@deepseek-ai/dsh@0.1.0-rc.7`**：跟随 DeepSeek Harness 官方候选版升级，为 rc.7 插件生态铺路；现有会话删除补丁、视觉补丁与内置 Router Standard 预设均已验证可继续工作。
- **内置视觉插件升级到 `@anionex/dsh-vision-toolkit@0.1.34`**：从 0.1.6 升级，带来透明变体路由、内置免费视觉、Windows Python 支持等新能力；同步适配 `scripts/patch-vision-vendor.mjs`，保留并兼容 0.1.34 新增的 focusin 预取逻辑，继续提供拖入图片转路径、超限图片自动压缩、`max_tokens` 钳制三处 vendored 补丁。

### 新增

- **内置 `dsh-genui`**：模型回答里可直接渲染可交互 UI（图表、表单、面板、测验、3D 等），无需额外安装。
- **内置 `dsh-better-sidebar`**：VSCode 风格右侧工作台（文件资源管理器 / 编辑器 / 终端 / Git / 内嵌浏览器）。
- **内置 dsh-web-ui 鲸鱼娘宠物 + 皮肤中心**：桌面端默认改用 web 内鲸鱼娘宠物，并内置 12 款皮肤可在设置中试穿/应用；原生桌面萌宠默认关闭，但保留为可选项（托盘可重新开启）。
- **内置 `dshmarket` 插件市场**：在 dsh 设置页里直接浏览、搜索、安装社区插件，方便发现更多插件。
- **插件挂载机制泛化**：`vision-toolkit.ts` 升级为通用 bundled-plugin 注册器，支持一次挂载多个内置插件；新增 `scripts/check-bundled-plugins.js` 与 `scripts/smoke-bundled-backend.mjs` 用于验证。

## [v0.1.4] - 2026-08-17

### 重构

- **会话删除改到侧边栏三点菜单**：移除独立的「会话管理」窗口，删除入口直接放进 dsh 侧边栏每个对话条的三点菜单（⋮ → 删除会话）。
  - 删除全程在主窗口内完成：菜单项注入 dsh 自带的会话行菜单（通过 `scripts/patch-session-delete.mjs` 补丁，随 `dsh-bundle` 安装自动应用），点击后主进程原生弹窗二次确认，确认后由独立的 Node 运行时删除 `~/.dsh/sessions/<scope>/session-<uuid>/` 文件夹，主窗口自动刷新、侧边栏同步消失。
  - 修复了原会话管理窗口在部分情况下进入删除流程后卡住无法操作的问题（窗口整体移除，问题不再存在）。
  - 保护逻辑保留：当前打开的会话、最近 60 秒内有写入（运行中）的会话自动拒绝删除；找不到的会话提示可能已删除。
  - **删除确认对话框的按键安全修复**：取消按钮置于首位且为默认按钮——按 ESC 或回车均只取消、不删除，只有显式点击「删除」才会真正删除。修复了测试中发现的原配置下按 ESC 会误删会话的问题。

## [v0.1.3] - 2026-08-17

### 新增

- **自动更新**：应用内自动检测 GitHub 新版本 → 下载 → 重启静默覆盖安装（`electron-updater`）。
  - 启动后约 5 秒在后台检查一次；托盘菜单新增「检查更新…」可随时手动检查。
  - 发现新版弹窗提示（当前版本 / 新版本 / 说明），确认后下载并在系统通知里显示进度；下载完成后可「立即重启安装」，或稍后再次触发。
  - 境内网络友好：更新源走 github.com 资产直链（`releases/latest/download/`，不经 `api.github.com`）；网络受限时弹窗提供「手动下载」一键跳转 GitHub Releases 页。
  - 数据安全：NSIS 覆盖式安装，`~/.dsh` 与 `%APPDATA%/fishcode`（设置、密钥、会话）均不受影响，无需先卸载。
  - 平台说明：macOS 未签名会被 Gatekeeper 拦截，不启用自动更新（保持手动安装）；Linux 仅 AppImage 版支持自动更新（deb 不支持）。
  - **注意：本版是首个带更新器的版本，需要手动安装一次；之后旧版本即可自动检测到新版本。**

- **会话管理（清理删不掉的聊天框）**：dsh 侧边栏里部分废弃会话没有删除入口（后端无删除 RPC、行菜单只有重命名/归档），本版在托盘菜单新增「会话管理…」独立窗口。
  - 按项目分组展示全部本地会话（标题 / 最近活跃 / 大小 / 当前打开 / 运行中 / 已损坏标记），支持标题搜索与「勾选空会话」一键选中所有无标题会话。
  - 批量删除前二次确认；当前打开的会话与最近 60 秒内有写入的会话自动保护不可删；删除后主窗口自动刷新，侧边栏同步消失。
  - 会话日志是 dsh 的多帧 zstd 格式（`~/.dsh/sessions/<scope>/session-<uuid>/session.jsonl.zstd`），由随包分发的独立 Node 24 运行时解析（Electron 自带的 Node 20 无 zstd 内建）；逐帧解码提取标题，损坏的日志文件以「已损坏」标记列出、不会拖垮整个列表，且可正常删除。

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

[unreleased]: https://github.com/yoke626/Fishcode/compare/v0.1.3...HEAD
[v0.1.4]: https://github.com/yoke626/Fishcode/compare/v0.1.3...v0.1.4
[v0.1.3]: https://github.com/yoke626/Fishcode/compare/v0.1.2...v0.1.3
[v0.1.2]: https://github.com/yoke626/Fishcode/compare/v0.1.1...v0.1.2
[v0.1.1]: https://github.com/yoke626/Fishcode/compare/v0.1.0...v0.1.1
[v0.1.0]: https://github.com/yoke626/Fishcode/releases/tag/v0.1.0
