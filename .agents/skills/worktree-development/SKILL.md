---
name: worktree-development
description: 'code3d 的隔离开发与串行集成流程。USE FOR: 在 code3d 中进行任何会保留的开发工作，或创建、恢复、合并临时 Git worktree，启动独立开发服务器，协调多个并行 agent 时。DO NOT USE FOR: 只读检查、解释或无需修改仓库的任务。'
---

# Worktree development

每个开发需求在自己的 linked worktree 中完成。主 worktree 只用于领取合并队列、合并已提交的分支和执行最终测试；不得在其中实现功能或修复测试。

GitHub Issues 跟踪需求，下面的本地协调文件只负责 agent 活动、开发服务器和串行集成。开始需求、更新 issue 或交付时，读取 [GitHub Issues 协作约定](references/github-issues.md)。不设需求模板；简短需求可以只有一句话。

本技能目录记为 `SKILL_DIR`，协调命令为：

```bash
python3 "$SKILL_DIR/scripts/coordination.py" [--repo <worktree>] <command>
```

命令会从任意 linked worktree 定位主 worktree，并原子更新主 worktree 内被 gitignore 的 `.agents/worktree-state.json`。直接运行 `coordination.py --help` 或子命令的 `--help` 查看参数。

修改协调脚本后运行 `python3 -B -m unittest discover -s .agents/skills/worktree-development/tests`；测试使用临时 Git 仓库，不读写真实队列或 GitHub。

## 开始开发

1. 检查 `git status --short --branch`、`git worktree list --porcelain` 和协调状态。不得移动、覆盖或带入其他人的未提交改动。
2. 读取已有 issue；没有时先搜索去重，再为用户已提出的开发需求创建 issue。用 `issue-<编号>-<任务短名>-<agent>` 创建唯一分支与 sibling worktree。Herdr pane ID 可作为 agent 标识；用时间或随机后缀避免分支、目录重名。基线默认取主分支当前已提交的 `HEAD`，不能隐式复制主 worktree 的未提交内容。认证暂不可用或迁移中的既有工作可先隔离开发，恢复访问后补上关联；不创建本地需求收件箱。
3. 如果当前已经是只属于本需求的 linked worktree，复用它；否则运行 `git worktree add -b <branch> <sibling-path> <base-ref>`。从此以后，所有读取、编辑、格式化、测试和提交都明确以该 worktree 为工作目录。不要在主 worktree 暂存功能文件。
4. 在开发 worktree 中注册：

   ```bash
   python3 "$SKILL_DIR/scripts/coordination.py" register \
     --task '<简明需求>' --role development \
     --issue 'https://github.com/vilicvane/code3d/issues/<编号>'
   ```

   默认 agent ID 是 `$HERDR_PANE_ID`；不在 Herdr 中时必须显式传 `--agent`。注册会记录 issue URL、worktree、分支、提交以及 Herdr workspace/tab/pane ID。多个关联 issue 可重复 `--issue`。同一活跃 agent 重新注册时省略该参数保留关联，显式传入则替换；已完成 agent 用于新任务时不继承旧 issue。

5. 在每轮实质工作开始和结束时运行 `heartbeat`，并用 `--note` 写当前动作。长任务至少每五分钟更新一次。不要用常驻心跳进程。

主 worktree 有未提交内容时只能等待其现有 owner 或用户处理，不能为了创建开发 worktree 清理、stash 或提交这些内容。

## 独立开发服务器

每个开发 worktree 使用独立依赖目录、Vite cache 和端口。缺少依赖时在该 worktree 内运行 `timeout 300s npm install`，再运行 `timeout 300s npm run build:packages`；不要链接另一 worktree 的 `node_modules`。

先原子预留端口：

```bash
PORT="$(python3 "$SKILL_DIR/scripts/coordination.py" reserve-port)"
```

在 Herdr 中先确认 `HERDR_ENV=1`，再用 `herdr pane current --current` 取得当前 IDs。为服务器在当前 pane 下方创建一个约占 15% 高度、cwd 指向开发 worktree 的 pane，保留用户焦点，并强制使用预留端口：

