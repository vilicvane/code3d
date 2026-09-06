# code3d 工具架构

工具的职责是把交互转换成编辑意图，而不是直接修改模型、Monaco 或 AST。

```text
selection + gesture
        ↓
       tool
        ↓
      intent
        ↓
     resolver
        ↓
 edit plan + preview
        ↓
 source transaction
        ↓
    compile model
```

## 不变量

- 源文件是模型持久化状态的唯一来源。
- preview 可以临时改变视图，但不能成为隐藏的模型状态。
- 工具不直接依赖 Monaco、OpenCascade 或 Three.js。
- 每个 source ref 都包含项目文件路径和文件内 offset；offset 不能脱离文件解释。模型完成编译后，editor 在下一版模型到达前持续追踪工具所用 source ref 的最新范围。
- 所有提交都带项目 revision 和 expected text，跨文件 edit plan 也必须原子应用。
- 无法唯一解析的意图必须提供候选方案，不能静默猜测。
- Caret 选择源码 occurrence 及其 operation role。点击当前 focus 集合中的
  occurrence 只细化 runtime instance，不改变源码 context；点击 dim 的
  operation peer 则导航到该输入的 source target，并将它切换为 focus。
  decoration 不参与拾取。

## 核心层次

### Tool

处理 pointer、keyboard 或 gizmo 输入，并产生 `ToolIntent`。同一个意图可以来自不同 UI。

### Intent

描述用户想完成什么，而不是具体文本改动。目前定义：

- `parameter.set`：修改已有上游参数。
- `expression.replace`：用结构化 Expression Draft 替换表达式。
- `relation.offset`：调整选中对象的位置关系；必要时在约束表达式上构造 `.offset()`。

### Resolver

结合 provenance、selection scope 和源码 anchor，把 intent 解析为一个或多个 edit plan。参数修改优先使用已有声明；结构修改可以插入调用、提取变量或生成局部表达式。

### Edit plan

包含：

- 工具和 intent。
- 开始交互时的源码版本。
- 可供 UI 展示的修改摘要。
- 临时 preview 描述。
- 带 expected text 的源码编辑集合。

### Source transaction

提交时再次检查项目 revision 和所有文件中的 expected text，然后按文件作为一个逻辑事务进入各自 Monaco undo stack。失败时不应用部分结果。
事务保留用户原有 caret 和由它决定的渲染 scope；工具不会为了展示写入位置而移动 selection。提交成功后，UI 使用 edit plan 的 summary 和 edits，在 GUI 一侧的独立 popover 中展示 trim、语法高亮后的局部源码，并只标记实际替换范围；只有用户点击源码块时，编辑器才定位并聚焦对应修改。

GUI 不维护第二套历史。编辑器界面没有焦点时，`Ctrl/Cmd+Z`、
`Ctrl/Cmd+Shift+Z` 和 `Ctrl/Cmd+Y` 直接作用于当前活动文件的 Monaco undo
stack，且不夺走 viewport 或面板焦点；Monaco 及其内部输入有焦点时仍由编辑器原生处理。
任何后续源码变化都会关闭已经过期的 source-update popover。

## Tool session

1. `begin` 固定工具和交互 scope；source anchor 由 editor 跨 revision 追踪。
2. `preview` 可以被连续调用，只产生临时视图。
3. `commit` 针对最新 source anchor 和 editor revision 重新解析 intent，再原子写入源码。
4. `cancel` 清除 preview，不产生源码修改。

模型重新编译后，tool session 即结束；后续工具必须基于新的 provenance 开始。
源码事务提交后，GUI 将 preview 提升为当前 revision 的 optimistic 状态。编译期间仍可继续交互；新的交互立即丢弃正在运行或等待中的旧 revision 编译，新的源码事务产生后只编译最新 revision。对应模型完成后，以原 selection 和 scope 替换 optimistic 状态。

## Completion-derived preview

