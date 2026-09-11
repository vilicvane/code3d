---
name: worktree-development
description: 'code3d 的隔离开发、串行集成与 subagent 交付流程。USE FOR: 在 code3d 中进行任何会保留的开发工作，提交、合并、推送或发布，创建或恢复临时 Git worktree，启动独立开发服务器，协调多个 agent 时。DO NOT USE FOR: 只读检查或解释。'
---

# Worktree development

开发在当前上下文的活跃 linked worktree 中持续进行；新增需求复用该工作区，可关联多个 issue 并分批提交。提交、合并、推送、发布及其验证和 issue 收尾交给继承完整会话的 subagent 执行，让交付细节留在子会话。主 agent 保留任务身份，负责 FIFO、主区锁和协调状态，依据简短结果向用户反馈，不例行重复核验交付证据。主 worktree 不设常驻 owner 或专门整合 session，也不得用于实现功能或修复测试。

## 交付委派

主 agent 使用 `spawn_agent`，显式指定 `fork_turns: "all"`，不覆盖模型或 reasoning effort；同一批有依赖的交付操作由一个 subagent 顺序完成。执行 subagent 直接完成分配的操作，不再递归委派交付。已有用户授权继续有效，委派本身不扩大提交、合并、推送或发布范围。

开始这类操作或单独补查 issue 时读取 [交付委派与回报](references/delivery-subagent.md)，明确执行范围、主子 agent 的阶段交接、异常处理及最终回报。主 agent 仍是协调脚本的唯一任务 owner；subagent 不另行注册整合身份，也不借用 owner 的环境变量操作协调状态。Git、测试日志、远端状态及 issue 正文的交付核验由 subagent 完成，主 agent 只接收阶段交接所需的信息、结果和需要决定的异常。