```bash
herdr pane split --current --direction down --ratio 0.85 --cwd "$WORKTREE" --no-focus
herdr pane run <pane-id> "npm run dev --workspace @code3d/app -- --host 127.0.0.1 --port $PORT --strictPort"
herdr pane wait-output <pane-id> --match "Local:" --timeout 120000
```

`--ratio 0.85` 为原 pane 保留约 85% 高度，新的下方 pane 使用余下空间。从 JSON 响应读取 pane ID，不能猜测。确认 Vite 已监听后运行 `server-started --port "$PORT" --pane-id <pane-id> --command '<command>'`。启动失败或服务器自行停止后运行 `server-stopped`。

实现完成、测试通过、提交、排队和等待用户验收都不是主动停止开发服务器或关闭其 pane 的理由。除非用户明确要求停止，否则必须保留开发服务器及其 pane，直到改动已按要求成功合并进主 worktree；合并前不得发送中断、关闭 pane 或调用 `server-stopped`。如果不在 Herdr 中，不伪造 Herdr ID；可启动受控后台进程并记录 PID，同样遵循这项生命周期约束。

查看关联会话使用：

```bash
herdr pane current --current
herdr agent list
herdr workspace get "$HERDR_WORKSPACE_ID"
python3 "$SKILL_DIR/scripts/coordination.py" status
```

Herdr 的 workspace/tab/pane ID 是相关终端会话的稳定句柄；协调文件中的 `herdr` 字段把它们与任务、分支和服务器关联起来。

## 提交并排队

开发完成后，在开发 worktree 中运行与风险相称的测试，确认 diff 只含本需求，提交任务改动，再把不可变的当前提交入队：

```bash
python3 "$SKILL_DIR/scripts/coordination.py" enqueue --summary '<改动与验证摘要>'
```

未提交、detached HEAD 或主 worktree 中的内容不能入队。入队记录固定 `HEAD` 和当时的 issue URL；分支之后若有新提交或需更换队列中的 issue 关联，必须用 `retry` 取代旧队列项并重新排到队尾。等待期间保持开发 worktree、已启动的开发服务器及其 pane，不要自行合并主分支。

## 串行集成

集成 agent 必须位于主 worktree。注册 `--role integration` 后运行 `claim`；只有 FIFO 队首且当前没有 owner 时才能领取。`claim` 还会拒绝 dirty 的主 worktree。

领取后：

1. 核对队列记录的分支仍指向记录的 commit；只合并记录的 commit，不默默带入后续提交。
2. 运行 `phase --phase merging`，再用 `git merge --no-ff --no-commit <commit>` 准备合并。冲突处理属于集成工作，但需要重新设计或修复功能时应回到开发 worktree。
3. 运行 `phase --phase testing`，在主 worktree 执行最终测试。通过后完成 merge commit，确认主 worktree clean，再运行 `complete`。
4. 若不能安全完成，优先在仍存在 `MERGE_HEAD` 时运行 `git merge --abort`。主 worktree恢复 clean 后运行 `block --reason '<原因>'`，把需求退回开发方且释放队列；开发方修复并提交后运行 `retry`，它会排到队尾。

`claimed`、`merging` 或 `testing` owner 即使心跳陈旧也不能被自动抢占，因为主 worktree 可能处于未完成的合并状态。先通过协调文件和 Herdr ID 联系 owner；没有 owner 可恢复时，请用户决定如何处理。

`complete` 只代表本地集成成功，不推送、不评论或关闭 GitHub issue。验收完成且提交实际进入远端默认分支后才关闭需求；未获推送授权时报告本地合并结果并保持 issue 打开，见协作约定。

## 收尾

改动按要求成功集成进主 worktree 后，可以停止开发服务器并运行 `server-stopped`，再运行 `finish` 把开发 agent 标记为完成。只有确认分支已集成、worktree clean 且没有进程使用它后，才执行 `git worktree remove <path>`；删除分支也必须属于用户明确要求。协调记录保留已完成队列项，作为本地会话与集成历史。