Monaco 原生 completion list 中当前聚焦的普通文本候选会生成一个非持久化 project
snapshot：只在 snapshot 中应用 Monaco 已计算的主 edit 和 additional edits，并把补全
后的虚拟 caret 位置用于选择编译结果。这个 snapshot 使用正常 compiler/runtime 路径，
所以 viewport 展示的是“接受该补全后”的模型语义，而不是仅替换标签的视觉猜测。

真实 Monaco model、caret、undo history、文件系统和 source revision 始终不变。补全候选
切换时丢弃旧 speculative compile；候选关闭后恢复真实 module，并重新编译实际源码。
speculative module 只属于 viewport transient preview，不替换工具使用的已接受 module，
也不允许 viewport picking 或 source write-back。具名 element 候选在 speculative compile
完成前先复用已接受 module 显示即时高亮。

speculative compile 等待期间，viewport 边缘显示显著但不阻挡交互的 progress 状态；
候选结果就绪、失败、关闭或被新候选取代时立即移除。

## Model diagnostics

模型编译和执行错误以结构化 diagnostic 穿过 worker 边界，保留 kind、summary、
details 和可选的 `SourceRef`。最内层的源码求值边界负责为普通 runtime/kernel error
补充位置；已有精确位置的错误经过外层调用时不会被覆盖。参数校验、关系求解、Boolean
求值及 snapshot 生成因此都归属到请求该次求值的源码表达式，而不是从错误文本或编译后
stack 反推位置。

带 `SourceRef` 的 diagnostic 由 Monaco marker 直接标在源代码上，hover 使用编辑器原生
诊断界面展示详细信息；成功编译后清除。编辑期间保留上一版 marker，直到新的编译结果被
接受，避免异步编译造成错误状态闪烁。只有项目、worker、超时等无法可靠归属源码的错误
才使用全局 error bar。

## Viewport decoration

临时 3D 辅助显示使用通用的 `ViewportDecoration`。它是 renderer-neutral 的
discriminated union：`mesh` decoration 携带派生网格和 transform，`edges` 可显示
完整或按稳定 ID 过滤的边线，`surface` decoration 把网格子集附着到指定模型
occurrence，`anchor` decoration 携带模型 node、point/line/face/frame 类型和局部
frame。viewport 只把这些数据渲染为辅助几何，并按 owner 设置或清除 decoration
layer，不理解具体工具、建模操作或元素名称的语义。

与源码 scope 相关的辅助显示实现为 `SourceDecorationProvider`。provider 读取 runtime operation metadata 并返回 decoration；工具开发者可以注册新的 provider，无需修改 viewport 的选择或渲染主路径。交互中的工具则返回 `viewport-decorations` preview，由 host 按 owner 应用和清理对应 layer，工具本身仍不直接调用 viewport。

需要精确派生几何时由 kernel/runtime 产生 operation region，provider 只决定何时、
以何种 appearance 展示。当前 Boolean provider 用 `mesh` decoration 强调 `cut`
的切除体积，以及 `union` 的重叠体积或仅接触时的 B-Rep section；named-element
provider 用 `anchor` 标出元素 frame，并为 face 元素按其平面和法向选择真实 B-Rep
face group，再用 `surface` 显示实体面及其边界。fillet/chamfer provider 在结果源码
上下文中用弱化 `mesh` 保留操作前形状，并用 `edges` 强调被修改的原边。这些都不是
viewport 中的专用操作语义分支。

Provider 可通过 `previewBehavior` 声明工具预览期间的显示策略。当前 Boolean provider 使用 `hide`：参数或关系工具开始移动后隐藏旧 region，pointer move 不触发模型或 region 重算；取消时恢复已编译 region，提交后等待正常源码编译产生新的精确 region。这个策略只影响对应 provider 的 layer，不影响实体、gizmo 或其他工具 decoration。

## 当前接入的工具

