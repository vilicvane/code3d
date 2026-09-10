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
工具参数、字体与草图源码分析共用语言加载器拥有的 Program，不重新解析整套声明。
新增导入扩展闭包，移除导入时撤下仅由它触达的语言库，再次导入可复用已读内容。

`Preparing project` 对应实际的初次或依赖准备，不是每次编辑必经的可见步骤。

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
取消保留已经写完的历史内容，不发布该次构建。`successful` 单独记录最近成功执行
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

生成的执行函数按内容去重，但浏览器原生 ESM 记录会保留到 Worker 结束；回收 Blob
URL 不等于卸载模块。不能承诺无限多不同源码版本下 JavaScript 内存零增长。
原生模型所有权见[建模内核](modeling.md#互操作与资源所有权)。回归见
[project-runtime](../../../packages/app/test/project-runtime.test.ts)、
[cached-module-exports](../../../packages/app/test/cached-module-exports.test.ts)和
[module-evaluator](../../../packages/app/test/module-evaluator.test.ts)。

## 计算缓存、持久化与并行快照

[CachedDefinitionCompiler](../../../packages/app/src/project/cached-definitions.ts)
在追踪与转译前为静态函数、其引用的本地声明、导入实现图和 codec 生成内容指纹，
支持 alias、namespace、re-export 和 CommonJS require。无关本地变量、源码位置
及 export 变更不失效，引用的 helper/依赖变更失效。函数身份通过求值上下文注册，
不改变原模块格式，每次定义绑定独立 callable，避免同一作者函数的不同 codec 串用。
Core 自身沿用整体运行时身份，不重复分析其所有缓存定义。

动态工厂结果、函数参数和捕获外层函数/循环绑定的闭包使用函数对象身份，仅在内存
复用；普通 Node 调用亦如此。作者无需 id/version，动态状态必须显式传参。默认
数据 codec 保留精确标量、循环/共享数据图、稀疏数组和共享二进制视图；自定义结果
类型成对提供 encoder/decoder。缓存同步完成值，异步计算不能进入。内存命中直接
复用保留值，不重新解码；资源所有权见[建模内核](modeling.md#互操作与资源所有权)。
回归见 [cached-definitions](../../../packages/app/test/cached-definitions.test.ts)
和 [cached](../../../packages/core/test/cached.test.ts)。

[kernel-cache](../../../packages/core/src/library/kernel-cache.ts)以完整计算及真实几何
内容为边界，查询 bounds 和 mesh 也可复用。几何值已保存紧致局部包围盒；方向
查询只交换或反转坐标轴时直接推导，不再为六个方向各建查询记录。任意角度旋转
及有限拓扑仍查询真实几何，不能以旋转原包围盒代替。已知的快照查询通过 `getMany`
批量恢复，只有未命中部分进入计算。当前工作集完整保留，历史按内存 LRU
预算淘汰，默认 2 GiB 软预算；预算包括已分配原生块与估算 JS 数据，不是 WASM buffer 大小或进程总
内存硬上限。正常完成、抛错和合作取消采用同一收尾边界。

[persistent-artifacts](../../../packages/app/src/model/persistent-artifacts.ts)与
[artifact-journal](../../../packages/app/src/model/artifact-journal.ts)把可持久化计算结果
保存到 OPFS。构建产物、几何与 HTTP 资源共享 min(1 GiB, origin 配额的 10%) 磁盘预算，含整理空间。命名空间来自实际运行时代码和 WASM 的内容身份，不使用临时 Blob URL。
日志带签名及校验，整理副本在完整写入后发布；损坏、配额不足或存储不可用时继续
内存模式。索引按需读取记录，不预载全部历史几何。

[ArtifactStoreConnection](../../../packages/app/src/model/artifact-store.ts)通过专用 I/O
Worker 复用同步 `KernelArtifactStore`。内存命中的访问记录先在本次求值中汇总，
磁盘读取也只读取主体并在连接内收集访问顺序；下次写入、结束或取消的 flush 通过
`touchMany` 在一个短事务中维护 LRU，避免每读一条缓存就写一次日志。淘汰导致缺失的记录从仍保留
的内存值补写。访问记录独立于数据主体，更新顺序无需重写 BREP；新计算的主体及时保存。MessagePort 投递请求，SharedArrayBuffer
分块传回字节；先连接端口再进行同步等待，避免嵌套 Worker 的消息投递依赖被阻塞
的创建者。同源 Web Lock 只覆盖日志打开、单次读写/发布和关闭，模型编译、执行和
等待其他 Worker 都不持有存储锁。大记录分块发送时也已释放锁。

[snapshot-pool](../../../packages/app/src/model/snapshot-pool.ts)按几何 artifact
归并 bounds/mesh，先查缓存，再分配未命中批次。主 Worker 拥有去重、预算和缓存；
子 Worker 只保留当前批次的独立原生几何。全池共用预算，压力下减少在途任务，
不能把每个 Worker 的预算分别相加。作者源码与动态关系求解仍同步执行。

单 Worker 与并行查询使用同一二进制几何输入，避免序列化差异改变三角化或拓扑
编号。取消保留已完成结果；失败只重试未完成查询，并释放未完成的等待记录。
预算和超时常量以实现为准。验证见 [kernel-cache-memory](../../../packages/core/test/kernel-cache-memory.test.ts)、
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

[compiler-client](../../../packages/app/src/model/compiler-client.ts)立即拒绝已取消
请求，只保留最新排队版本，并等待旧请求收尾后派发。同步 JS/WASM 通过共享取消
标志在完整操作边界观察取消；已完成产物先保留，取消结果不发布快照。
编译取消调用 esbuild context 的 cancel，保留 context 后处理最新版本。持续编辑
不延长执行请求的强制终止期限；无法合作退出时只重建执行 Worker，编译侧的文件、
语言及 esbuild context 保留。编译故障独立重建编译 Worker。
项目关闭释放整个运行时；Worker 实例与请求 ID 共同限制消息及文件响应归属。

共享取消标志要求安全上下文和跨源隔离。开发、预览和生产 App 资源配置相应
COOP/COEP，外部资源仍需允许浏览器加载。具体构建和部署规则从
[Web README](../../../packages/web/README.md)与 App 配置读取。
回归见 [project-compiler](../../../packages/app/src/model/project-compiler.ts)、
[compilation-cancellation](../../../packages/app/src/model/compilation-cancellation.ts)及
[compiler-progress](../../../packages/app/test/browser/compiler-progress.test.ts)。
