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

## 公开包产物

`npm run build:packages` 使用 [统一构建脚本](../../scripts/build-packages.mjs)：
TypeScript 项目图负责类型检查、声明和声明映射，esbuild 负责公开入口的 ESM。
仓库基线使用 `module: ESNext`、`moduleResolution: Bundler` 和
`skipLibCheck: false`，公开包开发、声明生成和发布前的安装产物验证均检查库声明。
App 自身与浏览器中的模型语言服务启用 `skipLibCheck`；Web 沿用 Astro 的同项设置。
这些应用仍检查源码如何使用类型，但不检查依赖声明内部，避免 DOM/Worker 标准库
及应用依赖的声明冲突影响编辑和构建。应用层配置不传给公开包构建或发布验证。
各包的 `build` 与 `prepack` 也调用它，发布前不会复用过期的逐文件 JS。
构建先清理目标包的 `bld`，保留原有 exports 路径，并生成共享 chunk、源码映射和
第三方许可说明。Core 的 Node、browser、tooling 与 interop 入口共用内核及缓存状态。

Core 内联 `flo-boolean` 的计算依赖与 `@ctrl/tinycolor`，CLI 内联 `commander`；
这些依赖声明为开发依赖。Replicad、Three.js、HarfBuzz、内核和求解器保持运行时依赖，
跨包引用 Core 仍走公开入口。OpenCascade 与 Solver 保留已检入的原生/WASM 构建产物，
常规构建和 prepack 校验入口、资源与许可证，不启动原生重编译。

源码与 `.d.ts.map` 一并发布，保留语言服务的参数注释和导航。App 内置包与开发模式
`latest @code3d/*` 读取同一份实际 package 文件清单；共享 chunk 的变化也进入内容版本，
无需改 npm 版本即可使本地构建缓存失效。构建分析信息保留在各包
`.cache/bundle-metafile.json`，不随 npm 包发布。

`npm run test:packages` 在已经构建后生成 `dist/packages` 中的真实 tarball，将全部公开包
安装到独立临时项目，验证公开入口、声明导航、内核/缓存身份、文字、Screws、WASM 和 CLI。
声明检查使用 ESNext/DOM 标准库与 Bundler 解析且不跳过库检查；Core 显式携带 HarfBuzz 声明所需的
Emscripten 全局类型和 Replicad 声明所需的 Manifold 类型依赖；后者不进入运行时 JS
bundle。内部抽象成员与实现使用相同的声明裁剪规则。
检查覆盖所有公开类型入口；Node 支持通过真实安装产物的执行验证。
`manifold-3d@3.0.1` 声明的相对导入缺少 `.js` 扩展名，因此不宣称支持
NodeNext 的完整依赖声明检查，也不再通过跳过声明检查进行发布验证。
PlaneGCS 漏发 `dist/planegcs_dist/planegcs.d.ts`，仓库补丁补齐其模块声明及测试使用的
原生资源观测接口；Core 对外声明直接引用上游已发布的源码声明，使消费者无需安装该补丁。
普通白盒测试通过 [源码加载器](../../test/source-loader.mjs) 使用同一份源码模块图，
不要求发布内部 JS 入口。安装产物验证不加载该 hook。

语言加载器分别缓存文件存在性与源码内容：TypeScript 的 `fileExists` 使用批量元数据查询，
只有实际选择的声明或 JS 模块才读取内容。恢复已打包的运行时不应因类型解析而重新读入
其 JS bundle；相关回归要求恢复阶段的实际 JS 内容读取数为零。

## 版本发布

版本 tag 标记本次发布对应的提交，npm 发包是版本发布中交付公开包的步骤。
App 与网站默认在本地构建并通过既有 Wrangler 授权部署；已验证且对应发布提交的
现成产物直接复用，不为发布再等待远端构建并下载一遍。npm 包由下面的 tag workflow
可信发布，分别核验上传与部署结果。
[独立 CI](../../.github/workflows/ci.yml) 在分支 push、pull request 与手工触发时完整运行
格式、类型、单元、真实 npm 产物消费、浏览器示例和网站构建检查。CI 异步运行，
不通过 `needs`、`workflow_run` 或 agent 人工等待成为发布门槛。
[Build workflow](../../.github/workflows/build.yml) 可在 main 更新或手工触发时构建网站，
配置了 Cloudflare CI 凭据才自动部署；该可选路径不替代默认的本地发布。版本 tag
只触发 npm Publish。开始发布时先核对实际部署途径和凭据是否存在，不到构建结束才
发现 deploy 被跳过；个人 Wrangler OAuth 不复制到 GitHub secrets。