`@code3d.param` 可直接放在公开的 callable 变量上，例如
`export const sleeve = definePrimitive((radius: number, y = 4) => ...)`。
tooling 从公开声明读取注释，并从 TypeScript 实际调用签名解析参数名称、顺序、
可选性和数组类型，包括泛型工厂返回的具名参数 tuple。普通别名、import/re-export
和已发布的 `.d.ts` 使用同一规则，不要求函数 wrapper 或专用 metadata 选项。
具名函数与方法的重载仍优先使用匹配签名上的注释。primitive factory 不额外提供
`@code3d.arguments` 入口；独立预览使用普通示例调用。

可选数值参数的 `@code3d.param` 可用 `default: 60` 描述省略实参时的面板
placeholder；源码与已发布 `.d.ts` 使用同一静态解析路径。默认值接受有限数值
字面量，count 必须为整数，且满足参数 constraints；静态校验与面板编辑共用数值
规则。函数参数初始化器只决定实际运行行为，不读取其默认值，也不把 annotation
注入非交互运行时；作者负责保持描述与实现一致。

默认 placeholder 仅用于源码确实省略的实参。已有实参（包括显式 undefined、
求值为 undefined 的表达式和求值失败）维持原展示。所有连续省略参数均可展示
各自默认值，但仅下一位置可以补写。参数是否省略与能否写回分别记录；展开实参
及后续位置无法静态映射时标记为 unknown，不展示默认值或提供位置编辑。聚焦、离开和未输入时提交不修改源码；主动
输入同一数值也会写成显式实参。清空仍属无效输入，Undo 或源码删除实参可恢复
省略状态，不新增恢复默认按钮。实现背景见 [#29](https://github.com/vilicvane/code3d/issues/29)。

viewport 平移 gizmo 在能够唯一追溯参数时产生 `parameter.set`，否则针对已有关系产生
`relation.offset`。源码中的 `fillet(radius)`、`fillet(radius, edgeIds)` 和对应的
`chamfer` 调用把整个参数区域投影为 edge-selection source target。`edge-operation.set`
可以写入非空的显式 ID 数组，也可以删除第二参数以恢复单参数的全部边语义；每次修改
立即进入共享源码事务，同一轮工具交互合并为一个 Monaco undo 历史项。

上下文工具面板的展示由选中的源码位置决定，不由 `Esc` 关闭；离开对应调用才结束
该面板的交互。`Esc` 优先取消尚未松手的 viewport 拖动，保留面板与代码位置；
未拖动时不结束面板的参数编辑或拓扑选择，也不撤销已经提交的源码修改。

compiler 为每个实际进入的 call site execution 统一记录完成或失败状态、单调触达顺序、
已求值的 operation inputs、实际参数和参数 provenance。source target 的同一 context 内
默认采用最近触达的一次 execution；工具只投影自己需要的已捕获上下文，不维护单独的
失败生命周期。fillet/chamfer 因而可在操作失败时使用已求值的 receiver、实际边数组和
尺寸参数继续工作；不可用于 receiver 的失效 ID 不进入 GUI 选择，下一次写回即可清除。

receiver 与参数中的模型值按实际求值自动记录，不按建模 API 名称登记。数组和选项对象
字面量保留成员各自的源码范围；变量和展开表达式也可携带模型集合。输入角色由运行时
operation 的输入记录关联，因此导入别名、namespace 调用和计算属性方法共用同一路径。
没有对应 operation 或调用失败时，已取得的输入仍可作为模型值预览；同一源码位置的多次
执行保留各自的输入，采用最近触达的值。追踪不主动读取 getter。空间手柄仍由 operation
metadata 和参数 provenance 定义轴、pivot 与编辑语义。

带工具注释的调用即使在产生模型值之前失败，也会发布独立的 tool source target。有效调用
严格采用 TypeScript 实际匹配的重载；没有重载可匹配时，优先保留 TypeScript 的带注释
恢复候选，否则按声明顺序选择第一个带注释的候选。候选恢复只接受落在当前 callee 或其
直接参数上的调用签名 diagnostic，不能因外层调用把当前表达式标成错误参数而误判。缺失
参数在面板中显示为空，当前调用末尾能够合法追加的下一个参数可以直接填写并写回源码，
后续参数随调用补全依次解锁。已有数值参数无法唯一解析出整个字面量或上游 target 时，
不论追踪到了零个、一个内联系数还是多个候选，均把运行时求值结果作为空 input 的
placeholder；填写数字会替换整个参数表达式，填写与 placeholder 相同的值也会替换。
它与尚未填写的参数保持区分。唯一可编辑的上游参数仍显示有效值并反向修改其来源。
面板参数的绑定、显示和输入 intent 集中在同一个模块；它与 gizmo 共用源码 provenance
候选规则，禁止各自根据候选数量引入不同的表达式分类。

参数 schema 是按能力扩展的 tagged union。数值 `kind` 提供标量控件；`vertex`、`edge`
和 `surface` 提供 topology selector，其单选或多选能力从声明参数是否为数组推导，而不是
再写一份交互配置。几何模型的 `.vertex(id)`、`.edge(id)` 和 `.surface(id)` 使用单选，
`.vertices(ids?)`、`.edges(ids?)` 和 `.surfaces(ids?)` 使用多选；两者共享同一个 provider。
compiler 在调用进入时记录 receiver 和已求值参数，所以参数缺失或引用已退休拓扑而失败时
仍可显示 receiver 并修复；viewport pick 产生通用 `argument.set` intent，立即写回同一个
源码事务。复数引用允许空数组，并在省略参数时返回全部当前稳定拓扑引用；fillet/chamfer
的省略参数全选语义仍由专用 provider 处理。

`shell(thickness, removedSurfaceIds?)` 复用通用 surface 多选与数值参数工具：
正厚度向内，负厚度向外；省略或空数组表示没有开口的封闭空腔。
通用选择器按运行时解析后的选择显示摘要和高亮，不把省略参数硬编码为全选。
操作 snapshot 的 selections 支持 edge 与 surface；抽壳选择指向操作输入，
视图显示操作输出，失败时仍可修改输入面与厚度。Close all openings 删除面数组，
恢复封闭空腔；全部选中面会报错，因为必须保留壳壁。见 [#37](https://github.com/vilicvane/code3d/issues/37)。

工具在已有表达式边界插入相邻参数时，不扩张该表达式的源码范围；零长度插入槽
则跟踪刚写入的文本，以便下一次工具操作直接替换。用户输入允许在词法边界扩展
范围。这样选面后立即修改厚度无需等待编译，也不会将面数组误当作数字的一部分。

数值参数的源码 provenance 与工具签名共用一个 TypeScript semantic program。调用参数中的
标识符、具体对象属性、字面量类型的计算属性和对象解构会沿唯一 symbol definition 继续
追溯，也可以穿过 import 和 re-export，直到静态数值 initializer。任一步存在多个定义、
缺少可追溯 initializer，或 receiver 的运行时对象不唯一时，该链路不产生可编辑 target。
这套索引只覆盖带工具注释的数值参数表达式；panel 与 viewport 对同一表达式都优先采用
表达式之外的上游 target，避免把比例因子等内联字面量误当成主要参数。

平移 gizmo 目前遵守以下解析规则：

- 当前源码 occurrence 必须是提供相对位置语义的 operation input，或具体的
  constraint source site；变量声明和 operation output 即使对应对象带有 relation，
  也不显示 gizmo。
- 优先修改选中对象关系约束中能够唯一追溯的位置参数。
- 参数归属到具体 API 调用；连续变换只编辑当前最外层调用，不重复追加操作。
- 同一参数表达式同时包含上游变量和字面量时，优先修改上游变量。
- 没有可用上游参数时，只有整个参数是数值字面量才直接改值；表达式内部的字面量（例如 `i * 8` 中的 `8`）不作为拖动目标。
- 参数在整个模型中的用途必须都是同一位置轴，避免 preview 遗漏尺寸等副作用。
- 没有唯一安全参数时，优先在最外层 `.offset()` 的对应参数表达式上加减增量，保留原表达式与运算优先级；连续拖动合并末尾数值增量，归零时移除增量。
- 只有最外层不是可逐轴编辑的 `.offset()`（例如尚未添加 offset 或参数为 spread）时才追加一次字面量 `.offset(dx, dy, dz)`；后续拖动复用它，不反复嵌套，也不猜测内部组件应如何移动。
- 拖动值遵守参数的 `min`、`max` 和 `step`；没有 `step` 时使用按参数 kind 推断的步长。
- preview 会更新所有使用该参数的 occurrence，并标出选中对象以外的受影响对象。
- 松手才写入源文件；`Esc` 优先清除当前拖动 preview，恢复拖动前的位置，不产生源码修改，之后松手也不提交。取消拖动不关闭上下文工具面板。

源码 context 不提供相对位置语义、对象没有位置关系或关系接收者无法稳定定位时隐藏
gizmo。后续 choice UI 可以进一步提供“调整当前关系”或“修改内部组件关系”等不同
scope 的 edit plan。

## 模型原点与旋转

`origin`、`originOffset`、`originVertex`、`originCenter` 和 `rotate` 在 operation snapshot 中记录
局部几何坐标下的原点和本次操作向量。模型 snapshot 同时提供当前原点，tooling
统一这些数据、参数 provenance 和草图快照，并从同一依赖图安装 OpenCascade 和约束求解器；
viewport 不从包围盒推断模型旋转中心。

拓扑引用同时报告约束所属模型、几何来源、源拓扑身份和几何到所属模型的变换。
值预览用来源网格和该变换高亮原拓扑；子拓扑选择在同一坐标关系下只提供所属面/边内的 ID。
计算锚点直接报告坐标系，预览无需从名字反查模型的固定具名元素。`expose` 的命名成员及嵌套成员
保留拓扑元数据，补全预览遵循同样的装配坐标语义。见 [#27](https://github.com/vilicvane/code3d/issues/27)。

`originCenter()` 取主体建立时的局部包围盒中心随模型变换后的位置，与 `.center`
使用同一锚点。无参数操作通过 operation metadata 接入原点标记和手柄，不需要虚构参数。

`originVertex` 复用 topology selection provider：拾取来自操作输入，显示操作输出及
其原点。原点坐标和偏移显示平移箭头，`rotate` 显示角度参数对应的旋转环；固定
X/Y/Z 顺序意味着 X 环包含后续 Y/Z 的方向，Y 环包含后续 Z 的方向。

`model.spatial` intent 通过通用源码事务修改唯一安全的参数，或保留当前参数表达式
并折叠末尾数值增量。拖动顶点或中心原点时生成或复用 `originOffset`。preview 保存临时
刚体变换和原点标记；旋转预览使用新旧完整旋转的差，松手写源码，Esc 清除预览。
原点偏移不会临时移动实体。已有 relation offset 工具与这些操作共用轴手柄和会话机制。

## 表达式构造

工具使用 `ExpressionDraft` 描述 number、string、identifier、array、binary、call 和 member，而不是直接提交任意字符串。例如边选择工具产生：

```text
expression.replace(
  target = source ref of [2, 5],
  expression = array([number(3), number(7)])
)
```

edge 工具在 caret 落入 fillet/chamfer 的整个参数区域时解释 viewport 点击。
主实体是当前边集合已经应用后的操作结果，操作输入的全部原边同时保留在原位置作为
独立的可选择图层；数组中的 ID 预先高亮，边以模型内稳定数字 ID 显示为 `E3`、`E7`。
每次 toggle 都立即通过共享源码事务写回普通数字数组（例如 `[3, 7]`），并后台重编译；
选中集合按 ID 排序，只有集合发生变化时才提交。取消最后一个显式选择会删除第二参数，
恢复单参数的全部边语义，不保存空数组。离开调用时结束选择；`Esc` 不关闭面板或撤销修改。

Resolver 再生成带 source anchor 的编辑计划。当前 prototype 已具备基础表达式替换；
新增 fillet/chamfer 调用仍由用户手写，不提供 GUI 插入入口。多方案 UI 尚未实现。

## 草图编辑

`sketch(entries, {constraints})` 将当前几何数据与约束分开，约束不持久化 ID；
显式输入尺寸与最终有效的 X/Y 方向锁定都在成功创建时
写成约束，与几何一起提交和撤销。提交前解除锁定则不生成方向约束，切换轴只保留
最终方向，取消草稿不写入任何内容。原有每段提交后复位、轴锁与角度互斥的规则
继续成立；普通自动吸附不因此生成约束。点线支持固定点、重合、水平/垂直、
长度/角度和点 X/Y 约束，见 [草图方案](plans/sketch-editor.md)。

`sketch.edit` 使用同一 ToolEngine 和原子源码事务。每段线创建、拖动释放或删除
是一次编辑；拖动预览不改源码，Escape 取消。没有独立 Point 创建工具，线工具
按需生成端点；点实体、点引用、拖动和删除仍保留。
成功写回后立即显示本次结果，等待重编译期间继续编辑不会重复分配 ID；
源文件变化会取消未完成手势，旧快照不得覆盖新源码。返回编辑器焦点时沿用统一
格式化与光标映射，格式化和工具编辑保持同一撤销组。
草图编辑器显示期间隐藏 viewport 的源码更新浮层，避免它盖住连续绘制的输入区；
源码侧仍正常显示工具更新。

连续线使用独立于 DOM 的绘制会话。起点输入 X、Y，下一端点输入长度和角度
（度）；显式填写的字段在成功提交时生成相应约束。空字段跟随鼠标，已输入的量
优先于吸附，非法或未完成的数值不能提交。输入文本和最后有效预览值分开保存，
不因 pointermove 或重编译覆盖正在输入的文本与光标。当前只接受数字字面量；
表达式仍在源码中编辑，不在 GUI 中求值后替换成数字。

确定线起点后，X 键锁水平、Y 键锁垂直，按另一轴直接切换，按同一键解除。
锁定是通过起点的双向轴，鼠标决定正负方向，可配合长度输入；不是固定坐标值
或仅朝正方向的射线。轴锁和显式角度互斥，最后一次操作生效：锁轴清空角度，
编辑角度解除轴锁，长度保持不变。绘制画布与数字字段均支持该快捷键，忽略
按键重复、IME 合成及 Ctrl/Meta/Alt 组合，不截获普通编辑器的输入。
提示显示 X/Y locked；Snap 关闭或 Alt 绕过吸附不会解除显式方向锁。
只吸附到符合方向和长度的点，保留端点身份；提交本段或取消绘制后解除锁定，
重编译和草图内部焦点切换不解除。X 提交为 `horizontal`、Y 提交为 `vertical`；
提交前解除则不生成方向约束。

画布和数字字段共用焦点作用域：直接键入数字进入字段，Tab / Shift+Tab 循环
本次绘制字段，Enter 确定起点或提交下一段线。提交后复用终点 ID 作为下一段
起点，清空长度/角度输入；每段单独撤销。Escape 结束当前连线并丢弃未提交的
预览，保留已完成段，再次 Escape 退出工具。切换工具、离开草图或窗口失焦
取消草稿，进入草图内的输入框不会取消。
字段中的撤销/重做使用原生文本历史；画布中的撤销/重做仍交给源码历史。
绘制与求解预览按实体 ID 复用 SVG 节点，状态文字就地更新，不在每次输入中替换
文字或重写不可见的 placeholder。Chrome 在页面其他文字变更（如 Monaco 异步
着色）时仍可能划分新的原生撤销组；不以自建文本历史替代浏览器分组。

吸附结果携带点身份或临时坐标及原因，命中阈值采用屏幕像素。支持点、原点、
网格以及线段的水平/垂直方向；Snap 按钮开关，Alt 临时绕过。数字约束与目标
不兼容时不吸附，更不捏造端点引用。水平/垂直和网格只辅助本次创建，不持久化
为约束。网格使用 1/2/5 自适应细分，小格在各缩放级别约为 8–20 屏幕像素，
每五格加深主网格；吸附与显示使用同一间距。方向吸附也可将自由轴对齐到网格。
拖动也可吸附到位置，但不改变点的所属层或将其暗中合并成另一点。

运行时 snapshot 分层保留实体 ID 和点的所属层。编译器只为真实传入的内联数组
及其选项记录可编辑 sourceRef；编程生成的数组仍可显示。Resolver 只接受显式 tuple 和
数字 ID，移动只替换数字坐标，不覆盖表达式；其他 tuple 和注释保持原文。
删除本层点同时移除连接它的本层线及受影响约束，不改变只读上游，也不改写下游源码引用。

运行时与拖动共用数值求解入口；零约束直接计算，不等待 Worker 中的重新编译。
有约束时鼠标是软目标；无上游锁定、fixed 或完整 X/Y 定位点时，临时固定第一个
非拖动点。该锚点不写入源码，也不改变 snapshot 表示的持久自由度。普通运行时
不自动固定点。拖拽时 AST 按坐标判断可编辑性，表达式轴临时锁在本次源码的求值，
而不是已经移动过的显示解；例如 `[width, 0]` 锁 X、可拖 Y。锁覆盖所有本层点，
预览、UI 与源码事务共用逐坐标掩码，数值求解器不接触 AST。表达式锁改变显示几何
时先满足这些锁与原有约束，再选临时锚点，避免旧锚点与新锁矛盾。永久约束不放宽。
连续请求以上一帧为起点，鼠标移动合并请求，松手等待最后一次求解。可回写点
保存求解后的绝对坐标（含原始数据与显示位置不同的锚点），不向旧初值叠加位移；
未移动时不规范化作者数据。预览对即将写入的舍入后数据执行与编译相同的正向求解。
表达式源码完全保留，只回写同一点中可编辑的轴。初始数据不满足约束且普通求解
已移动表达式轴时，首次施加作者值锁可能调整显示位置；这与松手后的重放一致性
不同。验收与剩余问题见 #23。取消、源码变更或切换草图使旧响应失效。
冲突与失败不应用坐标。每次原生求解独立检查全部硬约束残差并释放对象；
冲突的临时约束索引映射回源码 tuple，冗余索引和自由度保留在 snapshot 中。

派生点引用使用词法作用域内已确认值身份的具名草图，例如 `base.point(2)`。
当前 receiver 名可由实际运行值确认；重赋值、遮蔽或多次执行使其他 binding
身份不明确时，不猜测引用。不存在安全名字的上游仍可显示，但不能作为新线的
引用端点；不为匿名上游增加相对层级语法或自动改写变量声明。

## Scope 与歧义

工具必须把以下信息作为解析上下文，而不是自行决定：

- 当前选中的是模型、occurrence、组件、face、edge 还是 operation。
- 一个参数会影响哪些 occurrence。
- 修改已有共享参数，还是为当前 occurrence 构造新表达式。
- 当前 topology 是否还能稳定映射到产生它的源码。

例如拖动由 `x * postOffset` 定位的单个支柱时，resolver 可以提供：

- 修改 `postOffset`，影响两个支柱。
- 为当前 occurrence 构造局部表达式。

第一种可以直接 preview；第二种属于结构编辑，应在提交前展示将要生成的源码。

对于没有自身位置关系的布尔结果，工具不会猜测应修改哪个输入实体，也不会为结果发明绝对位置；
只有用户选定具体关系 scope 后才生成对应的 edit plan。
