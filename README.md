# FISHCODE

把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 `dsh web` 后端装进一个原生桌面壳，像日常桌面应用一样使用。

> **非 DeepSeek 官方出品。** FISHCODE 是一个独立的开源社区项目，与 DeepSeek（深度求索）及其官方产品没有从属关系。DeepSeek 及相关名称是其各自权利人的商标。

## 这是什么

FISHCODE 是一个 Electron 桌面壳：它在本地启动 DeepSeek Harness 的 web 后端（`dsh web`），把官方界面放进一个独立的桌面窗口，并补上托盘、全局快捷键、桌面萌宠、完成通知等桌面化能力。

它不修改、不重新实现 DeepSeek Harness 的功能，也不内置任何模型或密钥——只负责「把命令行工具变成一个好用的桌面应用」。

## 功能

- **托盘常驻**：关闭窗口最小化到托盘，随时唤回。
- **快速启动**：窗口秒开并显示加载动画与后端进度，托盘、萌宠、快捷键无需等待后端；后端约 10 秒就绪后自动进入主界面，失败可一键重试。
- **全局快捷键**：`Ctrl+Shift+D` 全局切换主窗口显示。
- **桌面萌宠**：一只常驻桌面的鲸鱼（致敬 DeepSeek 的标志形象），支持拖拽、点击穿透、单击唤出窗口；后端忙碌时切换「工作」动画，任务完成冒泡庆祝；右键或托盘菜单的「萌宠动作」可随时点播一个动画。素材可投递替换（见下文「素材替换点」）。
- **新手向导**：首次启动三步完成配置（API Key、开机自启、最小化到托盘、是否开启萌宠）。
- **视觉服务一键配置**：托盘菜单里打开「视觉服务设置」，选一个提供商预设、粘贴 API Key，图片识别能力即配置完成（详见下文）。
- **完成通知**：监听任务目录的忙→闲变化，任务完成后弹系统通知并让萌宠冒泡。
- **右键打开**（Windows 安装版）：给文件右键菜单加上「用 FISHCODE 打开」。
- **单实例锁**：重复启动自动聚焦已有窗口，`--open <路径>` 会把路径转发给运行中的实例。

## 工作原理

```
┌──────────────── Electron 壳 ────────────────┐
│  主窗口（加载 dsh web 的本地地址）           │
│  托盘 / 快捷键 / 萌宠 / 通知 / 向导          │
│                │                            │
│          BackendManager                     │
│                │ spawn                      │
│  node-runtime/node  ──>  dsh web --host 127.0.0.1 --port <port>
└─────────────────────────────────────────────┘
```

- 后端来自 npm 包 `@deepseek-ai/dsh`，本地起一个仅监听 `127.0.0.1` 的 web 服务。
- 主窗口 `ready-to-show` 后再显示，加载后端的本地地址。
- 应用本身**不接入任何遥测**，不收集、不上传使用数据。

## 隐私说明

- 你的 **API Key 只保存在本机**（Electron 的 userData 目录下的 `settings.json`；视觉服务的密钥存在 `~/.dsh/.credentials.yaml`），不会离开这台机器。
- 模型请求由本地 `dsh` 后端直接发往 DeepSeek 的 API，FISHCODE 不中转、不记录你的对话内容。
- 安装包与代码均为未签名 / 公开源码，构建过程见下，请自行核对。
- 如果你把会话目录指向了同步盘，请自行评估同步行为。

## 视觉服务（图片识别）

FISHCODE 内置了 `@anionex/dsh-vision-toolkit` 视觉工具插件，让对话模型可以借助视觉模型识别图片（截图、设计稿、照片等）。协议、服务地址、模型名、凭据名这些专家级配置全部由 FISHCODE 代劳，你只需要两步：

**一键配置**（托盘菜单 → 视觉服务设置）：

