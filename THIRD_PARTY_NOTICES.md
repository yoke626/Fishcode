# Third-Party Notices

FISHCODE 本体以 MIT 协议发布（见 [LICENSE](./LICENSE)）。本文件列出随仓库分发、但版权归其原作者所有的第三方代码与素材，并保留各许可证要求的版权与许可声明。

## dsh-router-standard / dsh-router-standard（router-standard + router-spec 预设）

仓库内置的 **Router Standard (experimental)** 与 **Router Spec (experimental)** 会话预设，源码位于 `vendor/agent-presets/router-standard/` 与 `vendor/agent-presets/router-spec/`（由 `scripts/vendor-agent-presets.mjs` 在 `dsh-bundle` 安装后拷贝进后端的内置预设目录）。

- 上游仓库：<https://github.com/yjh051108/dsh-router-standard>
- 许可证：MIT，Copyright (c) 2026 yjh051108

```
MIT License

Copyright (c) 2026 yjh051108

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

该预设自身的 NOTICE（上游声明其衍生来源，一并保留）：

```
This project builds on the DeepSeek Harness ecosystem and on prior open work:

- preset/agent.cordis.yml is modified from the DeepSeek Harness Standard
  agent preset (MIT). Original DeepSeek copyright and MIT license terms apply
  to that file's derived content.
- The first-turn anchoring mechanism (narrow tool surface, expand after the
  first durable tool call) is a plugin-level port of the bootstrap filter in
  xiaobright/dsh-anchored-standard (MIT).
- The trajectory lexicon classifier follows xiaobright/modeltest (MIT).
```

> 说明：FISHCODE 内置 `dsh-router-standard` 的 router-standard 与 router-spec 预设本体（自包含）。同时内置同仓库的 `dsh-super-injector` 运行时注入器（见下）；`dsh-mode-boost` 未内置。

## dsh-super-injector（运行时注入器）

仓库内置 **dsh-super-injector** 插件，以 vendored tarball 形式位于 `vendor/plugins/dsh-external-dsh-super-injector-0.3.3.tgz`。

- 上游仓库：<https://github.com/yjh051108/dsh-super-injector>
- 许可证：BSD-3-Clause，Copyright (c) 2026 yjh051108

```
BSD 3-Clause License

Copyright (c) 2026, yjh051108

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

## 其他随依赖安装的第三方组件

- `@deepseek-ai/dsh`（DeepSeek Harness 后端）及其原生依赖：由 `dsh-bundle/package.json` 声明，`npm ci` 安装，各自的许可证随 `node_modules` 内相应包分发。
- `@anionex/dsh-vision-toolkit`（视觉插件）：同上；FISHCODE 对其有三处 vendored 补丁（见 README「视觉服务」一节）。
- `@omdsh-dev/dsh-genui`（GenUI 交互界面插件）：以 vendored tarball 形式位于 `vendor/plugins/omdsh-dev-dsh-genui-0.8.7.tgz`，MIT 许可证，Copyright © 2026 omdsh-dev（见 tarball 内 LICENSE）。
- `dsh-better-sidebar`（右侧工作台插件）：npm 依赖，MIT 许可证。
- `@linxin666/dsh-pet`（dsh-web-ui 鲸鱼娘宠物）：npm 依赖，Apache-2.0 许可证。
- `@linxin666/dsh-client-ui-skin-center`（dsh-web-ui 皮肤中心）：npm 依赖，Apache-2.0 许可证。
- `dshmarket`（插件市场）：npm 依赖，MIT 许可证。
- 萌宠/图标素材：EmoteLab（署名要求见 [CHARACTER.md](./CHARACTER.md) 的「素材出处与署名」）。