执行版本发布前读取[版本发布流程](../../docs/development.md#版本发布)，按该流程准备版本、
核验发布包范围并完成 CI 发包及结果确认；具体版本与 npm 操作规则以该文档为唯一出处。

GitHub Issues 跟踪需求和当前已确定的方案，下面的本地协调文件只负责 agent 活动、开发服务器和串行集成。开始需求、方案确定或调整、更新 issue 或交付时，读取 [GitHub Issues 协作约定](references/github-issues.md)，同步维护 issue 正文中的方案摘要。不设需求模板；简短需求可以只有一句话。

开发环境与当前架构从[内部开发文档](../../docs/README.md)按任务进入；修改 Code3D 源码的 agent 使用本目录的技能和内部文档，使用 Code3D 建模的 agent 阅读对外操作指南。维护相应专题和受影响的对外说明，不恢复全局工作计划或本地需求文件来跟踪进度。

协调脚本统一使用主 worktree 的已集成版本，不使用任务分支中的旧副本，避免旧工作流覆盖新状态。主区路径记为 `PRIMARY`，任务 worktree 记为 `WORKTREE`：

```bash
COORDINATOR="$PRIMARY/.agents/skills/worktree-development/scripts/coordination.py"
python3 "$COORDINATOR" --repo <worktree> <command>
```

命令会从任意 linked worktree 定位主 worktree，并原子更新主 worktree 内被 gitignore 的 `.agents/worktree-state.json`。直接运行 `coordination.py --help` 或子命令的 `--help` 查看参数。

修改协调脚本后运行 `python3 -B -m unittest discover -s .agents/skills/worktree-development/tests`；测试使用临时 Git 仓库，不读写真实队列或 GitHub。

## 开始开发

1. 检查 `git status --short --branch`、`git worktree list --porcelain`、协调状态及当前上下文已有的工作区归属。只要已有未完成开发、待验收或待合并的 worktree，它就仍是活跃工作区；已提交、切换话题、新增 issue 或 shell cwd 回到主区都不会结束归属。不得移动、覆盖或带入其他人的未提交改动。
2. 读取已有 issue；没有时先搜索去重，再为用户已提出的开发需求创建 issue。有活跃工作区时沿用其 worktree、分支与任务 owner，保留原 issue 并追加关联，不按需求另建工作区或注册新 owner。认证暂不可用时，恢复访问后补齐关联；不创建本地需求收件箱。
3. 没有活跃工作区或原工作已完成时，才用 `issue-<编号>-<任务短名>-<agent>` 创建唯一分支与 sibling worktree：`git worktree add -b <branch> <sibling-path> <base-ref>`。基线默认取主分支当前已提交的 `HEAD`，不复制主区未提交内容。例外是独立并行开发的 fork、明确跨会话交接或用户要求隔离等有具体理由的情况；说明隔离理由、原工作区归属和未完成事项，不能仅因普通交付 subagent 是 fork 就新建。所有读取、编辑、格式化、测试和提交明确以选定 worktree 为工作目录，不在主区暂存功能文件。
4. 在开发 worktree 中注册：

   ```bash
   python3 "$COORDINATOR" --repo "$WORKTREE" register \
     --task '<简明需求>' \
     --issue 'https://github.com/vilicvane/code3d/issues/<编号>'
   ```

   默认 agent ID 是 `$HERDR_PANE_ID`；不在 Herdr 中时必须显式传 `--agent`。复用活跃 worktree 时沿用原 `--agent`；只有上述隔离例外确实产生独立工作区时才使用新的唯一 ID，此后的命令沿用各自 ID。注册始终归属开发 worktree，不注册主区、不切换 role。记录包括 issue URL、分支、提交、Herdr IDs，以及可用的 `CODEX_THREAD_ID`；有会话记录时，其他会话不能借用 agent ID 操作任务。多个关联 issue 可重复 `--issue`。同一活跃 agent 重新注册时省略该参数保留关联，显式传入则替换，因此追加需求时重复传入全部应保留的 issue，不能只传新增项；已完成 agent 用于新任务时不继承旧 issue。

5. 在每轮实质工作开始和结束时，用 `--repo "$WORKTREE"` 运行 `heartbeat`，并用 `--note` 写当前动作。整合时也保留这个路径，心跳会同时更新主区锁。长任务至少每五分钟更新一次。不要用常驻心跳进程。

主 worktree 有未提交内容时只能等待其现有 owner 或用户处理，不能为了创建开发 worktree 清理、stash 或提交这些内容。

## 功能受众与文档同步

开发开始及方案调整时，主 agent 按实际对外能力和行为区分更新类型，确定需要同步的文档与网站入口；不能仅凭改动位于哪个包，或将其称为重构、修复，就判断为内部更新。

- **面向用户或 agent 的功能更新**：影响模型作者、App 用户或通过公开 API/CLI 使用 Code3D 的 agent，包括新增、修改或移除公开能力、操作方式、参数、输入输出、可观察行为及使用限制。必须在同一需求的开发 worktree 中同步合适的对外文档和网站，使读者能找到准确的能力说明、使用方式、示例及限制；不能只更新 issue 或内部设计文档。
- **其他内部更新**：不改变对外功能或使用约定的内部实现、测试、构建维护和仓库开发协作流程等，按实际影响更新 [内部开发文档](../../docs/README.md)、设计专题或相关技能，无需机械修改对外介绍。内部改动一旦影响公开能力、使用方式或已公开的限制，受影响部分仍按对外功能更新处理。

对外内容按受众和用途选择：用户操作与建模能力落到[官网指南和参考文档](../../../packages/web/src/content/docs/docs/)，agent 的调用方式与输入输出同步[公开 agent 指南](../../../docs/agents.md)、相关 API 参考及包说明（如 [CLI README](../../../packages/cli/README.md)）。官网首页、功能介绍、能力限制和示例入口中受影响的描述也要同步；不要求每次修改所有 README 或重写首页。对外文档保持面向产品使用者，开发测试和内部协作细节放在开发文档或技能中。

文档与网站同步是功能完成的一部分，在交付前完成。涉及官网内容、示例或图片时，读取[官网维护说明](../../../packages/web/README.md)，复用实际示例源码，按其要求更新生成图片，并验证受影响的示例、页面、链接和资源。网站源码已更新与线上已发布分别报告，部署沿用本任务的发布授权。

## 独立开发服务器

App 默认开发端口为 `3133`（`0xc3d`），专供主 worktree 使用。主区运行
`npm run dev` 即使用该端口；端口占用时直接失败，不自动递增。开发 worktree
必须通过下述协调步骤预留其他端口并显式传入 `--port`。App 会拒绝 linked
worktree 使用 `3133`；协调脚本即使收到包含 `3133` 的自定义范围也会跳过它，
并拒绝把它登记为任务服务器端口。

每个开发 worktree 使用独立依赖目录、Vite cache 和端口。缺少依赖时在该 worktree 内运行 `timeout 300s npm install`，再运行 `timeout 300s npm run build:packages`；不要链接另一 worktree 的 `node_modules`。

先原子预留端口：

```bash
PORT="$(python3 "$COORDINATOR" --repo "$WORKTREE" reserve-port)"
```

在 Herdr 中先确认 `HERDR_ENV=1`，再用 `herdr pane current --current` 取得当前 workspace、tab 和 pane IDs。当前 tab 的全部 pane 归当前 session 管理，包括此前创建的 pane；这个范围不扩展到其他 tab。

启动任何前台任务前，用 `herdr pane list --workspace <workspace-id>` 查看并筛选当前 tab 的已有 pane，按需用 `herdr pane process-info --pane <pane-id>` 确认进程。优先复用已有前台 pane；不再使用的进程可以直接结束或替换，不因它不是本轮创建的就保留。正在承载本会话的 agent pane、仍在使用的任务和供验收的开发服务器继续保留。

只有没有可复用的 pane 时，才在当前 pane 下方新建一个约占 15% 高度、cwd 指向开发 worktree 的 pane，并保留用户焦点：

```bash
herdr pane split --current --direction down --ratio 0.85 --cwd "$WORKTREE" --no-focus
```

`--ratio 0.85` 为原 pane 保留约 85% 高度，新的下方 pane 使用余下空间。从查询或创建结果读取实际 pane ID，不能猜测。无论复用还是新建，都显式切到开发 worktree，并强制使用预留端口：

```bash
herdr pane run <pane-id> "cd \"$WORKTREE\" && npm run dev --workspace @code3d/app -- --host 127.0.0.1 --port $PORT --strictPort"
herdr pane wait-output <pane-id> --match "Local:" --timeout 120000
```

确认 Vite 已监听后运行 `server-started --port "$PORT" --pane-id <pane-id> --command '<command>'`。停止或替换已登记的服务器时，确认旧进程结束后运行 `server-stopped`，再登记新的服务；启动失败或服务器自行停止后同样更新状态。

前台任务结束且不再需要该 pane 时，确认进程已退出，再用 `herdr pane close <pane-id>` 关闭它；不要留下已停止任务的空 pane。立即在同一 pane 运行替代任务时直接复用，不必先关闭再新建。开发服务器仍遵循下面的验收保留规则。

实现完成、测试通过、提交、排队和等待用户验收都不是主动停止开发服务器或关闭其 pane 的理由。除非用户明确要求停止，否则必须保留开发服务器及其 pane，直到改动已按要求成功合并进主 worktree；合并前不得发送中断、关闭 pane 或调用 `server-stopped`。如果不在 Herdr 中，不伪造 Herdr ID；可启动受控后台进程并记录 PID，同样遵循这项生命周期约束。

查看关联会话使用：

```bash
herdr pane current --current
herdr agent list
herdr workspace get "$HERDR_WORKSPACE_ID"
python3 "$COORDINATOR" --repo "$WORKTREE" status
```

Herdr 的 workspace/tab/pane ID 是相关终端会话的稳定句柄；协调文件中的 `herdr` 字段把它们与任务、分支和服务器关联起来。

## 提交并排队

开发分支默认只在本地提交；已获推送授权时，推送整合后的主分支。只有长线且暂不合并的开发内容，或用户明确要求时，才推送开发分支。

开发完成后，在开发 worktree 中运行与风险相称的测试，确认 diff 只含本次已授权范围，并保留同工作区尚未交付的需求；按上述受众分类完成文档与网站同步。已有提交授权时，由交付 subagent 检查 staged 与 unstaged diff，复核相关文档和网站是否与最终行为一致；发现遗漏先在任务 worktree 补齐并验证，再提交任务改动，向主 agent 回报 SHA、验证结论、clean 状态及文档同步情况。已明确无需更新对外内容时说明理由。同时已有合并授权时，主 agent 据此入队，由协调脚本固定并校验提交，不再复读 diff 和测试证据。仅获提交授权时完成提交即可，仍待验收或合并授权的需求不要预占 FIFO 队首。

```bash
python3 "$COORDINATOR" --repo "$WORKTREE" enqueue --summary '<改动与验证摘要>'
```

未提交、detached HEAD 或主 worktree 中的内容不能入队。入队记录固定 `HEAD` 和当时的 issue URL；分支之后若有新提交或需更换队列中的 issue 关联，必须用 `retry` 取代旧队列项并重新排到队尾。等待期间保持开发 worktree、已启动的开发服务器及其 pane；没有取得主区锁前不得合并。

## 主 agent 协调串行整合

主 agent 使用原来的 agent ID，从自己的开发 worktree 领取：

```bash
python3 "$COORDINATOR" --repo "$WORKTREE" claim
```

`claim` 只允许领取属于该任务的 FIFO 队首项，同时要求开发 worktree clean、分支与排队提交一致、主区 clean 且没有未完成的 Git 操作。其他任务占用队首或主区锁时，只能等待并只读查看 `status`，不得替他领取、抢占或向其他任务会话转发合并请求。队首长期未推进时向当前用户报告，不唤醒其他会话，也不自行跳队。

主区锁只存在于本次整合期间，记录任务、队列项、主区路径、领取前的 `base_commit` 和活动时间。任务登记始终保留开发 worktree、分支、会话和服务器，不搬到主区。

领取后：

1. 主 agent 管理 `phase`、`complete` 和 `block`，使用 `--repo "$PRIMARY"` 和原任务的 `--agent`（如果注册时显式指定过）。Git、安装依赖及最终测试由交付 subagent 以主 worktree 为 cwd 执行；双方按阶段交接，不同时修改同一 worktree。
2. `claim` 已验证分支、排队提交及工作区状态；主 agent 运行 `phase --phase merging`，把领取的队列项、`base_commit` 和主区路径交给 subagent。subagent 确认实际状态相符后，用 `git merge --no-ff --no-commit <commit>` 准备合并。只合并记录的 commit，不默默带入后续提交。冲突处理属于整合工作，但需要重新设计或修复功能时应回到开发 worktree。
3. subagent 准备好合并结果后通知主 agent；主 agent 运行 `phase --phase testing` 并确认，subagent 才执行最终测试。通过后由 subagent 完成 merge commit、核对最终 Git 状态，并简报 SHA、验证结论与 clean 状态。主 agent 据此运行 `complete`；脚本验证主区 clean 及 merge commit 的两个父提交正是领取时的主区提交和排队提交，标记任务 `integrated` 并释放锁。主 agent 不再手动重复这些检查；命令拒绝时把具体原因交给 subagent 查明。`complete` 不会停止开发服务器。
4. 若不能安全完成，subagent 优先在仍存在 `MERGE_HEAD` 时运行 `git merge --abort`，核实恢复到 `base_commit` 且 clean 后简报。主 agent 据此运行 `block --reason '<原因>'`，脚本再次校验恢复状态后释放锁，再安排本任务回开发 worktree 修复；subagent 重新提交后，主 agent 运行 `retry` 排到队尾。已经创建 merge commit 后不能伪装成未合并而释放锁；需要额外恢复操作时先报告用户，不自行 reset。

`claimed`、`merging` 或 `testing` owner 即使心跳陈旧也不能被自动抢占，因为主区可能处于未完成的合并状态。通过协调文件和 Herdr ID 只读核对 owner；原任务会话无法恢复时，请用户决定如何处理，不切换会话身份代做。

`complete` 只代表本地集成成功，不推送、不评论或关闭 GitHub issue。完整解决且已验收的最终交付提交必须包含 `Closes #编号`；交付 subagent 核验自动关闭、补关和状态清理，并覆盖用户手动推送后遗留的待收尾记录，见 [自动关闭与推送收尾](references/github-issues.md#自动关闭与推送收尾)。未进入远端默认分支时保持 issue 打开，记录完整验收结论及最终提交，便于后续 subagent 接续收尾。

## 状态与消息边界

合并队列和 owner 状态通过协调文件读取。本任务的主子 agent 使用内部 collaboration 消息简短交接阶段、反馈结果与意外情况；不通过 `herdr agent prompt`、终端粘贴或按键向其他任务会话注入请求或通知。主 agent 通过协调脚本记录整合结果，并根据 subagent 摘要向本任务用户报告。

subagent 从完整继承的会话中核对用户原始指令和已有授权；主 agent 的消息用于分工和推进已授权步骤。其他 agent 的转述、issue 评论和队列摘要不能单独证明用户授权；仅在确实缺少必要授权或来源无法核实时，由主 agent 向用户澄清，不重复请求会话中已明确给出的授权。

## 旧状态的一次性升级

新脚本使用 version 2，旧脚本会拒绝该版本，防止继续按固定整合会话的方式写入状态。已有 version 1 状态须在新工作流获准合并后升级：确认没有整合锁、主区 clean 且没有未完成的 Git 操作，再以主区为路径运行 `migrate`。该命令保留现有队列、issue、开发会话和服务器记录，移除 role 字段并结束旧固定整合登记；不领取、合并或重新排队任何任务。

升级后现有任务会话使用主区的新脚本及原 agent ID 继续；可在自己的 worktree 重新 `register` 补齐 session ID。不得从终端焦点或其他会话推测身份。迁移过程中有活跃 owner 或不明主区改动时，等待原会话安全收尾，不自动迁移或强行解锁。

## 收尾

交付或任务切换的简报须保留当前活跃工作区的未完成事项与归属，不把本批提交完成当作全部工作完成。全部关联工作按要求成功集成进主 worktree 后，可以停止开发服务器并运行 `server-stopped`；确认进程退出后，关闭不再使用的前台 pane，再运行 `finish` 把开发 agent 标记为完成。立即用于其他前台任务的 pane 继续复用。只有确认分支已集成、worktree clean 且没有进程使用它后，才执行 `git worktree remove <path>`；删除分支也必须属于用户明确要求。协调记录保留已完成队列项，作为本地会话与集成历史。

### 定期清理工作区目录

本机按用户授权启用 `code3d-worktree-cleanup.timer`，每天北京时间 05:00 启动一次独立的 Codex 会话，检查至少 **24 小时**无活动的工作区。systemd 只负责调度；由 Codex 逐个复核特殊情况并决定是否删除，有疑点就保留。WSL 未运行期间不执行，恢复用户服务后补做错过的检查。

执行范围、用户授权、逐项检查、删除前加锁复核与报告要求统一放在[定时清理任务提示](references/scheduled-cleanup.md)。保留主 worktree、分支、提交、stash、协调历史和会话；不停止进程或关闭 pane，不把该维护任务变成产品开发或 Git 交付。按用户约定，活跃 worktree 都由 Herdr 中的 Codex 使用；结合其会话与协调记录判断当前归属，idle 会话仍算存活。未完成任务、未合并提交、本地配置或仍被会话使用的目录继续保留。

[候选扫描器](scripts/inspect_worktrees.py)只读，默认闲置阈值为一天，没有删除选项。它提供候选和跳过原因，不能代替 Codex 的逐项判断；旧脚本的直接删除路径已移除。独立扫描命令：

```bash
python3 "$PRIMARY/.agents/skills/worktree-development/scripts/inspect_worktrees.py" \
  --repo "$PRIMARY" --days 1
```

[会话启动器](scripts/run_scheduled_cleanup.py)调用本机 `codex exec`，沿用用户的模型配置，清除继承的 Herdr/父线程身份，并保存每次会话报告和事件日志。启动器每 5 秒提供只读 Herdr pane 快照，供隔离会话关联 owner；不扫描任意宿主进程。默认启动只读验收；正式定时任务显式传入 `--execute`，仍由 Codex 决定具体操作。不能交互审批或检查失败时保留目录并记录，不能绕过权限强行清理。

已验证的启动器、扫描器和任务提示安装在 `~/.local/lib/code3d-worktree-cleanup/`，不依赖开发 worktree。每次运行的 Markdown 报告及 JSONL 事件保存到 `~/.local/state/code3d-worktree-cleanup/`；同时保留正常 Codex 会话历史。源码或任务提示更新后须重新安装副本，并复验只读 Codex 会话和定时器。

```bash
systemctl --user list-timers code3d-worktree-cleanup.timer
journalctl --user -u code3d-worktree-cleanup.service
systemctl --user disable --now code3d-worktree-cleanup.timer
```

修改后运行 `python3 -B -m unittest discover -s .agents/skills/worktree-development/tests`；测试使用临时仓库和模拟 Codex，覆盖候选保护、24 小时阈值、只读模式、独立会话身份和防止重复启动。实际 Codex 验收须只读，不因测试定时器而批量删除真实目录。
