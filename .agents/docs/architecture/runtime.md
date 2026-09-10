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

内置示例是独立的托管目录，更新和重置不能覆盖作者的其他文件。切换本地目录与
Browser storage 以当前页面的项目连接为单位；目录权限失效需重新连接，外部编辑
通过重新加载和依赖版本检查反映。文件清单、当前文档、未保存 overlay 与运行时
各自拥有状态，不把切换文件视作重新创建整个项目。

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

[Project language](../../../packages/app/src/project/project-language.ts)按导入闭包读取
真实声明、源码映射及源文件，不生成另一套作者 API 声明。语言准备不初始化内核。
编辑器的默认基础库是 ECMAScript，不能把宿主项目的 Node/DOM 类型自动注入作者
环境；项目明确导入的依赖按真实声明解析。原生 TypeScript 的可擦除语法、NodeNext
模块解析及显式源码扩展名共同约束直接 Node 执行与 App 的一致性。
跨编译保留未变文件、SourceFile、Program 和导航映射；普通编辑增量更新输入。
新增导入扩展闭包，移除导入时撤下仅由它触达的语言库，再次导入可复用已读内容。

`Preparing project` 对应实际的初次或依赖准备，不是每次编辑必经的可见步骤。
Worker 批量检查已经触达的路径，整批成功后再应用失效；取消前仍完成失效收尾，
读取失败不缓存成“文件不存在”。Browser storage 安装树使用清单、锁和安装标记
版本复用未变的只读元数据；普通文件和本地目录仍检查真实变化。

[ProjectBuilder](../../../packages/app/src/project/project-builder.ts)使用 esbuild-wasm
链接模块，源码分析和仪器化是独立的前置变换。只追踪项目中的模型相关源码，
不把全部第三方依赖当作者模型代码改写。TypeScript、CommonJS interop 和循环模块
由构建层处理。静态字符串 dynamic import 保持按需执行；计算出的 specifier 明确
诊断。资源使用静态 `new URL(literal, import.meta.url)`。

编译诊断保留原文件与 UTF-16 源码范围，不能把打包器的字节位置直接当编辑器 offset。
语言与构建回归见 [project-language](../../../packages/app/test/project-language.test.ts)、
[project-builder](../../../packages/app/test/project-builder.test.ts)、
[project-diagnostics](../../../packages/app/test/project-diagnostics.test.ts)。

## 执行与生命周期

[ProjectRuntime](../../../packages/app/src/model/project-runtime.ts)从有效包环境创建
项目运行时，并通过所选 Core 的 tooling 安装 OpenCascade 与 PlaneGCS。
Node 的 Core 入口自行完成对应初始化。项目清单或依赖变化使运行时失效；普通
源码版本使用新的求值上下文，继续复用依赖实例和内核。

[ModuleEvaluator](../../../packages/app/src/model/module-evaluator.ts)执行原生 ESM
生成的函数。依赖模块 namespace 与源码执行范围分离，避免旧模块 exports 持有
每次求值的模型。缓存的依赖通过 ESM facade 保留 default export 和 live binding；
内部载体使用正确扩展名，不能把 CommonJS 放在原来的 `.mjs` 路径下。

依赖图准备只在预留待执行模块时串行，模块执行在锁外进行；每个完成的 namespace
立即发布给等待它的导入。这样保留并发 dynamic import 和顶层 await 的共享身份。
失败图释放等待者，运行时记住对应错误，其他独立导入仍可继续。

每次求值用 `beginModelEvaluation` 建立上下文，在快照之后通过 `finally` 收尾。
trace、provenance 和源码位置属于本次求值；缓存几何或依赖模型不携带上次源码
偏移。完成快照与下一次求值独立，导出请求绑定已完成的 compile revision。

生成的执行函数按内容去重，但浏览器原生 ESM 记录会保留到 Worker 结束；回收 Blob
URL 不等于卸载模块。不能承诺无限多不同源码版本下 JavaScript 内存零增长。
原生模型所有权见[建模内核](modeling.md#互操作与资源所有权)。回归见
[project-runtime](../../../packages/app/test/project-runtime.test.ts)、
[cached-module-exports](../../../packages/app/test/cached-module-exports.test.ts)和
[module-evaluator](../../../packages/app/test/module-evaluator.test.ts)。

## 几何缓存、持久化与并行快照

[kernel-cache](../../../packages/core/src/library/kernel-cache.ts)以完整计算及真实几何
内容为边界，查询 bounds 和 mesh 也可复用。当前工作集完整保留，历史按内存 LRU
预算淘汰；预算包括已分配原生块与估算 JS 数据，不是 WASM buffer 大小或进程总
内存硬上限。正常完成、抛错和合作取消采用同一收尾边界。

[persistent-artifacts](../../../packages/app/src/model/persistent-artifacts.ts)与
[artifact-journal](../../../packages/app/src/model/artifact-journal.ts)把纯几何结果
保存到 OPFS。命名空间来自实际运行时代码和 WASM 的内容身份，不使用临时 Blob URL。
日志带签名及校验，整理副本在完整写入后发布；损坏、配额不足或存储不可用时继续
内存模式。索引按需读取记录，不预载全部历史几何。

同源 Web Lock 覆盖持久日志打开、编译和关闭；等待可取消，空闲 Worker 不持锁。
当前不同编译 Worker 对同一持久日志串行取得所有权，一次编译内部可并行查询。

[snapshot-pool](../../../packages/app/src/model/snapshot-pool.ts)按几何 artifact
归并 bounds/mesh，先查缓存，再分配未命中批次。主 Worker 拥有去重、预算和缓存；
子 Worker 只保留当前批次的独立原生几何。全池共用预算，压力下减少在途任务，
不能把每个 Worker 的预算分别相加。作者源码与动态关系求解仍同步执行。

单 Worker 与并行查询使用同一二进制几何输入，避免序列化差异改变三角化或拓扑
编号。取消保留已完成结果；失败只重试未完成查询，并释放未完成的等待记录。
预算和超时常量以实现为准。验证见 [kernel-cache-memory](../../../packages/core/test/kernel-cache-memory.test.ts)、
[persistent-cache](../../../packages/app/test/browser/persistent-cache.test.ts)、
[snapshot-pool](../../../packages/app/test/snapshot-pool.test.ts)。

## 取消与请求隔离

[compiler-client](../../../packages/app/src/model/compiler-client.ts)立即拒绝已取消
请求，只保留最新排队版本，并等待旧请求收尾后派发。同步 JS/WASM 通过共享取消
标志在完整操作边界观察取消；已完成产物先保留，取消结果不发布快照。
持续编辑不延长当前请求的强制终止期限，无法合作退出时终止并重建 Worker。
项目关闭释放整个运行时；Worker 实例与请求 ID 共同限制消息及文件响应归属。

共享取消标志要求安全上下文和跨源隔离。开发、预览和生产 App 资源配置相应
COOP/COEP，外部资源仍需允许浏览器加载。具体构建和部署规则从
[Web README](../../../packages/web/README.md)与 App 配置读取。
回归见 [project-compiler](../../../packages/app/src/model/project-compiler.ts)、
[compilation-cancellation](../../../packages/app/src/model/compilation-cancellation.ts)及
[compiler-progress](../../../packages/app/test/browser/compiler-progress.test.ts)。
