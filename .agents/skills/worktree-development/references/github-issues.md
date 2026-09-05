# GitHub Issues 协作约定

仓库：`vilicvane/code3d`。GitHub Issues 是需求状态的唯一来源；`DESIGN.md`、
`TOOLING.md`、`PLAN.md` 和 `plans/` 保留已确认设计、实施方案及历史，关联 issue
但不维护另一份活跃 backlog。`requests/` 是只读历史归档。

## 轻量记录

- 不使用需求模板、固定章节或必填表单。一句话能说明问题就足够；没有必要时正文可空。
- 为用户明确提出的独立需求搜索、复用或创建 issue。同一需求的修正和验收反馈写回
  原 issue，不按每轮对话拆单。不把只读咨询或未获认可的建议自动变成开发承诺。
- 按实际需要补充复现、截图、范围、设计链接或验收结论；不要要求用户把已说清楚的
  内容重写成表格。讨论中的方向仍标为讨论，不能因建了 issue 就视为已确认方案。
- `bug`、`enhancement`、`discussion` 区分类型。打开且没有状态标签表示待处理；
  `status:in-progress`、`status:review`、`status:blocked` 三者互斥。
  `status:review` 覆盖等待验收、集成或推送；关闭状态本身表示完成，不另加 done 标签。
- 暂不引入 GitHub Projects、PR 必经流程或自动同步机器人。

## 领取与交接

1. 开工前读取 issue 和评论，检查已有工作声明与本地协调状态，避免重复实现。
   开始工作时更新为 `status:in-progress`，简短记录 agent、分支及工作范围。
2. 本地登记 issue URL、worktree、Herdr 会话和独立服务器；心跳和合并锁仅写本地，
   不把每次心跳、工具输出或聊天逐条同步到 GitHub。Issue 标签和评论不能替代原子锁。
   获得合并授权后由本任务会话领取自己的 FIFO 队首项，临时在主区整合并释放锁；
   不向其他 session 发送合并请求，不把转述的“用户已批准”当作用户授权。
3. 交付验收时改为 `status:review`，记录改动、验证及验收入口。确实受阻时使用
   `status:blocked` 并写明需要的决定；恢复工作时移除旧状态标签。
4. 同一批改动可以关联多个 issue，只有完整解决的需求才使用关闭关键词。部分完成
   只引用 `#123` 并说明剩余范围，不提前关闭。

## GitHub 操作边界

- 使用已认证的 `gh`，明确传 `--repo vilicvane/code3d`；不回显 token。需要授权时
  让用户完成浏览器设备授权，不向用户索取或在仓库内保存凭据。
- 常用读取：`gh issue list --repo vilicvane/code3d --state all --search '<关键词>'`
  和 `gh issue view <编号> --repo vilicvane/code3d --comments`。
- 一句话创建：`gh issue create --repo vilicvane/code3d --title '<需求>' --body ''`。
  标签是 agent 的整理工作，不是提交需求的门槛。
- API 写入超时后先读取确认是否已生效，尤其是创建 issue；不要直接重试产生重复条目。
- 用户批准需求跟踪不等于批准提交、合并、推送、发布、修改仓库可见性或分支保护。
  各自遵循当前任务的授权；也不自动处理无关的外部 issue。
- 本地合并与 `coordination.py complete` 不会关闭 issue。验收、最终测试完成后，
  完整解决该需求的提交可包含 `closes #123`；只有提交进入远端默认分支后 GitHub
  才能据此关闭 issue。没有推送授权时保持打开并报告“已本地合并，待推送”。
- 若未使用关闭关键词，先确认最终提交确实已进入远端默认分支，再附提交和验证结果
  手动关闭；关闭前清理工作状态标签。因放弃而关闭要明确原因，不能标成已实现。

参考：[GitHub 关联与自动关闭规则](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)。
