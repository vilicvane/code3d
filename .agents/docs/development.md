# 开发环境与验证

本页说明仓库开发入口。使用 Code3D 建模的步骤见根目录
[README](../../README.md)及其文档链接。

## 环境与运行

使用 Node.js 24 和 npm，在当前任务的独立 worktree 中安装、构建：

```bash
npm install
npm run build:packages
```

`npm install` 会通过 `patch-package --error-on-fail` 应用仓库中的
[依赖补丁](../../patches/)。不要用临时修改 `node_modules` 的方式交付补丁。
各 worktree 的依赖、构建目录与 Vite 缓存独立。

主 worktree 的 App 端口为 `3133`；开发 worktree 使用登记过的独立端口，冲突时
直接失败。启动命令、Herdr pane 和服务器保留规则见
[worktree 开发流程](../skills/worktree-development/SKILL.md#独立开发服务器)。
单独启动 App 时先构建包；根目录 `npm run dev` 已包含包构建。

网站构建依赖 App 产物。图片生成、站点 origin、部署路径和网站验证见
[Web README](../../packages/web/README.md)。内核源码与 WASM 的重建见
[OpenCascade README](../../packages/opencascade/README.md)；常规 TypeScript
构建不等于重新编译 WASM。命令的唯一实现入口为各包和根目录的 `package.json`。

## 测试与格式

产品界面统一使用英文，包括 Code3D 自己产生的诊断；内部开发文档可使用中文。

```bash
npm test
npm run test:types
npm test --workspace @code3d/core
npm run lint-prettier
```

`npm test` 构建包、检查测试类型并运行各 workspace 的单元测试；完整发布构建使用
`npm run build`。根据实际改动选择相关验证，已有检查通过后不重复运行无变化的产品。

新增运行时测试使用 `*.test.ts`、`node:test` 和 `node:assert/strict`。
Node.js 24 直接执行可擦除的 TypeScript；测试间导入使用显式 `.ts` 扩展。
`public-api.ts` 等纯类型 fixture 只检查类型，不作为运行时测试执行。
App 中依赖 Vite 变换的模块使用既有 Vite 测试入口。

所有本地测试与验证默认限制整组进程最多 3 GiB 内存、swap 为 0；用户可为当前任务
明确指定其他内存预算，swap 仍为 0。范围包含类型检查和
浏览器测试驱动。每次运行一组测试，文件并发从 1 开始；不通过并行启动多个受限
分组绕过总预算。V8 的 `--max-old-space-size` 只限制 JS 堆，不能代替进程组预算。
WSL/Linux 启用 systemd 时，可从任务 worktree 根目录运行：

```bash
systemd-run --user --wait --pipe --working-directory="$PWD" \
  -p MemoryMax=3G -p MemorySwapMax=0 -p OOMPolicy=kill \
  -p RuntimeMaxSec=120 -p TimeoutStopSec=2 \
  node --max-old-space-size=1536 --test --test-concurrency=1 \
  packages/app/test/project-dependencies.test.ts
```

上限针对整组进程，包括原生 esbuild 子进程；超时后先终止，再强制收齐剩余进程。
其他环境使用等价的进程组限制；仅设置 `timeout` 的 SIGTERM 不能保证及时退出。
超限时先缩小复现范围并测量分配来源，不能直接提高预算重跑。
已运行的 Windows 主机 Chrome 不在 WSL 测试驱动的进程组内，不能宣称受该限制
覆盖；保留用户页面，只管理测试自己的资源。

内核、运行时及包含大型二进制缓冲区的对象，引用比较使用
`assert.ok(actual === expected, '说明预期的生命周期')`，不把整个对象交给断言生成
差异报告。Node 的失败报告会深度展开对象及数组，报告本身可能耗尽内存。

浏览器测试连接已经运行的开发服务器和主机 Chrome：

```bash
CODE3D_TEST_URL=http://localhost:3133 npm run test:browser --workspace @code3d/app
```

上例用于主 worktree；任务 worktree 改为自己的端口。Chrome 的默认 CDP 地址为
`http://localhost:9222`，可通过 `CODE3D_CDP_URL` 指定。使用独立测试页面或上下文，
保留用户页面和其他任务的服务器。

浏览器回调通过 `/src/...` 从 Vite 导入 App 模块，测试 TypeScript 配置映射这些路径。
fixture 放在 `packages/app/test/browser/`，从浏览器回调内部导入；页面状态由所属
测试声明。不要为了测试创建与产品不同的模块实例或替代实现。

纯文档变更检查格式、相对链接、锚点和内容依据。修改技能还需验证技能元数据；
修改协调脚本时运行其临时仓库测试，具体命令见 worktree 技能。可视化变更按相关
技能验证真实页面和截图，普通单元测试不能证明视觉效果。

## 开始任务与交付

从[开发文档索引](README.md)选择专题，再查看源码和相关测试。需求、方案与验收
维护在 GitHub Issues；[协作约定](../skills/worktree-development/references/github-issues.md)
负责状态和关闭规则。

代码及文档修改遵循[开发原则](../skills/code3d-prototyping/SKILL.md)。提交、合并、
推送和发布遵循[完整会话交付流程](../skills/worktree-development/references/delivery-subagent.md)，
按当前任务授权推进；本页不另列一套队列、提交或发布规则。