1. 选择服务商：内置「智谱 GLM-4V-Flash（免费）」预设；或选「自定义」，填写任意 OpenAI 兼容 / Anthropic Messages 服务的 baseUrl、模型名与协议。
2. 粘贴该服务商的 API Key（只填原始密钥，不用管「凭据名」是什么）。
3. 点「保存并测试」，FISHCODE 会写入配置、验证本地运行时，并实测与所选服务的连通性。

获取智谱密钥：注册[智谱开放平台](https://open.bigmodel.cn) → 用户中心 → API Keys 免费创建；设置窗口里的「获取智谱 API Key」可直接跳转。

**怎么用**：

1. 把图片直接**粘贴（Ctrl+V）或拖进聊天输入框**（两种方式都会自动把图片转成本地路径引用；超过当前视觉服务商配置上限的图片会在发送前自动压缩——智谱 GLM-4V-Flash 单图上限 5MB，超限会报「API 调用参数有误」；接入上限更高的服务商则原图直送）——不要点附件（回形针）按钮，纯文本模型会在技能运行前拒绝图片附件。
2. 输入你的问题。
3. 发送消息，然后在对话中发送 `/vision-tools`。

> 密钥保存在本机 `~/.dsh/.credentials.yaml`（引用名 `VISION_API_KEY`），由本地 dsh 后端直接调用；图片只发送给你选择的服务商，FISHCODE 不中转、不存储。

**给维护者**：提供商预设定义在 `src/shared/vision.ts`——新增预设前请先实测通过（例如智谱的 Anthropic 兼容端点会丢失图片内容，切勿预设）。内置插件有**三处** vendored 补丁，均由 `scripts/patch-vision-vendor.mjs` 在 `dsh-bundle` 的 `postinstall` 中自动应用：①快照的 `max_tokens` 钳到 1024（兼容输出上限低的免费视觉服务商）；②web 客户端补上 `drop` 捕获拦截，让**拖入**的图片与粘贴一样转成本地路径引用（否则会以行内附件发送、被纯文本模型拒绝）；③web 客户端上传前自动压缩超过**当前服务商配置上限**（`maxImageBytes`，发送时从插件设置接口现取）的图片（PNG 优先、JPEG 兜底——智谱 GLM-4V-Flash 单图 5MB 上限，超限报 400/[1210]，而插件自身的默认 10/20MB 上限会放行导致远端报错；上限更高的自定义服务商原图直送不受影响）。升级 `@anionex/dsh-vision-toolkit` 后执行 `npm run vision:patch` 重新打补丁。

## 开发

要求：Node.js 22.19+（推荐 24），npm 10+。

```bash
npm install                        # 安装壳的依赖
cd dsh-bundle && npm ci --omit=dev # 安装后端依赖（dsh + 原生模块）
npm run dev                        # 编译并启动（开发模式直接用系统 node）
```

常用脚本：

| 脚本 | 作用 |
|---|---|
| `npm run build` | 清理 + tsc 编译（main/preload 两段）+ 拷贝静态资源到 `out/` |
| `npm run typecheck` | 仅类型检查 |
| `npm run dev` / `start` | 开发运行 |
| `npm run icons` | 从 `assets/icon-source.png` 生成应用图标（无源图片时用内置鲸鱼） |
| `npm run pet:prepare` | 从 `assets/pet-source/` 生成萌宠贴图（无源素材时用内置鲸鱼占位） |
| `npm run runtime:fetch` | 下载独立 Node 运行时并校验 SHA-256（打包用） |
| `npm run vision:patch` | 重新应用视觉插件 vendored 补丁（升级插件后） |
| `node scripts/test-cred-writer.mjs` | 凭据写入器边界回归测试（需先 `npm run build`） |
| `npm run dist:win` / `dist:mac` / `dist:linux` | 出对应平台安装包 |

## 打包与发布

安装包用 [electron-builder](https://www.electron.build/) 生成，应用本体打进 `app.asar`；三样**必须出 asar** 的东西走 `extraResources` 放到 `resources/`：

- `node-runtime/` —— 独立 Node 运行时（`fetch-runtime.mjs` 下载并校验）
- `dsh/node_modules` —— `@deepseek-ai/dsh` 及其原生依赖
- `skills/` —— 内置技能

GitHub Actions 里：

- `ci.yml`：PR / push 到 `main` 时做类型检查 + 构建。
- `release.yml`：打 `v*` tag 后按矩阵构建 Windows NSIS / macOS dmg（x64 与 arm64 分别出）/ Linux AppImage + deb，并发布到 GitHub Release。

> 安装包**未签名**：Windows 下 SmartScreen 会提示「未知发布者」，macOS 首次打开需到「系统设置 → 隐私与安全性」放行。

## 内置技能

FISHCODE 通过 `DSH_BUNDLED_SKILL_DIR` 指向安装目录下的 `resources/skills`，把以下 5 个技能作为「内置技能」交给后端（`source: 'bundled'`）：

| 技能 | 说明 |
|---|---|
| `code-review` | 系统审查代码，找出缺陷、风格与安全问题 |
| `git-commit` | 生成规范、可追溯的提交信息 |
| `explain-code` | 讲解代码作用与关键设计 |
| `write-tests` | 编写针对性单元测试 |
| `refactor` | 不改变行为的前提下安全重构 |

技能使用 dsh 的真实契约：文件平铺在 `skills/` 下，frontmatter 必填 `name`（kebab-case，与文件名一致）与 `description`，可选 `whenToUse`。你自建的技能仍放在 `~/.dsh/skills`，与内置技能并存。

## 素材替换点

当前图标、托盘图标与萌宠形象是**占位素材**，替换成你自己的原创角色无需动代码，投递素材 + 两条命令即可（完整规范见 [CHARACTER.md](./CHARACTER.md)，**注意其中「角色边界」：素材必须 100% 原创**）：

- **桌面萌宠**：把各动画帧 PNG **或 GIF**（竖排帧条，自动按 GIF 帧延迟定帧率）放进 `assets/pet-source/<动画文件夹>/`（一个文件夹放多个 GIF = 该状态的多个随机变体；`config.json` 的 `roles` 把文件夹映射到待机/走路/庆祝/睡觉/工作/启动等规范状态），跑 `npm run pet:prepare` 生成 `assets/pet/*.png` + `frames.js`（渲染层清单）+ `manifest.json`（主进程按它调度有素材的状态）。**生成产物与源素材都要提交进仓库**（CI 不重新生成）；没有源素材时脚本自动生成内置鲸鱼占位。
- **应用/托盘图标**：`assets/icon-source.png` 放一张方形透明底角色立绘，跑 `npm run icons` 生成 `build/icon.ico`、`build/icon.png`、`assets/icon.png`、`assets/tray.png`；没有源图片时用内置鲸鱼。
- 成品文件：`build/icon.ico`、`build/icon.png`、`assets/icon.png`、`assets/tray.png`、`assets/pet/*.png`、`assets/pet/frames.js`、`assets/pet/manifest.json`。

## 法律与致谢

FISHCODE 是一份**原创重写**：架构上参考了 MIT 协议的开源项目 Bigfish 的经验，但代码、文案、素材均为原创，不是其分支或改名。仓库内提交的所有萌宠/图标素材必须为原创（见 [CHARACTER.md](./CHARACTER.md) 的「角色边界」），投递者需自行保证素材权利。**当前萌宠素材使用 EmoteLab 及其内置资源制作**（应其授权要求在公开场景署名，详见 [CHARACTER.md](./CHARACTER.md) 的「素材出处与署名」）。本项目以 MIT 协议发布，详见 [LICENSE](./LICENSE)。

再次强调：本项目与 DeepSeek 官方无关，DeepSeek 及相关商标归其权利人所有。
