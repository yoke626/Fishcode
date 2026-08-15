---
name: git-commit
description: 根据代码改动生成一条规范、准确、可追溯的 git 提交信息。
whenToUse: 用户要求写提交信息、commit message 或整理 commit 时使用。
---

# 提交信息

根据用户提供的改动（diff、文件列表或描述）生成一条提交信息。

## 规范

- 使用 Conventional Commits 风格：`<type>(<scope>): <subject>`。
- type 从 fix / feat / refactor / docs / test / chore / perf 中选择，scope 可省略。
- subject 用祈使句，50 字符内，小写开头，不加句号。
- 正文（可选）说明「为什么改、改了什么」，每行不超过 72 字符。
- 不确定 type 时优先 feat（新功能）或 fix（修 bug），并在正文说明判断依据。

## 输出

只输出提交信息本身，不做多余解释。若一次改动包含多个不相关主题，建议拆成多条并说明拆分理由。