### 准备版本

1. 根据实际改动确定版本号和本批需要发布的公开包。同批包使用同一个版本号，
   无需发布的包保持原版本，不批量改动所有 workspace 的版本。
2. 更新这些包的 `package.json.version`，同步受影响的内部依赖版本与根目录 lockfile。
   如果消费者需要依赖本批新增能力，也要更新它的依赖声明并将其纳入本批发布。
   更新受影响的包说明与使用文档。
3. 在任务 worktree 中完成当前增量必要的本地验证，复用本轮已通过的证据；
   修复失败测试并本地跑通即可继续已授权发布，不为版本号或工作流调整重复跑全套。
   使用 `npm run build:packages` 和 `npm run pack:packages` 构建真实 tarball 与清单。
   `CODE3D_RELEASE_TAG=v<版本号> npm run test:packages` 可检查所有公开包，以及仅安装
   本批 tarball、其余依赖从 npm 获取的消费场景；这属于本地/独立 CI 验证，发包 action
   本身不运行测试。
   接着用同一个 `CODE3D_RELEASE_TAG` 运行
   `npm run update:examples:locks --workspace @code3d/app`，由真实 tarball 清单与
   公共 npm 元数据生成示例锁；锁中只记录正式 registry URL 和 tarball 完整性，
   不记录 workspace 或本地文件。提交锁后不得再修改将上传的包内容。
   同一 tag 下的 `test:examples:packages` 与 `test:examples:browser` 使用这些
   tarball 代替本批尚未上传的包，其他依赖仍来自 npm；浏览器沿正常安装、校验、
   解压和解析路径运行。清单与 tarball 不符时失败，不退回旧版包。
4. 按[交付流程](../skills/worktree-development/references/delivery-subagent.md)完成已授权的
   提交与合并，在已验证的发布提交上创建并推送 `v<版本号>` tag。
   Publish 以 tag 对应的提交构建、打包与上传。示例锁引用本批新包时，先推送该 tag，
   确认 npm 包已公开且锁的完整性一致，再推送同一主分支提交并部署网站产物；
   避免网站对用户提供尚不可安装的锁。此顺序只依赖发布结果，不依赖完整 CI。
   网站使用与发布提交一致的本地已验证产物；公开 Markdown 的源码链接也必须指向
   已推送且对应产物的提交。现成产物满足这些条件时不重建；只有已明确选择远端构建
   或正在恢复已有远端产物时才下载它继续部署，不把远端构建设为本地部署前置步骤。

公开包发布按 `dependencies`、`peerDependencies` 与 `optionalDependencies` 的反向依赖闭包联动。
Core 发布新版本时，依赖它的 Materials、Screws 同步更新版本和 Core 最低版本并纳入本批；
传递消费者继续递归纳入。`peerDependenciesMeta` 的可选 peer 只表示可以不安装该依赖，
不能取消安装后需要使用当前版本的关系。private App/Web 和 `devDependencies` 不触发公开包联动。

内部公开依赖统一使用当前依赖版本的精确值，或以它为最低版本的 `^` / `~` 范围；
不使用通配符、tag 或仍允许旧最低版本的范围。无变化且未进入反向闭包的依赖保留已发布版本，
例如 Core alpha.3 继续依赖 OpenCascade alpha.0，Materials/Screws 的 Core peer 更新为
`^0.0.1-alpha.3`。公开包内部 `devDependencies` 的 `*` 只用于本地 workspace 开发。

[发布脚本](../../scripts/publish-packages.mjs)的 `--plan` 在安装与上传前校验最低版本、
遗漏的直接/传递消费者和依赖顺序；`npm run test:release` 覆盖这些约束。
[安装产物检查](../../scripts/test-packages.mjs)从真实 tarball 的 package.json 再执行同一校验，
并安装本批 tarball、从 npm 获取其余依赖，不能用工作区软链接掩盖发布关系。
同步根 lockfile 的 workspace 元数据，并核对 CI 实际上传的已验证 tarball 完整性。

### GitHub Actions 发包

[Publish packages](../../.github/workflows/publish.yml) 由仓库版本 tag 触发，例如
`v0.0.1-alpha.2`；也可重跑对应的 Actions run，或使用
`gh workflow run publish.yml --ref v0.0.1-alpha.2` 手动在已存在的 tag 上运行。
Workflow 拒绝 branch ref，checkout 使用事件记录的 commit；不接受另填 tag 后跨 ref
checkout，避免实际源码与 npm provenance 记录的 GitHub ref/SHA 不一致。
CI 只选择 `package.json.version` 与 tag 完全一致的公开包，
按本批包的 dependencies/peerDependencies 顺序执行；没有匹配包时失败，不自动 bump。

