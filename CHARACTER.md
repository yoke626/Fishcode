# 桌宠角色与素材投递指南

FISHCODE 的萌宠素材是「投递即用」的：把自绘帧 PNG 放进 `assets/pet-source/`，跑
`npm run pet:prepare` 生成帧与清单；图标同理（`assets/icon-source.png` + `npm run icons`）。
没有投递素材时，管线自动生成内置的鲸鱼占位形象（FISHCODE 蓝白配色），仓库永远可构建、可打包。

## 角色边界（重要）

- 素材必须 **100% 原创**：不得描摹、修改、重绘任何第三方图集——Codex V2 桌宠的
  spritesheet 只可作**规格参考**（画布、帧数、脚底基线），不能作为绘制底稿。
- 使用带授权工具的**内置资源**制作（如 EmoteLab 的角色与部件库）**可以**，但这类授权
  通常要求署名：公开、商业或专业场景中必须清晰说明素材由该工具及其内置资源制作
  （本项目已在 README「法律与致谢」标注，见下「素材出处与署名」）。
- **未附带再分发许可**的第三方素材不得入库（例如仅有「个人使用」声明的图集——即使
  作者允许「二创」也不等于允许随 MIT 仓库再分发）。
- 不得复刻 DeepSeek 官方吉祥物等受保护形象的可识别元素。可以向其风格**致敬**
  （Q 版胖鲸鱼、可爱、蓝白系），但体型、花纹、表情、服饰等细节必须是自己的设计。
- 本项目以 MIT 协议发布，素材随仓库分发——以上是硬性要求；投递素材（含 PR）
  即表示你保证素材权利并同意随仓库按 MIT 分发。

## 目录布局

动画文件夹名**随意取**（跟 EmoteLab 导出名走即可），由 `config.json` 的 `roles` 把它们
映射到**规范状态**。每个文件夹是一个「变体」——一个文件夹里放多个 GIF 就是多个变体；
一个规范状态对应多个变体时，渲染层每次进入该状态**随机挑一个**（变体池）。

当前仓库的实际布局：

```
assets/pet-source/
├── config.json      # frameHeight / roles（映射见下）
├── ciallo/          # 启动动画        → roles.ciallo
├── default/         # 待机 ×2 变体     ┐
├── dance/           # 跳舞            ┘ → roles.idle（随机轮播）
├── finish/          # 任务完成庆祝    → roles.eat
├── busy/            # 忙碌            ┐
├── thinking/        # 思考            ├ → roles.working（随机轮播）
└── working/         # 执行 ×2 变体    ┘
```

规范状态：`idle`（待机）、`walk`（走路）、`eat`（庆祝）、`sleep`（睡觉）、`working`
（忙碌/工作）、`ciallo`（启动）。**只有 `idle` 必需**（所有状态都回退到它）；其余状态
没有素材就直接从清单里消失，主进程不再调度——素材可增可减，不用改代码。

`walk` 特殊：`walk-left/` + `walk-right/` 成对提供时不镜像（各朝其方向）；只有 `walk/`
时渲染层镜像共用。

另外：`assets/icon-source.png` —— 方形、透明底角色立绘，用于应用图标与托盘图标。

## 帧规范

- 透明 PNG；**同一状态内所有帧画布尺寸一致**、角色**脚底对齐画布底边**。脚本只做
  整画布等比缩放、**绝不裁剪**——帧间对齐完全依赖画布一致（不一致会打印警告）。
- 建议画布高度 ≥ 2× 逻辑高度（`frameHeight` 默认 128，即画 ≥256px）；脚本按
  `renderScale`（默认 2）输出高清帧，画得太小会提示并放大。
- 文件名零填充、数字自然排序：`idle-01.png` … `idle-08.png`（否则 `idle-10` 会排在
  `idle-2` 前面）。每状态帧数不限。
- 只收 `.png`，其余文件忽略。
- **GIF 帧条模式**：每个动画文件夹可以放**一个或多个 GIF**（竖排帧条，如 EmoteLab 导出），
  每个 GIF 切成一个变体；脚本用 omggif 按帧切片成 PNG，并**从 GIF 帧延迟自动推导该
  变体 fps**（config.json 的 `fps` 可覆盖）。GIF 与 PNG 混放时 PNG 优先、GIF 忽略。
  切片的画布就是 GIF 的画布——帧内角色脚底对齐、不越界即可，无需再拼 PNG。

## 素材出处与署名

使用 EmoteLab 及其内置资源制作的素材，其授权要求：公开、商业或专业场景中**清晰说明
素材由 EmoteLab 及其内置资源制作**。本项目据此在 README「法律与致谢」标注出处；更换
素材时请同步更新那处标注与本节的出处记录，保证素材权利始终可查。

