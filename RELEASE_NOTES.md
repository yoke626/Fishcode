# FISHCODE v0.1.5

本版跟随 DeepSeek Harness 升级到 dsh rc.7，并内置一批社区插件，让 FISHCODE 从「桌面壳」进一步变成开箱即用的开发工作台。

## dsh 后端升级

- 内置 `@deepseek-ai/dsh` 从 `0.1.0-rc.6` 升级到 `0.1.0-rc.7`。
- 现有会话删除、视觉插件补丁、Router Standard 预设均已适配并验证。

## 新增内置插件

- **GenUI**：模型回答里可直接渲染可交互 UI（图表、表单、面板、测验、3D 等）。
- **Better Sidebar**：VSCode 风格右侧工作台，包含文件资源管理器、编辑器、终端、Git 面板与内嵌浏览器。
- **鲸鱼娘宠物 + 皮肤中心**：默认改用 dsh-web-ui 鲸鱼娘宠物，并内置 12 款皮肤，可在设置中先试穿再应用。
- **插件市场（dshmarket）**：在 dsh 设置页内浏览、搜索、一键安装社区插件，方便发现更多插件。

## 桌宠调整

- 原生桌面萌宠**默认关闭**，由 dsh-web-ui 鲸鱼娘宠物取代。
- 原生桌宠代码保留，可在托盘菜单中重新开启。
- 旧版本升级后会自动完成一次设置迁移，避免同时出现两个宠物。

## 视觉服务

- 内置 `@anionex/dsh-vision-toolkit` 升级到 `0.1.34`。
- 带来透明变体路由、内置免费视觉、Windows Python 支持等新能力。
- 原有粘贴/拖拽转路径、超限图片自动压缩、`max_tokens` 钳制补丁全部保留。

## 下载

Windows 用户直接下载 `Fishcode Setup 0.1.5.exe` 覆盖安装即可（数据保留）。

> 平台说明：macOS 未签名（Gatekeeper 会拦截自动更新）保持手动安装；Linux 仅 AppImage 版支持自动更新。
