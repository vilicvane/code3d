# 项目与运行时

## 文件与项目状态

[ProjectFileReader](../../../packages/app/src/project/file-reader.ts)提供异步读取与文件
版本信息；[ProjectFileSystem](../../../packages/app/src/project/filesystem.ts)承接目录
和写入。Browser storage 使用 ZenFS 的浏览器持久存储，本地目录使用 File System
Access handle 按需访问。编译时通过 overlay 读取尚未保存的源码，不先遍历全部文件。

首屏读取路由入口，展开目录读取直接子项，源码导航和编译只加载触达的文件。
搜索可以遍历目录名称，依赖树按真实路径去重；独立 I/O 有并发上限。
本地句柄请求只合并在途读取，不持久复用可能过期的 handle。

文件树只是目录视图，不能用已加载的 Monaco 文档重建整棵目录，也不能因显示过滤
让模块解析看不到文件。显示规则采用 VS Code 浏览器版默认排除项：`.git`、`.svn`、
`.hg`、`.DS_Store`、`Thumbs.db`、`*.crswap`；不读取 `.gitignore` 或用户排除配置。
`node_modules` 和内部目录可见。显示、写入保护、复制和移动各按自己的规则处理。

项目文件保存、文件操作和 agent 修改共用项目会话队列。磁盘批量操作先预检，
逐项成功后同步文档、tab、路径和目录状态；中途失败以真实磁盘结果恢复，不宣称
跨文件系统操作具备数据库回滚能力。删除最后一个文件和关闭最后一个 tab 都合法。
新建条目允许多级相对路径，文件系统递归创建缺失父目录；预检仍拒绝目标冲突、
以文件作为父目录和受保护路径。移动与复制仍要求目标父目录已存在。

内置示例是独立的托管目录，更新和重置不能覆盖作者的其他文件。切换项目不复制前一项目。
浏览器存储默认创建示例，本地项目仅在空目录首次打开时询问是否创建；`.code3d` 元数据
不算作者内容，其他条目均使目录非空。项目清单记住跳过决定，非空目录不询问、不自动
添加示例；未托管的用户 examples 不参与版本同步。显式创建或重置后才纳入托管，
已托管目录保留自动更新。切换本地目录与
Browser storage 以当前页面的项目连接为单位。Browser storage 标题菜单支持显式复制到空本地目录并打开，
按字节复制项目文件、配置、资源、示例及空目录，递归排除 `node_modules`、`.code3d` 和
`code3d-lock.json`。复制与保存共用项目操作队列；完成后核对 revision，期间新增编辑时保留
浏览器项目，不自动离开。复制失败保留原项目并提示目标可能包含部分文件；不覆盖非空目标。
Browser storage 的 Reset 通过共享确认对话框明确丢弃项目文件、未保存编辑和已安装依赖。
确认命令只暂存于当前 tab 的 sessionStorage，不放进可分享 URL；强制重新加载页面先结束
旧编辑、安装和编译任务，在打开 ZenFS 之前删除项目专属 IndexedDB，再复用初始项目与
托管示例初始化。等待期间始终显示关闭其他 browser storage tab 的提示：刷新后排在旧
删除请求之后的新请求不一定再次触发 IndexedDB blocked 事件。删除失败提示错误并保留
原项目。命令在初始化和构建缓存清理后消费，等待中刷新页面仍会继续重置，完成后普通
刷新不会重复重置。重置后首次编译前清理 browser 工作区构建缓存，不清理其他
数据库、本地目录句柄、App 设置或共享几何/下载缓存。
位置操作 busy 状态由 MobX 驱动标题及菜单按钮。目录权限失效需重新连接。本地目录在页面
可用时使用 FileSystemObserver 递归事件，按变化路径检查涉及的源码；跳过生成目录事件，
未知事件强制核对源码，观察失效回退轮询。无事件支持时，页面可见才检查已打开文件及
编译涉及的工作区源码，每轮结束后等待 max(5 秒，本轮耗时 × 50)，不重叠执行；
元数据检查并发上限 16。重新聚焦或恢复可见时立即检查；手动刷新跳过版本判断强制
重读这些源码，再通过 refreshProject 清空项目与内置文件读取缓存，从入口重新解析
源码、配置、依赖与本地资源，重建依赖产物；不全盘读入未使用文件，保留内容寻址的几何缓存。
项目会话复用保存队列读取磁盘版本，
变化才读取正文；首次检查与编译源码快照比较，缺失路径继续检查以识别重建。
发布前重新核对编辑器版本和未保存草稿，外部内容经既有编辑入口更新但不写回磁盘。
外部操作推进项目 revision 并触发构建，页面关闭停止检查并拒绝晚到结果。文件清单、当前文档、未保存 overlay 与运行时
各自拥有状态，不把切换文件视作重新创建整个项目。

项目元数据使用唯一现行结构，原型期间格式标记固定为 `version: 1`，与托管目录的
内容 revision 分开。初始化按当前结构读取并写回清单，保留托管目录的修订记录及
跳过决定；不以版本标记决定是否重新初始化，也不维护旧格式转换链。

入口与验证：[directory-access](../../../packages/app/src/project/directory-access.ts)、
[file-operations](../../../packages/app/src/project/file-operations.ts)、
[project-session](../../../packages/app/src/agent/project-session.ts)、
[project-loading](../../../packages/app/test/project-loading.test.ts)、
[directory-file-reader](../../../packages/app/test/directory-file-reader.test.ts)。

## 包环境与模块解析

[ProjectPackages](../../../packages/app/src/project/project-packages.ts)为运行时、资源和
语言服务选择同一份有效包文件系统。活动源码所在清单或祖先清单声明 Core 时，
使用项目的整套建模依赖；否则以只读内置包提供 Core、Screws 和 Materials 的
零安装入口。内置闭包经普通分层路径隔离，不能出现第二份公共 Core 实例。
已声明的包缺失、exports 禁止或内容不兼容时明确报错。