当前素材来源：**EmoteLab（含内置资源）制作**，状态映射 `idle`←relaxing、
`eat`←success、`working`←working(normal)；备选动画 busy / thinking / ciallo /
working(tired) 留在 `assets/pet-source/` 根目录。

## config.json

不提供时使用以下默认值（roles 缺省 = 文件夹名即状态名）：

```json
{
  "frameHeight": 128,
  "renderScale": 2,
  "fps": { "idle": 2, "walk": 6, "eat": 4, "sleep": 1, "working": 4 },
  "roles": {
    "ciallo": ["ciallo"],
    "idle": ["idle"],
    "walk": ["walk"],
    "eat": ["eat"],
    "sleep": ["sleep"],
    "working": ["working"]
  }
}
```

- `roles`：文件夹 → 规范状态映射（值可以是单个名字或列表）；任何未映射的文件夹都会
  报错列出（防止画了却被打包漏掉），未知的状态名同样报错。
- `frameHeight`：逻辑显示高度（CSS px）；宽度按帧画布比例自适应（精灵不再固定为正方形）。
- `renderScale`：输出 PNG 尺寸 = `frameHeight × renderScale`（高清屏更清晰），不会超过源图倍数（绝不放大源图）。
- `fps`：按状态名覆盖帧率；未知键会打印警告。**GIF 来源的状态不用写**——自动取 GIF
  帧延迟，只有想改速才覆盖。

当前仓库的 `config.json`：

```json
{
  "frameHeight": 112,
  "roles": {
    "ciallo": ["ciallo"],
    "idle": ["default", "dance"],
    "eat": ["finish"],
    "working": ["busy", "thinking", "working"]
  }
}
```

（素材原生 112px，输出与显示均为 112px，不放大；walk/sleep 无素材 → 自动停用。）

## 状态说明（主进程何时触发）

| 状态 | 触发 | 建议 |
|---|---|---|
| `ciallo` | 启动时播放一次，然后进入待机 | 启动动作，1 个变体即可 |
| `idle` | 无操作（默认；有多个变体时随机挑一个） | 待机呼吸/眨眼/小动作，变体越多越不单调 |
| `walk` | 随机溜达（无素材则停用） | 4–8 帧步态循环，角色朝右 |
| `walk-left` / `walk-right` | 随机溜达（提供时替代 `walk` + 镜像） | 与 `walk` 同规格，各朝其方向 |
| `eat` | 任务完成，气泡庆祝（无素材则只冒泡） | 2–6 帧庆祝动作 |
| `sleep` | 随机小憩（无素材则停用） | 2 帧起；界面另有 "z" 提示 |
| `working` | 后端忙（完成监听器检测到文件活动；有多个变体时随机挑一个） | 4–8 帧「工作」循环；忙时粘滞，完成才切走 |

> 完成监听只能区分「忙/闲」，无法在文件层面区分「思考」与「执行操作」——所以
> `busy`/`thinking`/`working` 都归入 `working` 池随机播放；同样「待机」时的随机播放
> 由 `idle` 池（如 `default` + `dance`）实现。

## 生成与生效

```bash
npm run pet:prepare   # 帧 + assets/pet/frames.js
npm run icons         # 图标（有 icon-source.png 时用它，否则内置鲸鱼）
```

- **生成产物与源素材都要提交进仓库**（CI 不重新生成）。产物 = `assets/pet/` 下的帧
  PNG + `frames.js`（渲染层用）+ `manifest.json`（主进程读它决定调度哪些状态）。
- `npm run build`（copy-static）把 `assets/pet/` 拷进 `out/`；`pet-source/` 与
  `icon-source.png` 是构建输入，**不会**被打进应用。
- 缺 `idle` 素材或 config.json 出现未映射文件夹/未知状态名 → `pet:prepare` 直接报错；
  其余状态缺素材只是停用该状态，绝不混用占位帧与你的画。

## 附录：如果你还没有角色设计

可以参考这份原创 brief（气质参考、造型自创，可整份交给画师）：

> **蓝汐（Lánxī）**——守候在浅海与潮线之间的潮汐精灵，温柔、沉静、有点慢半拍，
> 不打扰人，只在任务完成时轻轻冒个泡。Q 版 2.5 头身；青碧色（`#14b8a6`）短发 +
> 齐刘海 + 右侧长侧麻花辫；深青色大圆眼；白色短袍配浪花边下摆，肩后披「海沫」薄纱；
> 搭档是一只拇指大的小鲸鱼。配色：`#14b8a6` / `#0d9488` / `#f0fdfa` / `#a5f3fc` /
> 点缀 `#fb7185`。
