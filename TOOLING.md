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