Vite 开发模式将 `latest` 的 `@code3d/*` 请求优先解析到仓库中存在的可发布
workspace，直接依赖、传递依赖和 npm alias 使用同一规则。明确版本、其他范围或
标签以及不存在的 workspace 保持正常解析，生产构建不提供 workspace 覆盖。
[包产物插件](../../../packages/app/build/browser-packages.ts)枚举根 workspace
清单，按实际 npm pack 文件列表提供 JS、声明、源码和二进制，以全部产物内容生成
指纹；私有 App 和网站不作为 npm 包提供。

本地文件夹的 [WorkspaceFileReader](../../../packages/app/src/project/workspace-packages.ts)
将 latest 引用映射到统一开发产物路径及仓库自身依赖闭包。编译、类型、源码导航
和源码页刷新使用相同实际路径，不改写磁盘清单或 `node_modules`。Browser storage
则通过下述安装事务物化所选包。

普通文件编辑读取真实文件内容。运行时为无显式 `type` 的项目合成 ESM 元数据视图，
不能把这个 JSON 视图写入编辑器，改变用户清单的缩进、字段顺序或语义。

[package-resolver](../../../packages/app/src/project/package-resolver.ts)通过
`enhanced-resolve` 处理项目路径和包条件。类型与执行使用不同解析目的，但共享
文件事实：类型走声明与类型条件，浏览器运行走可执行的 browser/import/default
出口，Node 直接运行以 Node 自己的规则为准。不能由声明可解析推断实现可在浏览器运行。
不提供 Node 内置模块或 native addon 的自动替代实现。

项目文件路径与 Monaco URI 在[边界适配](../../../packages/app/src/monaco/typescript-file-names.ts)
转换。磁盘上的可读路径不预先 URI 编码；定义跳转保留声明映射和实际包源码路径。
包源码只读，普通项目 JSON 等文本保留真实原文。

## Browser storage 包安装

每个项目清单在自己的目录维护 `code3d-lock.json` 与 `node_modules`。锁是
[项目自有的包图](../../../packages/app/src/project/package-lock.ts)，记录精确版本、
包记录和依赖边；不是 npm 的 package-lock，也不泄露 JSPM SDK 类型。

职责分工：

| 实现                                                                                                      | 职责                                               |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [BrowserPackageManager](../../../packages/app/src/project/browser-package-manager.ts)                     | 目录任务互斥、懒准备、进度、失败归属和安装代次通知 |
| [BrowserPackageInstaller](../../../packages/app/src/project/browser-package-installer.ts)                 | 解析、下载、校验和物化依赖                         |
| [Package installation transaction](../../../packages/app/src/project/package-installation-transaction.ts) | 暂存、备份、提交点和中断恢复                       |
| [InstalledPackageReader](../../../packages/app/src/project/installed-package-reader.ts)                   | 已安装文件读取、真实路径与元数据缓存               |
| [JSPM adapter](../../../packages/app/src/project/jspm-package-resolver.ts)                                | 隔离 JSPM 包级内部 API，输出稳定包记录与依赖关系   |
| [NpmRegistry](../../../packages/app/src/project/npm-registry.ts)                                          | 元数据和归档请求、完整性与缓存                     |

普通运行按有效锁准备，显式 Update dependencies 按现有清单约束忽略旧解析结果；
固定版本仍固定，其他目录清单不被更新。Install package 在选定项目目录修改清单，
缺失清单时创建它并加入指定包与 `@code3d/core: latest`；已有清单保留其他字段。
在 `node_modules` 内发起操作时，向上定位依赖目录之外的项目清单。
本地目录依赖由外部包管理器安装。

开发 workspace 与 npm 归档共用包图解析，锁记录本地产物的内容指纹。既有 npm
锁、本地同版本重建和切回生产会在准备时重新选择，再通过原有事务提交；本地包与
同版本 npm 包使用独立物化路径，保留固定版本选择。满足范围的 peer 共享项目所选
Core，冲突明确报错，不能隐式安装第二份公共 Core。

只有依赖消费者显式使用 manager 的 `dependencies` reader 来启用懒准备。
普通文件和已安装源码浏览不等待后台安装。新增依赖作用域、清单或锁变化可能在
后续模型准备中触发安装；普通源码编辑复用准备结果。

解析按确定顺序选择版本，独立元数据最多 15 路预取，同一次解析合并重复请求和
失败；显式更新建立新的请求缓存。归档下载与完整性校验最多 15 路，解包和写入
串行进行并与下载重叠，限制等待解包的数据量。并发结果不改变最终依赖图。

事务先暂存完整结果，再建立链接和替换目录，锁的原子替换是提交点。提交前失败
恢复旧安装，恢复失败保留备份；提交后清理失败不撤销新安装。任何失败先排空在途
任务再清理，下一次操作先完成中断恢复，再解析清单或发起下载。

安装代次变化统一失效包文件、语言库、导航和打开的锁/源码；旧版本消失时关闭
相应只读文档，不覆盖可编辑文件。恢复也会产生变化通知。UI 刷新失败保留已提交
的安装状态，并允许下次重试通知。

进度和错误按目录管理，成功提示独立计时收起，不依赖当前活动文件。安装错误
只显示一份，修正清单后的成功准备清除原失败；模型诊断与包状态分开。
回归入口：[package-installer](../../../packages/app/test/package-installer.test.ts)、
[project-packages](../../../packages/app/test/project-packages.test.ts)、
[package-install 浏览器测试](../../../packages/app/test/browser/package-install.test.ts)。

## 语言准备与源码构建