每个 npm 包配置 GitHub Actions trusted publisher：用户 `vilicvane`，仓库 `code3d`，
文件名 `publish.yml`，Environment 留空，允许直接 `npm publish`。
Workflow 使用 GitHub hosted runner、Node.js 24 与 npm 11.19.1，给予 OIDC
`id-token: write` 权限，不设置 npm token。包内 repository 元数据对应当前仓库。
配置规则见 [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)。

Publish 只构建、打包、校验发布范围与产物完整性，并上传对应 tarball；不运行格式、
测试类型、单元、安装消费或浏览器示例测试。打包步骤生成清单，独立 CI 和本地验证
消费同一产物身份；发布不依赖测试脚本生成清单。构建必需的声明生成和产物检查仍保留。
上传阶段不重新打包或执行 lifecycle scripts。
已公开版本仅在完整性与本批已验证产物一致时跳过；默认 dist-tag 为 `latest`，包的 `publishConfig.tag` 可覆盖。
新包必须先在 npm 完成首次创建并配置 trusted publisher；CI 会在上传本批任何包前检查这一前提。
Trusted Publisher 必须允许 direct publishing；只允许 staged publishing 的配置不能运行本流程。
使用 `npm trust list <package> --json` 读取已有 claims，保留仓库、workflow、environment，
通过 `npm trust github <package> --repo vilicvane/code3d --file publish.yml --allow-publish --yes`
配置直接发布。已有配置需替换时，仅撤销匹配本仓库 workflow 的旧记录并复核新配置，
不扩展到其他账号或 workflow，不使用长期 npm token。

本地可在 `npm run test:packages` 后用
`CODE3D_RELEASE_TAG=v0.0.1-alpha.3 node scripts/publish-packages.mjs --dry-run`
查看选择及 registry 状态；只有 `--publish` 才上传。CI 使用 OIDC 执行直接发布，
不再使用 `npm stage publish` 或逐包人工批准。

### 完成发布

核对本批包的公开版本、目标 dist-tag、实际 tarball 的依赖/peer 最低版本和安装结果，
不能只根据 workflow 成功判断 registry 已可用。发包后按本次改动选择必要的公开消费
抽验，不设置 `CODE3D_RELEASE_TAG`，确保安装来自真实 registry。完整示例覆盖由独立
CI 承担，不在上传前后重复运行，也不等待 CI 完成再声明上传结果。交付回报分别记录
版本 tag、提交、包列表、本地验证、发布结果及独立 CI 状态，不把运行中写成已通过。
部分成功时逐包记录状态，重试沿用同一个版本 tag；需要修改源码时使用新的版本与 tag。
App/网站的部署结果按其 workflow 单独记录。

若 npm trust 需要认证，由 agent 发起 CLI 网页授权，给用户可在自己浏览器打开的 URL，
用户仅负责登录/2FA 授权；agent 继续完成配置与核验，不要求用户逐包编辑设置。
授权会话保持运行，及时处理结果，不反复生成链接。权限变更沿用用户的明确授权。
机制见 [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)。

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

示例由 `packages/app/render-samples/catalog.ts` 统一登记，按建模主题组织，App、官网与
文档复用同一源码。`packages/app/test/examples.test.ts` 检查入口覆盖、源码焦点、公开
参数组、真实几何与用途断言；新增或迁移例子同时维护对应测试。

`npm run test:examples:packages --workspace @code3d/app` 在仓库之外的干净临时目录
安装锁定的公开包并检查类型与建模，避免开发 workspace 掩盖缺依赖。
`CODE3D_TEST_URL=http://127.0.0.1:<预留端口>/ npm run test:examples:browser --workspace @code3d/app`
使用 host Chrome，逐例打开、参数写回、几何更新及 Undo，并验证操作失败恢复、完整
工程导出和实际 agent 接续。独立 CI 自行启动受控服务及浏览器，完整运行这些检查；
构建/发布工作流不重复运行。浏览器几何对比在浏览器内计算 typed array 字节摘要，
避免通过 CDP 传输整个网格的 JSON；TAP 逐例输出失败断言，任务结束前也能定位失败。

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
npm run test:packages
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
