# 项目协作规则

## Git 仓库、远端与分支

1. 本项目在当前项目根目录下只使用一个本地 Git 仓库。该本地仓库同时连接以下三个远端托管仓库：
   - Gitee 仓库：remote 名称为 `origin`，远端地址为 `https://gitee.com/lan0811/toonflow-2.0.git`。
   - GitHub 仓库：remote 名称为 `github`，远端地址为 `https://github.com/lanlan0811/toonflaw-2.0.git`。
   - GitCode 仓库：remote 名称为 `gitcode`，远端地址为 `https://gitcode.com/lan0811/toonflow-2.0.git`。
2. 禁止在项目内部或外部为本项目创建第二个本地 Git 仓库；禁止使用 `git init`、Git submodule、Git subtree、Git worktree，或通过复制目录建立并行仓库。
3. 四个名称必须明确区分，不得笼统地称为“多个 master”：
   - `master`：本地 Git 仓库的开发分支，代码修改和提交都发生在此分支。
   - `origin/master`：Gitee 仓库中 `master` 分支的本地远端跟踪引用。
   - `github/master`：GitHub 仓库中 `master` 分支的本地远端跟踪引用。
   - `gitcode/master`：GitCode 仓库中 `master` 分支的本地远端跟踪引用。
4. `master`、`origin/master`、`github/master` 和 `gitcode/master` 是四个不同的 Git 引用，可能暂时指向不同提交。描述状态、比较差异或执行操作时，必须使用完整名称，明确指的是本地、Gitee、GitHub 还是 GitCode。
5. 本地、Gitee、GitHub 和 GitCode 都只允许使用 `master` 分支进行开发、提交和推送。禁止创建、切换、合并或推送其他本地及远端分支；禁止通过临时分支、功能分支或发布分支开展工作。
6. 执行任何 Git 修改前必须运行 `git branch --show-current` 和 `git status --short`，确认当前本地分支为 `master` 并了解现有改动；若当前分支不是 `master`，应停止操作并向用户说明，不得自行创建或切换分支。
7. 提交只能提交到本地 `master`。推送时必须明确目标远端：
   - 推送到 Gitee 的 `master`：使用 `git push origin master`。
   - 推送到 GitHub 的 `master`：使用 `git push github master`。
   - 推送到 GitCode 的 `master`：使用 `git push gitcode master`。
   - 若用户要求同时推送到多个远端，应分别执行对应的推送命令，并分别确认推送结果。
8. 除非用户明确要求，否则不得新增、修改或删除 Git remote；默认保留并使用现有的 `origin`（Gitee）、`github`（GitHub）和 `gitcode`（GitCode）。
9. 不得擅自改写本地 `master`、Gitee `origin/master`、GitHub `github/master` 或 GitCode `gitcode/master` 的历史，包括禁止 `git push --force`、将 `git reset --hard` 用于回退已发布提交，以及执行破坏性 rebase；除非开发者本人明确要求改写相应分支的历史。

## 工作要求

- 修改代码前先执行 `git branch --show-current` 和 `git status --short`，确认位于本地 `master` 且了解现有改动。
- 保留用户已有的未提交修改，不得擅自丢弃、覆盖或回滚。
- 完成修改后按项目要求运行检查；用户要求提交或推送时，必须说明操作对象是本地 `master`、Gitee `origin/master`、GitHub `github/master` 还是 GitCode `gitcode/master`。

## 计划文档

- “套餐”计划必须完整、原封不动地写入 `.codex/pians` 目录，不得精简、改写、遗漏或仅保存摘要。