CompilerClient 的当前语言快照是响应式状态，编译请求与语言消息共用请求 ID：
开始新的准备时快照未就绪，只接受仍属当前请求的结果。编辑器诊断的就绪边界与
过期结果处理见[编辑器状态与诊断](tooling.md#编辑器状态与诊断)。

[Project language](../../../packages/app/src/project/project-language.ts)按导入闭包读取
真实声明、源码映射及源文件，不生成另一套作者 API 声明。语言准备不初始化内核。
编辑器的默认基础库是 ECMAScript，不能把宿主项目的 Node/DOM 类型自动注入作者
环境；项目明确导入的依赖按真实声明解析。模型支持 esbuild 转译的 TypeScript
语法，包括 namespace、enum 和构造函数参数属性，不默认限制为可擦除语法。
采用 ESNext/Bundler 模块解析与 `browser` 导出条件，与 App 的浏览器打包入口一致。
模型语言服务默认跳过依赖声明内部检查；项目 tsconfig 仍可覆盖普通类型检查选项，
但不能把模块解析或导出条件改为 Node。相对导入支持省略源码扩展名；直接交给
Node 执行源码时，仍须满足 Node 自身的导入规则。
跨编译保留未变文件、SourceFile、Program 和导航映射；普通编辑增量更新输入。
工具参数、字体与草图源码分析共用语言加载器拥有的 Program，不重新解析整套声明。
新增导入扩展闭包，移除导入时撤下仅由它触达的语言库，再次导入可复用已读内容。

阶段按实际工作发布：`reading-files` 覆盖入口源码与配置读取，语言加载器发现缺失
声明或重建导入闭包时发布 `resolving-imports`，缓存命中可跳过后者。包管理准备和
依赖 bundle 使用 `loading-runtime`（显示 Loading dependencies）；代码编译显示
Compiling code，内核初始化显示 Starting modeling engine，作者代码执行显示
Building model。执行器在收集对象图、网格/拓扑查询和快照组装之前发布
`preparing-preview`，前端持续到渲染结果接收后再恢复 Ready/Model error。

`ModelPreviewState` 从编译客户端的 observable phase 派生文字与 tooltip，普通
编译与补全预览使用相同路径，不保留每次调用的 phase-to-label reaction。等待
输入期间内部仍 busy，但无可见状态条；Preparing preview 由状态 DOM 消费者延迟
200ms 显示，状态离开、取消和视图销毁都清除定时器。延迟不影响编译或 agent 就绪
判断，不显示虚构百分比，也不延长已完成阶段。

模型编译在项目与内置包的原始文件 reader 上统一应用仓库已有的
`squares-rng@2.0.4` Worker 补丁，再进入文件缓存和包解析。因此 npm 下载、
本地安装与内置包使用相同有效字节，打包和 kernel identity 保持一致；已经应用
补丁的内容直接保留，其他版本不变，也不修改用户的安装目录。补丁内容参与
compiler recipe，更新补丁后不会复用旧编译产物。
Worker 批量检查已经触达的路径，整批成功后再应用失效；取消前仍完成失效收尾，
读取失败不缓存成“文件不存在”。Browser storage 安装树使用清单、锁和安装标记
版本复用未变的只读元数据。普通项目文件检查真实变化；普通 npm 实现按安装元数据
复用，同版本手工修改通过文件树的 Refresh files and dependencies 生效。开发映射与
内置包目录携带已发布文件的内容 revision，因此工作区重建会自动失效。

[ProjectBuilder](../../../packages/app/src/project/project-builder.ts)使用 esbuild-wasm
链接模块。编译 Worker 为源码发现、依赖整体和当前入口保留各自的
`context/rebuild`；切换入口复用这些槽位，不为未打开的文件预先构建。源码分析和
仪器化是独立的前置变换。工具元数据直接复用语言服务持有的 TypeScript Program，
不再建立第二份解析树。只追踪项目中的模型相关源码，
不把全部第三方依赖当作者模型代码改写。TypeScript、CommonJS interop 和循环模块
由构建层处理。静态字符串 dynamic import 保持按需执行；计算出的 specifier 明确
诊断。资源使用静态 `new URL(literal, import.meta.url)`。

JSDoc 工具与 inspect 元数据共用声明、重载和别名定位；回调符号在声明所在作用域
解析，不借用调用处的同名变量。本地 inspector 保留原词法环境，发布包则使用普通
模块导出或函数的 namespace 属性。`@internal` 可以隐藏 helper 的声明，运行时寻址
仍保留完整符号路径，不能要求被 `stripInternal` 删除的成员具有类型声明。

编译诊断保留原文件与 UTF-16 源码范围，不能把打包器的字节位置直接当编辑器 offset。
语言与构建回归见 [project-language](../../../packages/app/test/project-language.test.ts)、
[project-builder](../../../packages/app/test/project-builder.test.ts)、
[project-diagnostics](../../../packages/app/test/project-diagnostics.test.ts)。

## 构建产物与恢复

[ProjectCompiler](../../../packages/app/src/model/project-compiler.ts)只负责语言、
源码变换和构建产物，不初始化建模内核。[DependencyBuilder](../../../packages/app/src/model/dependency-builder.ts)
让 esbuild 处理完整依赖图，各个源码入口引用同一份匹配的依赖产物。解析元数据包含
实际模块路径、包清单及缺失清单、安装锁和目录 revision；因此嵌套安装和传递依赖
变化会失效。恢复先校验这些元数据，未变时直接复用依赖输出，不重读整棵实现源码。
依赖入口按已浏览源码真正导入的模块累计，包内部模块仍由 esbuild 链接，不把每个
内部实现文件分别注册成公开入口。Core 发现与第一次依赖输出共用一次构建；首次
引入新的外部模块才扩展整体产物。恢复旧入口时，若当前产物
仍包含它的模块且内核身份、解析元数据一致，复用当前合集，避免执行 Worker 来回重启。

[BuildArtifactCache](../../../packages/app/src/model/build-artifact-cache.ts)以项目身份、
规范化入口路径和构建上下文查找 `latest`。每个被浏览的源码文件独立保存，即使它
没有模型或已被另一个入口导入。完整可执行快照包含依赖身份、JS、源码/追踪信息及
资源；不可变二进制按内容共享，其指纹在身份计算和持久化之间复用，JSON 清单压缩保存。依赖另有按项目、包来源及依赖目录
索引的最新产物，独立于模型入口记录；新打开的文件也能直接恢复同作用域的整包
产物。模型历史淘汰不要求一起删除仍可复用的依赖，手动刷新跳过旧依赖恢复。无语义的 Map 读取顺序不
参与身份。语言服务的声明、导航和打开文件集合由编译侧单独发送给编辑器，
不进入可执行产物及其缓存身份；草图源码事实也只提取当前模型的导入闭包，
打开无关文档不会导致相同模型重复执行。构建实现身份由构建插件从代码和工具锁生成，不设置手工格式版本。

会话保留 256 MiB 构建产物 LRU；磁盘与几何、HTTP 资源共用日志及预算。完整内容
按整份清单批量检查并更新访问时间，只序列化和写入缺失内容，再以短事务
检查引用并发布时间单调的指针；缺失任意引用时视为未命中。
取消保留已经入队的完整历史内容，后台继续落盘，不发布该次构建。`successful` 单独记录最近成功执行
的产物，不由执行失败覆盖。新 Worker 先执行可用的历史产物，后台同步工作区并
构建当前版本；相同产物无需重复执行。恢复展示尚未校验当前源码时，源码工具和
导出不对该旧结果启用。当前执行失败保留已有成功视图并报告当前错误。

构建记录按工作区身份、编译实现身份划分命名空间，二进制共享限于该命名空间。
文件树根目录的 **Clear build cache** 重建编译 Worker，并在短磁盘事务中删除该
工作区所有编译实现的记录，压缩日志回收空间；新恢复和构建等待清理结束。随后
重新构建当前文件，几何与下载资源缓存及其他工作区的记录不受该命令影响。

恢复的是输出，不是 esbuild AST；编译 Worker 按需重建 context。跨 Worker 只传普通
数据，不传 TS Program、函数、模块 namespace 或原生 Shape。每条有序 Worker 通道
只在依赖身份变化时发送完整依赖；执行侧只接收当前入口数据和自身资源，不接收
类型声明，也不重复复制运行时已有的资源。重建 Worker 后重新发送完整依赖。回归入口为
[build-artifact-cache](../../../packages/app/test/build-artifact-cache.test.ts)、
[build-artifacts 浏览器回归](../../../packages/app/test/browser/build-artifacts.test.ts)与
[compiler-progress](../../../packages/app/test/browser/compiler-progress.test.ts)。

## 执行与生命周期

[ProjectExecutor](../../../packages/app/src/model/project-executor.ts)在独立执行 Worker
中接收产物，[ProjectRuntime](../../../packages/app/src/model/project-runtime.ts)加载其
依赖代码，通过所选 Core 的 tooling 安装 OpenCascade、PlaneGCS 和字体引擎。
Node 的 Core 入口自行完成对应初始化。依赖产物变化会替换整个执行 Worker；普通
源码版本使用新的求值上下文，继续复用依赖实例和内核。可执行函数包装和 sketch
源码诊断所需的静态分析在编译侧完成并随产物保存；执行 Worker 不加载 TypeScript。

[共享内核安装入口](../../../packages/core/src/library/open-cascade.ts)供 Node 与 tooling
共同使用，安装时清理旧缓存并绑定该内核的原生内存计数。通用计算缓存不负责安装
内核，未安装时原生用量为零，因此编译 Worker 中的 Google Fonts CSS 解析等纯计算
可以使用同一缓存，无需加载几何 WASM。

[ModuleEvaluator](../../../packages/app/src/model/module-evaluator.ts)执行原生 ESM
生成的函数。依赖模块 namespace 与源码执行范围分离，避免旧模块 exports 持有
每次求值的模型。缓存的依赖通过 ESM facade 保留 default export 和 live binding；
内部载体使用正确扩展名，不能把 CommonJS 放在原来的 `.mjs` 路径下。

依赖的模块链接、循环和初始化顺序由 esbuild 的整体输出负责；运行时按需调用其
入口，并为同一路径合并初始化 Promise、发布 namespace。这样保留并发 dynamic
import 和顶层 await 的共享身份。
失败图释放等待者，运行时记住对应错误，其他独立导入仍可继续。

每次求值用 `beginModelEvaluation` 建立上下文，在快照之后通过 `finally` 收尾。
trace、provenance 和源码位置属于本次求值；缓存几何或依赖模型不携带上次源码
偏移。完成快照与下一次求值独立，导出请求绑定已完成的 compile revision。
源码联动在本次求值内按完成顺序和调用位置建立执行索引，查询具体 reach 或工具调用
不能反复扫描整个 trace 集合。像素、顶点等纯数据循环同样会产生 trace；观察输入只
遍历可枚举的数据属性，不读取 getter 或枚举 Math 等对象的非枚举成员。求值上下文
仅由 Worker 内部使用，不随模型快照传回界面。

[InspectionSession](../../../packages/app/src/model/inspection.ts)另行持有当前求值的
原始值、真实 receiver/参数/返回值及已声明 callback 的逐次执行，供执行器按源码
位置调用 inspector。下一次求值或执行器销毁时释放该会话；模型快照和导出仍各自
持有自己的数据。closure 上下文工厂按实际 callback 执行惰性缓存，独立于哪个
inspector 接管画面；子层可读取父层上下文。由内向外选择首个返回结果的 inspector，
参数先尝试参数 inspector，再退到函数级 inspector，最后使用该调用的普通返回值。
已声明 closure 的函数体保持独立范围，放行后不重新进入同一拥有者的参数/函数级回调。
`undefined` 放行，空对象表示明确的空画面。实际已调用的函数即使抛错也可 inspect；
返回值为 undefined，参数和抛错前 data 保留。实参失败或可选链短路未调用函数时跳过。
执行 inspector 不重新记录模型 trace，
错误使用独立的 inspect 诊断。真实模型验证见
[source-inspection](../../../packages/app/test/source-inspection.test.ts)。

box / extrude 的参数尺寸由 Core inspector 返回 `dimension` 候选直线段，
渲染器按进入时相机位置选取最近候选，保存到该检查图层的实例选择缓存；转动相机
或重复检查不重选，离开该参数后释放选择。固定端点与候选共用数值、虚线和刻线绘制。
旧参数直边装饰和 Boolean 交集/截线预计算已删除；切入体积只在对应 inspector 中按需计算。

App、补全预览、截图导出与 agent observe 共用 `compiler.inspect` →
`renderInspection`，不再按操作名另建源码预览场景。补全取消恢复完整检查场景及相机。
保留位姿的检查对象沿原对象身份复用相机记忆，并在显示坐标系和存储坐标系之间转换。
工具可以编辑 ambient 参与者，但不因此提升其检查层级。空间关系函数与链式选择器
使用共用的函数级 inspector，通过已消费的关系返回值取得对应阶段；未消费的链不接管。
检查没有可预览结果时，仍按当前实际调用发布源码工具上下文；场景保留与工具激活
分别处理，让缺参或失败调用仍可通过工具补全。拓扑引用的 JSDoc 指向
`inspectTopologyReference`：有引用结果时放行到默认预览，无结果或空集合时返回
所属模型的 ambient。两种情况因此共用背景颜色与透明度，而候选和已选样式由工具提供。
其他未完成工具的主体从既有 selection input / relation owner 定位，按目标模型样式绘制，
避免链式枢轴调用失败后把最后求值的约束目标点当成操作对象或退回普通不透明材质。

表达式匹配优先选择最精确的源码范围，执行顺序仅区分同一位置的重复执行。
实参记录保留完整容器以及参数周围空白的范围；成员表达式仍使用更窄的范围。

Core 的 `captureInspectData(data)` 将库定义的数据附到实际执行的当前 inspect 调用，
回调通过 `context.data` 读取；未记录时为 `undefined`，同一调用最后一次记录生效。
closure 工厂可通过 `execution.call.data` 读取所属调用的记录。宿主按调用持有引用，
不克隆、解析或按返回值匹配数据；需要调用时快照的库自行保存不可变数据。
无记录会话时该函数不做任何事，inspector 执行期间也不覆盖建模记录。
执行器以 `finally` 恢复记录入口；新模型求值和销毁释放上一会话的数据。

检查结果在执行器内转换为普通可序列化快照，模型、锚点、草图、`dimension` 与
`boundsAnnotation`、`anchorAnnotation` 标注共用这一边界。生成的草图使用独立的身份注册范围，不因反复移动检查位置而累计
保留临时草图。草图点线按 `[x, y] → [x, 0, -y]` 放入自身平面，再应用参考架的
实际位姿；开放曲线、上游层与跨层点别名直接绘制，不经过 B-Rep 面构造。关系检查
保留选中阶段的草图参考架及原值身份，Sketch 与 Model 可混合分配 target/ambient。
草图快照同时保留源码草图身份，光标落入求值为草图的源码目标时自动打开二维编辑工具，
移出后回到三维检查；仅出现在混合检查场景中的草图不接管编辑，其可用性及画布视图由
SketchEditorController 的 MobX 状态统一驱动。
`beginModelInspection` 保留原模型 trace 与缓存工作集，检查生成的
几何在结束后进入有预算的历史缓存；不能借一次检查替换整次建模的保留范围。
ProjectExecutor 另持有最新成功检查场景的原生几何快照，供该场景的拓扑查询和导出
使用；完整快照成功后替换，失败时保留旧快照，新建模或执行器销毁时释放。
AgentObserver 使用同一 inspect/三维绘制入口，截图不再创建二维 SketchEditor。
混合场景的草图层继续返回局部二维拓扑，并附参考架的 geometryToScene；分页只选择
拓扑数据，截图始终呈现完整检查场景。建模失败但检查成功时保留 model_failed，
错误详情携带检查快照，失败响应可带 artifacts；ProjectSession、协议解析、回执、CLI
与 AgentRenderHistory 共用这一路径。CLI 保存图片但仍以 1 退出，历史状态由既有
MobX action 发布；检查失败不复用旧图片，建模诊断保持主错误。
选中无可预览值的位置返回 undefined 时，App 保留当前画面，执行器也保留其原生
几何；只有实际替换场景（包括明确的空画面）才释放上一检查快照。

执行 Worker 串行运行检查、建模和其他内核操作；异步模块加载或快照计算不能让
两个内核上下文交叠。client 的 inspect 请求独立于编译/导出请求，带执行版本及
取消信号。新检查取消旧检查，新编译使旧检查失效；迟到结果和旧执行版本不能
发布。错误通过独立的 inspect 响应返回，不把已成功的模型改成编译失败。

`ModelPreviewState` 持有当前检查请求与已呈现模型，作为独立的历史状态。检查期间
保持原画面，最新结果就绪后在同一 action 内提交视口和已呈现版本；新请求、源码
失效与页面生命周期使旧请求失效。编辑工具只消费当前已呈现的有效源码版本。
计算失败保留旧画面，诊断不覆盖建模结果。真实 Worker 与 App 验证见
[浏览器检查测试](../../../packages/app/test/browser/source-inspection.test.ts)。
工具栏激活源码时等待该次检查成功呈现，再把工具选择绑定到新的上下文；被后续
选择取消的请求不得恢复旧工具。保留位姿的模型快照通过 `sourceNodeId` 关联原对象，
视口保留它的几何和位姿，并合并原对象的编辑元数据与当前关系阶段。关系阶段是
部分数据，不能代替完整对象，否则原点、参数及操作来源会丢失。

Core 的 distance inspector 使用原调用保存的端点与共同位姿。各参与者被保留为
独立的普通模型预览值，target/ambient 直接决定层级；不从 ambient 组合中自动
提升子实例。库内保留坐标架的副本关联原值身份，使 focused 仍能识别同一元素；
新生成的辅助几何不自动继承 focused。relate 上下文来自本次实际采用的关系序列，
不扫描 closure 中出现的对象；检查已采用的关系时按连续约束段与变换顺序求解。
阶段结果在该次调用的上下文中缓存，重复检查不重新执行用户 callback。
集合只有全部成员属于该次关系时才由 relate 接管；混合集合整体放行到默认预览。
数组、嵌套集合及命名集合共用这一判断，不执行 getter。
源码目标记录 `inspectCallId`，普通值目标关联到实际所属调用；它不依赖返回数值，
在循环实例与参数/逗号之间导航时保留所选调用。方法使用完整调用范围，包括 receiver。
App 不再保留 DistanceObserver/DistanceSnapshot 或测距专用源码目标与装饰 provider。
`anchorAnnotation` 显式选择 none/forward/both，原始 Anchor 保留普通预览；同一引用的
重叠几何保留最强层级，方向标记分别保留朝向。focused 只匹配对应值，不从模型隐式
传给其所有元素。
group 参数检查使用返回组合已保存的成员位姿；expose 保存本次读取的命名引用，
检查时不重复执行 getter。Boolean 与 loft 保存实际共同求解位姿，通过同一普通模型
值路径呈现输入和结果。cut 工具检查按 focused.solids 计算被切入体积；生成区域放在
stock 的原调用坐标架中，不继承工具的 focused。函数 identifier 仍默认查看原返回值。
cut / intersect 的选中输入作为 target，其余输入作为 ambient；生成区域作为独立
target，分别通过普通 material 表达橙色与青色。通用渲染器在默认模型材质下也区分
focused / target / ambient，数组成员切换不依赖工具选择或关系标记才产生可见差异。
辅助区域通过原生不受光照影响的材质声明前景显示；非 ambient 的 depthTest: false
材质在普通半透明模型之后合成，避免区域又被输入模型盖住。
普通表达式值与 inspector 返回场景共用传输和渲染，但快照显式携带
`kind: 'preview' | 'inspect'`。只有 inspector 对模型应用 target 层级透明度上限；
普通值、集合、调用结果、参数回退和补全保留作者材质，未设置材质时仍使用默认
半透明表面。Anchor 隐含所属模型始终弱化为上下文。标记随快照原样传递给 Worker
消费者、暂存恢复和截图导出，不从场景内容猜测来源，也不改动公开 InspectResult。
模型边界继承所属面的深度测试策略，不写深度；背景、普通模型、前景各层分别固定
先面后边，使用同一份绘制顺序定义。不能让前景面与普通边拆层，也不依赖旋转后
相机距离排序碰巧把边画在面之后；屏幕和截图导出遵循同一顺序。

`on` 的范围标注使用求解器给出的精确有限范围与接触参考架，转到保留位姿的 owner
局部空间；渲染器按值种类绘制屏幕角线，不检查建模函数名称。范围框沿用实例级
去重规则，覆盖同实例的普通选择框，并抑制接触面重复的角线。

生成的执行函数按内容去重，但浏览器原生 ESM 记录会保留到 Worker 结束；回收 Blob
URL 不等于卸载模块。不能承诺无限多不同源码版本下 JavaScript 内存零增长。
原生模型所有权见[建模内核](modeling.md#互操作与资源所有权)。回归见
[project-runtime](../../../packages/app/test/project-runtime.test.ts)、
[cached-module-exports](../../../packages/app/test/cached-module-exports.test.ts)和
[module-evaluator](../../../packages/app/test/module-evaluator.test.ts)。

## App 性能设置

[AppSettings](../../../packages/app/src/app-settings.ts)拥有当前浏览器的性能偏好，
通过 MobX 发布已提交值并持久化到 localStorage，storage 事件同步其他标签页。
[设置对话框](../../../packages/app/src/ui/app-settings.ts)复用 AppDialog，输入草稿在
保存后提交；分类侧栏由组件自己的 MobX 活跃分类状态控制，切换仅显隐原面板，
保留各类输入节点和草稿。导航支持键盘与窄屏顶部布局，保存统一验证所有分类，
错误定位回所属面板。每个字段仅在对应已提交值变化时回填，不因其他设置变化覆盖草稿。
恢复默认值通过统一 `dialogs.confirm` 确认后回填所有分类草稿，仍需保存才提交。
设置不属于项目清单，不改变模型语义，也没有产品格式版本迁移路径。

编辑及补全调度在下一次请求读取延迟；渲染器订阅像素倍率上限并立即调整画布。
ModelCompilerClient 发出执行请求时携带普通计算配置快照，ProjectExecutor 在执行
边界更新 Core 历史缓存软预算、落盘耗时阈值与几何查询并行度；缩小并行度释放多余 Worker。
落盘阈值默认 1ms，接受非负小数，0 取消耗时筛选；通过 Core tooling 的
`setKernelCachePersistenceThreshold` 只影响之后计算的新条目，已有条目保留资格。
读取设置时用字段默认值补齐未设置项，保留其他已保存偏好。
页面预览和 Agent 观察使用同一偏好，取消/重启后的 Worker 仍收到当前值。
ArtifactStoreHost 订阅磁盘预算并传给 I/O Worker，各次事务按当前预算打开日志；
缩小预算时按现有日志整理规则淘汰缓存。新增订阅由所属页面/服务生命周期销毁。
当前数值默认值与合法输入边界由设置源码维护，用户说明见
[性能设置](../../../packages/web/src/content/docs/docs/getting-started/app.md#performance-settings)。

## 计算缓存、持久化与并行快照

[CachedDefinitionCompiler](../../../packages/app/src/project/cached-definitions.ts)
在追踪与转译前为静态函数、其引用的本地声明、导入实现图和 codec 生成内容指纹，
支持 alias、namespace、re-export 和 CommonJS require。无关本地变量、源码位置
及 export 变更不失效，引用的 helper/依赖变更失效。函数身份通过求值上下文注册，
不改变原模块格式，每次定义绑定独立 callable，避免同一作者函数的不同 codec 串用。
`cache(fn)` 返回缓存函数，`cache(fn, args)` 立即求值，共用定义身份和参数键。
第二参数只参与运行时参数 key，第三参数 codec 才参与定义指纹，避免输入变化或
调用方局部变量被误判为函数依赖。Core 自身沿用整体运行时身份，不重复分析其所有缓存定义。

动态工厂结果、函数参数和捕获外层函数/循环绑定的闭包使用函数对象身份，仅在内存
复用；普通 Node 调用亦如此。作者无需 id/version，动态状态必须显式传参。默认
数据 codec 保留精确标量、循环/共享数据图、稀疏数组和共享二进制视图；自定义结果
类型成对提供 encoder/decoder。缓存同步完成值，异步计算不能进入。
新计算只有 compute 耗时达到宿主配置的阈值（默认 1ms）才取得磁盘资格；资格随内存条目保留，低于阈值
的结果仍参与内存 LRU，但命中、换 store 及取消收尾均不会补编码或写盘。磁盘恢复
的条目保持已有资格，不用读取/解码时间反推计算成本。批量快照在 Core 内测量各次
query 的计算时间，经 Worker 或本地回调传回 admission，不计输入恢复、消息传输
和宿主的缓存接纳成本；原有持久化格式和 key 不变。内存命中直接
复用保留值，不重新解码；资源所有权见[建模内核](modeling.md#互操作与资源所有权)。
回归见 [cached-definitions](../../../packages/app/test/cached-definitions.test.ts)
和 [cached](../../../packages/core/test/cached.test.ts)。

[kernel-cache](../../../packages/core/src/library/kernel-cache.ts)以完整计算及真实几何
内容为边界，查询 bounds 和 mesh 也可复用。内部裸 Shape 与包含 shape、拓扑和
bounds 的 ModelGeometryValue 分别使用 `kernel-shape:` 和 `model-geometry:` 操作
命名空间；同一变换及相同输入不代表两类工件可以共用值或生命周期。该区别参与
内存及持久缓存的键与签名，不使用格式版本数字隔离。几何值已保存紧致局部包围盒；方向
查询只交换或反转坐标轴时直接推导，不再为六个方向各建查询记录。任意角度旋转
及有限拓扑仍查询真实几何，不能以旋转原包围盒代替。已知的快照查询通过 `getMany`
批量恢复，只有未命中部分进入计算。当前工作集完整保留，历史按内存 LRU
预算淘汰，默认 2 GiB 软预算；预算包括已分配原生块与估算 JS 数据，不是 WASM buffer 大小或进程总
内存硬上限。正常完成、抛错和合作取消采用同一收尾边界。

[persistent-artifacts](../../../packages/app/src/model/persistent-artifacts.ts)与
[artifact-journal](../../../packages/app/src/model/artifact-journal.ts)把可持久化计算结果
保存到 OPFS。构建产物、几何与 HTTP 资源共享 App 设置指定的磁盘预算（默认 2 GiB，不按浏览器配额或剩余空间截断），含整理空间。命名空间来自实际运行时代码和 WASM 的内容身份，不使用临时 Blob URL。
日志带签名及校验，整理副本在完整写入后发布；损坏、配额不足或存储不可用时继续
内存模式。索引按需读取记录，不预载全部历史几何。

[ArtifactStoreHost](../../../packages/app/src/model/artifact-store-host.ts)由项目的
`ModelCompilerClient` 持有，为编译和执行 Worker 分配独立连接。替换或强制终止计算
Worker 不终止 I/O Worker；已入队的主体、访问记录和发布操作继续落盘。关闭项目时
停止生产者，再排空 I/O 队列并关闭存储。直接刷新或关闭整个网页仍可能丢失尚未落盘
的缓存，这不影响项目源文件的保存。

[ArtifactStoreConnection](../../../packages/app/src/model/artifact-store.ts)为 Core 提供
同步 `KernelArtifactStore` 查询；`set`、`delete` 和 `flush` 只提交后台操作，`flush`
表示请求处理待写数据，不是磁盘耐久性屏障。显式清理和存储关闭使用单独的排空边界。
BREP/数据编码仍在计算侧同步完成，传输使用独立字节副本，避免 detach 模型仍使用的
资源。共享原子计数记录在途及待写字节，即使计算 Worker 正在同步求值也无需等待
消息回执；这些字节归当前工作版本，不设独立容量上限、不因队列字节数反压构建。
它们计入历史 LRU 的内存压力，当前与上一工作集仍受保护；写完或存储失败后释放
临时字节。统计分别提供编码、传输、同步查询及后台写事务耗时，写事务耗时包含锁等待。

[ArtifactStoreServer](../../../packages/app/src/model/artifact-store-server.ts)按收到的操作
顺序，在短事务中批量落盘。未落盘主体保留在 I/O Worker，`get/getMany/touchMany`
可以直接使用；缺失数据才读磁盘，不把每次读取变成整个写队列的屏障。发布指针必须
在事务中检查完整引用与单调时间戳，不能把未经验证的 `publish` 当普通待写 `set`
暴露。清理等待被替换生产者的在途写入与旧队列完成，再删除对应命名空间。

内存命中的访问记录在一次求值中汇总；磁盘命中在连接中汇总，通过后台 `touchMany`
维护 LRU。访问记录独立于数据主体，不重写 BREP；淘汰或写入失败的内容从仍保留的
内存值补写。MessagePort 投递请求，SharedArrayBuffer 分块传回同步查询结果。同源
Web Lock 只覆盖日志打开、批量读写/发布及关闭，编译、执行、等待客户端接收大记录
都不持有锁。事务按工作量分批释放锁，不限制队列的累计容量。
回归见 [队列一致性](../../../packages/app/test/artifact-store-server.test.ts)与
[真实 I/O Worker](../../../packages/app/test/browser/artifact-store.test.ts)。

[snapshot-pool](../../../packages/app/src/model/snapshot-pool.ts)按几何 artifact
归并 bounds/mesh，先查缓存，再分配未命中批次。主 Worker 拥有去重、预算和缓存；
子 Worker 只保留当前批次的独立原生几何。全池共用预算，压力下减少在途任务，
不能把每个 Worker 的预算分别相加。作者源码与动态关系求解仍同步执行。

单 Worker 与并行查询使用同一二进制几何输入，避免序列化差异改变三角化或拓扑
编号。取消保留已完成结果；失败只重试未完成查询，并释放未完成的等待记录。
初始化与快照计算没有固定时限；实际失败才重试，取消后不响应的 Worker 在回收宽限期后终止。预算常量以实现为准。验证见 [kernel-cache-memory](../../../packages/core/test/kernel-cache-memory.test.ts)、
[persistent-cache](../../../packages/app/test/browser/persistent-cache.test.ts)、
[snapshot-pool](../../../packages/app/test/snapshot-pool.test.ts)。

## 网络与字体资源

[ProjectAssets](../../../packages/app/src/project/project-assets.ts) 准备静态 URL，
并按真实声明的 `@modelResource google-font` 标记解析 Google 字体请求，支持别名、
重导出及导入静态常量；动态参数在源码处诊断。Google CSS 的全部 Unicode 子集
按至多 8 路并发准备，WOFF2 解码为 SFNT 后供同步字体 API 使用，不安装网页 CSS。

[ResourceCache](../../../packages/app/src/project/resource-cache.ts) 用独立 64 MiB
历史内存 LRU 管理 HTTP 资源及内容寻址的解码结果，随后查询共享 OPFS，最后网络。
活跃构建引用不受历史上限限制；请求合并并遵守显式新鲜度、Age、no-cache/no-store，
过期通过浏览器 HTTP 缓存重验证。取消或抛错保留完整产物，丢弃未完成响应。磁盘
不可用时继续内存缓存，恢复后补写。HTTP 身份独立于几何运行时，内核升级不用重下字体。
回归见 [resource-cache](../../../packages/app/test/resource-cache.test.ts) 和
[真实缓存测试](../../../packages/app/test/browser/persistent-cache.test.ts)。

## 取消与请求隔离

项目准备、包与资源下载、快照初始化和查询、导出、草图求解及清理构建缓存不设固定
执行时限。请求等待完成、真实错误、被新版本取代或显式取消；进度阶段不再启停
执行倒计时。HTTP 资源仍传递请求所属的取消 signal，后台或慢网络不会单凭耗时
被 App 中断。独立 agent 传输、正则解析与缓存通信故障检测各自拥有原有生命周期，
不作为模型操作的运行时限。

[compiler-client](../../../packages/app/src/model/compiler-client.ts)立即拒绝已取消
请求，只保留最新排队版本，并等待旧请求收尾后派发。同步 JS/WASM 通过共享取消
标志在完整操作边界观察取消；已完成产物先保留，取消结果不发布快照。
缓存同步读取使用共享唤醒计数与读取代次：主线程取消时立即唤醒读者，I/O Worker
通过 AbortSignal 撤销旧读取尚未获得的 Web Lock。已开始的同步磁盘操作可完成，但
其响应只引用旧 mailbox；读者取消后才替换 mailbox，正常读取复用同一缓冲区。
读取在发出前及唤醒后检查所属构建的取消标志，覆盖取消早于请求入队的竞争窗口。
请求 ID 与代次隔离连续取消和迟到响应，同一个编译/执行 Worker 与存储连接仍可复用。
保存预览的恢复请求也带取消标志，避免旧恢复被取消后继续读取下一条记录。
取消读取不撤销已接收的后台写入，也不取消主动清理、排空和统计命令。后续构建若
需要磁盘中另一条记录，仍须等待其他标签页释放锁。30 秒通信故障检测与原生执行
5 秒强制回收宽限期保留，不用于等待旧缓存读取自然超时。
编译取消调用 esbuild context 的 cancel，保留 context 后处理最新版本。持续编辑
不延长执行请求的强制终止期限；无法合作退出时只重建执行 Worker，编译侧的文件、
语言及 esbuild context 保留。编译故障独立重建编译 Worker。
导出、拓扑检查和草图求解是同步原生操作；显式取消这些请求立即回收执行 Worker，
重新编译恢复可操作快照，不让已取消的求解阻塞下一版本。
项目关闭释放整个运行时；Worker 实例与请求 ID 共同限制消息及文件响应归属。

共享取消标志要求安全上下文和跨源隔离。开发、预览和生产 App 资源配置相应
COOP/COEP，外部资源仍需允许浏览器加载。具体构建和部署规则从
[Web README](../../../packages/web/README.md)与 App 配置读取。
回归见 [project-compiler](../../../packages/app/src/model/project-compiler.ts)、
[compilation-cancellation](../../../packages/app/src/model/compilation-cancellation.ts)及
[compiler-progress](../../../packages/app/test/browser/compiler-progress.test.ts)。
