# 公开 API 边界与审阅记录

用途：记录已确认的 API 设计、实现背景及推理。剩余讨论与进度统一跟踪在
[GitHub #5](https://github.com/vilicvane/code3d/issues/5)；不在本文维护另一份待办清单。

## 2026-09-06 包入口复核

以 `92a62af` 为基线接管旧审计。旧稿中的 root 白名单、隐藏运行时类、tooling
函数入口及 Model 能力分层，已经分别由 `27c7840`、`167cf7a` 等后续改动覆盖；
`87d2dd4` 又加入了 primitive builder、tube 和 coil。旧稿不能作为当前实现的补丁
重新应用。

接管时的包边界如下；这是 `92a62af` 的历史快照，后续已确认结论见下文。

| 入口                    | 当前职责与边界                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@code3d/core`          | 21 个作者建模函数及按能力组合的模型类型；不导出 `ModelObject`、`ModelKind` 等运行时命名类型或 Replicad 类型。拓扑引用的 `kind` / `id` 已公开。          |
| `@code3d/core/replicad` | `definePrimitive`、去掉 `getOC` / `setOC` 的 `replicad` 值及 Replicad 类型。                                                                            |
| `@code3d/core/tooling`  | App 协议、模型检查与快照、关联对象、资源生命周期，以及内核和约束求解器安装。                                                                            |
| `@code3d/solver`        | core 使用的求解后端，导出初始化器、问题与解的声明及 `./wasm` 资源。                                                                                     |
| `@code3d/screws`        | 唯一顶层值为 `ISO4762`；namespace 中还有 `specifications`、`screw`、`clearanceHole`、`resolveSpecification` 和 `threadLength`。螺纹实现没有公开子路径。 |

tooling 的 `retainModelGeometry` / `ModelGeometrySnapshot` 为模型导出保留独立的
B-Rep 快照，供 `project-compiler.ts` 和 `model-export.ts` 消费。这里的内核 shape
有实际调用方及资源所有权约定；不能将作者 root 不公开内核类型的规则直接套用到
整个 tooling，也不能据此恢复作者模型的内部字段。已确认保留当前职责分工，接口
粒度随具体需求调整，不再将 tooling 精简列为待决定事项。
`ISO4762.resolveSpecification` 和 `ISO4762.threadLength` 已确认保持公开，作为
正式的规格与名义螺纹长度查询 API，查询语义见 screws README 和官网参考。

### 内部集成与几何资源所有权

core 提供模型检查、源码关联、渲染快照和独立持有的原生几何；App 负责导出对象的
装配变换、格式和文件生成。App 使用项目选定 core 的 tooling 和同一运行时中的
Replicad 操作这些几何。当前接口已有真实调用方，不预先将它们合并成更粗的导出接口。

- 作者模型可能被模块缓存或继续复用。App 只丢弃自己的引用，不强制释放作者模型；
  无引用的 Replicad wrapper 由 finalizer 回收，显式释放限于掌握完整生命周期的调用方。
- `ModelSnapshotObject` 保存网格、颜色、变换等可序列化的 JS 数据，不持有原生 shape。
- `retainModelGeometry()` 按源 shape 去重并 clone，为编译器 Worker 独立持有
  `ModelGeometrySnapshot`。快照中的 shape 仅供借用，调用方不能直接消费或释放它们。
  下一次编译开始时释放旧快照；切换运行时或销毁编译器时也释放。保留过程中失败会清理
  已创建的副本。
- 每次文件导出先 clone 快照中的 shape，再进行变换及格式转换。导出成功或失败都释放
  临时资源；会消费输入 wrapper 的操作接管相应临时对象，避免重复释放。

以上生命周期已由现有模型导出回归覆盖：重复导出不消费保留几何，重新编译清理旧快照，
释放导出快照不破坏仍存活的作者模型。该边界已确认，不再作为活跃设计疑问；后续变更
由具体功能或已复现问题驱动。

公开 API 的运行时与类型测试改用包名导入，以实际 `exports` 解析结果为准。
约束与 primitive 回归也通过 Node 包入口运行，覆盖内核与 solver 的自动初始化。
测试继续检查作者能力的正反向类型，并验证私有构建路径无法通过包名导入、Node
初始化保留 browser 模块的同一组作者导出。直接读取生成声明只用于检查声明内容，
不代替消费者解析。

### 属性的实际公开范围

本轮用包名解析后的 TypeScript 类型逐项枚举属性，并通过 Node 包入口检查实际对象。
基线 main 仍为 `92a62af`。必须区分模型元数据、几何属性、拓扑引用和 tooling 数据，
不能将“新增属性有用例再公开”写成“现有属性一概没有公开”。

| 对象                                                     | 当前作者声明中的数据属性                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 通用 `Model`、未 expose 成员的 `GroupModel`              | 没有字符串命名的数据属性；共同能力为 `on/relate/expose/paint`。                     |
| `SolidModel`（如 box）                                   | `center/top/bottom/axis`。                                                          |
| `FaceModel`（如 circle）                                 | `center/plane`。                                                                    |
| `EdgeModel`（如 line）                                   | `center/start/midpoint/end`。                                                       |
| `VertexModel`（如 point）                                | `center`。                                                                          |
| `Vertex`、`Edge`、`Surface` 拓扑引用                     | readonly `kind` 和 `id`，用于区分拓扑维度及引用模型内的稳定 ID。                    |
| 普通 `Anchor`、`PointAnchor`、`LineAnchor`、`FaceAnchor` | 没有字符串命名的数据属性，公开 `on()`；类型品牌的 symbol 未导出，也不是运行时字段。 |
| `Constraint`                                             | 没有公开数据属性，公开 `offset()` 与 `flip()`。                                     |
| `expose()` 的结果                                        | 在原有模型能力上增加作者命名的锚点成员。                                            |

因此 `box(...).edge(1).kind` 正式公开，但 `box(...).kind` 不在作者声明中。
`TopologyKind` 未从 root 导出这一事实，也不意味着拓扑引用的 `kind` 属性不可读。
`Model` 或 `GroupModel` 带显式的具名成员类型时，同样会公开这些成员。

运行时对象目前仍有更多可读字段：模型实例上的 `kind/name/color/children`、
`nodeId/geometry/operation`，普通锚点上的 `reference/elementKind`，拓扑引用上的
`model/transform/elementKind`，以及约束的内部存储。`@internal` 和 TypeScript
`private` 不会将这些字段从 JavaScript 对象上删除；当前边界是作者声明的约束，
没有做对象级隔离。不能把“类型未公开”表述为“运行时读不到”。

`@code3d/core/tooling` 则有意公开 `ModelSnapshotObject` 的
`kind/name/color/children` 等快照数据，`modelObjectRuntimeInfo()` 提供
`nodeId/name/sourceRefs`，元素和拓扑引用提取函数提供所属模型、名称或 ID。这些
入口服务于 App 的渲染、源码关联和资源管理，与作者 root 的属性边界不同。

screws 也已有具体用途的公开属性：`ISO4762.specifications` 及其规格数据、螺丝的
`headTop/headBottom/shankTop/shankBottom/shankAxis`、孔的
`shaftTop/shaftBottom/shaftAxis`，以及沉孔的 `counterboreTop/counterboreBottom`。
`LoftOptions`、螺丝选项和 solver 的问题/解属于输入输出数据结构，不属于待开放的
模型实例元数据。Replicad 互操作对象按其既定入口提供已有能力。

另已只读核对尚未合并的 [#27](https://github.com/vilicvane/code3d/issues/27) worktree：
该实现为拓扑引用增加 `center`，为 `Edge` 增加 `start/midpoint/end`，新增带
`kind: 'solid'` 的 `Solid` 引用，并让 expose 保留几何及命名成员。它仍没有将
模型实例的 `kind/name/color/children` 加入作者类型。这些改动已有链式拓扑查询和
装配用例，不能重新归为没有用例的候选属性；其集成状态由 #27 跟踪。

## 已确认

- 公开包采用显式白名单；不确定的 API 默认不公开。core 可以提供常用、定义
  清楚的便捷几何原语，不因可组合实现或 UI 入口数量的顾虑刻意排除。
- 坐标系保持 Y-up。primitive 尺寸参数按轴命名为 `x`、`y`、`z`；
  需要消歧义时使用 `sizeX` 等名称。
- `@code3d/core` root 只面向作者建模；App 能力放在
  `@code3d/core/tooling`。
- 入口定位以后续 [#30](https://github.com/vilicvane/code3d/issues/30) 的确认方案为准：
  保留 `@code3d/core/tooling`，取消改名 internal，移除协议版本常量与检查。
  App 仍从项目选定 core 加载同一运行时实例的内部集成接口；原型阶段随 App 一起演进。
  产品称呼统一为 App。该项已合并并推送 main。
- core root 不导出 `ModelObject` 类值或类型；`Constraint` 仅作 type-only
  export。模型实例的 runtime identity、trace、snapshot、资源释放及 `kind`
  元数据已从作者类型收起；拓扑引用的 `kind/id` 仍正式公开。
- 公开 API 涉及的类型一并导出，包括泛型约束、返回类型及递归命名依赖；模型类型
  由 root 提供，Replicad builder 类型由 `./replicad` 提供。`Quaternion` 当前只涉及
  tooling 变换签名，已由 tooling 导出。类型导出规则及补齐实现由
  [#34](https://github.com/vilicvane/code3d/issues/34) 跟踪，不再作为待决定事项。
- 未使用的 `withChildren` 已确认删除，不预留或公开子项替换接口；实施由
  [#32](https://github.com/vilicvane/code3d/issues/32) 跟踪。
- `ISO4762.resolveSpecification(input)` 保持公开：规格名解析为规格表条目，自定义
  `Specification` 对象原样返回。`ISO4762.threadLength(spec, length)` 同样保持公开，
  返回构建器使用的名义螺纹长度；实际螺纹仍由 `screw()` 按可用杆长裁剪。
- 模型实例的 `kind`、`name`、`color`、`children` 等新增作者可读元数据按具体
  用例决定是否公开。现有几何锚点、拓扑引用和库定义的具名成员已有用途并保持公开；
  没有用例的候选属性不预先暴露，也不列为当前待办。
- package entries 为 `.`、`./tooling` 与 `./replicad`。
- `definePrimitive(build)` 位于 `@code3d/core/replicad`，同步 builder 直接
  返回 Replicad shape，由 core 接管并转成 `SolidModel`；中间资源由 builder
  管理。没有定义选项、显式 adopt 或隐式 scope。
- Replicad 已经暴露底层接口，code3d 按具体需求使用现有能力，不预先设计另一套
  低层入口。用户另行安装 Replicad 的接入暂不实现，也不列入当前待办；未来遇到
  实际用例再评估。2026-09-06 用户重申此结论，旧稿中的互操作讨论据此收口。
- `helicalThread` 从 core root 收起，作为 screws 私有原语消费上述入口。
- core 提供 `tube(outerRadius, innerRadius, y)`：同轴、等截面、两端贯通，
  沿 Y 轴且居中，与 `cylinder` 一致。尺寸均为有限正数，内半径小于外半径。
  不提供壁厚重载、锥管或路径管选项；实心圆柱使用 `cylinder`。
- core 提供 `coil(coilRadius, wireRadius, pitch, turns)`：圆截面、固定螺距、
  右手螺旋、沿 Y 轴，圈数允许正小数。半径量到线材中心线，中心线高度区间
  关于原点对称；端部截面会超出该区间。部分圈的 axis 仍在 Y 轴上。
  不将弹簧端部处理、力学参数或标准规格带入 core。
- `primitives.ts` 直接消费 `tube` / `coil`，只放一个 coil；不保留单独的
  `coils.ts` 或示例内同质的 `helicalSpring` 定义。
  同时必须保留独立、可运行的 `custom-primitives.ts`：用带 D 形轴孔的扭纹
  旋钮展示 `definePrimitive`、Replicad 和直接参数注释。screws 的私有
  `helicalThread` 不能代替面向用户的自定义示例；也不为保留示例人为缩小 core。
- 调研依据：[FreeCAD BasicShapes](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/Part/BasicShapes/Shapes.py)
  与 [Rhino Tube](https://docs.mcneel.com/rhino/8/help/en-us/commands/tube.htm)
  均直接提供基础直圆管；[Fusion](https://help.autodesk.com/cloudhelp/ENU/Fusion-Model/files/SLD-CREATE-SOLID-PRIMITIVE.htm)
  把 Coil 列为实体原语。可由其他原语组合不构成排除依据。
- `@code3d.param` 直接标注公开函数变量，支持调用点 panel 和包声明文件；
  不为 primitive factory 扩展 `@code3d.arguments`。
- 参数默认值展示的设计边界已确认：面板需要的默认值信息写在 `@code3d.param`
  中，使源码和已发布 `.d.ts` 使用同一规则；`twist = 60` 等参数初始化器仍属于
  函数实现。annotation 只描述交互元数据，不注入非交互运行时，也不改变省略实参
  时的运行语义；作者负责使静态描述与实现保持一致。默认值字段及面板展示已由
  [#29](https://github.com/vilicvane/code3d/issues/29) 实现并合并到 main。
- 公共 API 的职责或签名发生设计调整时，先明确说明改动、需求依据和代价。

## 审阅结论

本轮提出的 API 设计问题已全部确认，结论保留在本文。类型导出、group paint、
withChildren、内部资源生命周期和 screws 查询接口不再列为待决定事项，也不预留
没有具体需求的更多拓扑维度条目。审计交付及关联实现的进度统一由
[#5](https://github.com/vilicvane/code3d/issues/5) 和关联 issue 跟踪。

## 已修复：Model 能力分层

状态：已按确认的设计实现并验证。

修复前 `Model<Elements, Kind>` 是 `ModelObject<Elements, Kind> & Elements`，而
拓扑选择、缩放和 solid modifier 全部声明在共同的 `ModelObject` class 上。因此
`group([]).vertex(1)`、`group([]).scaled(2)`、`group([]).fillet(1)` 等无效调用仍可能
通过 TypeScript；运行时才因 group 没有 geometry 而失败。隐藏作者可见的 `kind` 后，
现有 `this: ModelObject<..., 'solid'>` 也不足以可靠地区分 group 与 solid。

目标：公开作者类型按能力组合，统一的 runtime `ModelObject` 可以继续作为内部实现，
但不能决定作者能看到的全部方法，也不能要求重新公开 `kind`。

- 所有 Model：relation/anchor 和具名元素能力，例如 `on`、`relate`、`expose`。
- `GroupModel`：不提供几何拓扑、`scaled`、`fillet` 或 `chamfer`。
- `VertexModel`：提供 vertex 拓扑选择和通用几何能力。
- `EdgeModel`：在 VertexModel 能力基础上提供 edge 拓扑选择。
- `FaceModel`：在 EdgeModel 能力基础上提供 surface 拓扑选择。
- `SolidModel`：具有全部拓扑选择，并额外提供 `fillet`、`chamfer`。
- group 的 `paint` 语义已由 [#31](https://github.com/vilicvane/code3d/issues/31)
  确认为递归覆盖子树颜色，并已合并到 main。

实现约束：

- 为 group 提供明确的作者类型；`group()` 和其 children 参数的公开声明不得泄漏
  `ModelObject`。
- 保持 `Model` 作为通用作者类型的用途，但不要用一个携带全部方法的 class type 表示它。
- root 继续不导出 `ModelObject`、runtime kind/state 或 kernel 类型；tooling 可继续使用
  concrete runtime 类型。
- 不保留仅靠运行时抛错或无效 `this` 参数形成的伪约束。
- 不改变当前运行时几何、关系、拓扑 ID 或 snapshot 行为。

验收：

- [x] 正向类型测试覆盖每层允许的方法。
- [x] 负向 `@ts-expect-error` 至少覆盖 group 的 `vertex/scaled/fillet`、VertexModel 的
      `edge/surface`、EdgeModel 的 `surface`、FaceModel 的 `fillet/chamfer`。
- [x] 检查生成的 root `.d.ts`，确认上述能力边界清晰且不出现 `ModelObject`。
- [x] core tests、全 packages build、app build 均通过。

实现补充：

- 公共能力由独立 capability interfaces 组合，`ModelObject` 仅保留为 runtime/tooling
  实现；`Model` 是只含共同能力的作者类型。
- `relate`、`expose`、`paint`、`scaled` 和 solid modifiers 会同时保留具体能力层与
  具名元素类型。
- topology、scale、fillet/chamfer 的 `@code3d.param` 注释放在公共能力签名上，App
  继续能从作者实际解析到的 method signature 生成 panel。
- `paint` 属于共同能力。group 保存覆盖色，生成子树快照时递归传递；外层显式
  覆盖色优先，预览与导出使用同一结果。只创建当前 group 的新值，内部模型、关系和
  expose 引用保持原身份，其他装配中的共享对象不受影响。

## 当前状态

- core root 第一版白名单已集成。
- Model 能力分层已实现并通过 core、packages、app 的类型与构建验证。
- `definePrimitive(build)` 已按确认的单函数签名实现，螺纹和 examples 已迁移。
  builder 每次调用执行，core 按实际返回的 B-Rep 内容复用几何身份及后续缓存，
  每个模型独立持有可释放的几何，采用统一网格精度。工具参数注释保留在 callable
  声明上；变量本身不再读取旧 annotation 元数据。
- 已修复 `87d2dd4` 引入的螺丝重复编译缓存回退：screws 私下以有界缓存保存
  确定性螺纹 B-Rep 数据，每次读入当前内核；不缓存可被编译器释放的模型对象。
  `definePrimitive(build)` 签名、所有公开导出与 builder 的闭包可观察语义不变。
- `tube` / `coil` 已加入 core 白名单和 `examples/primitives.ts`；coil 仅保留
  一个实例，已移除独立的螺旋弹簧示例入口。
- `examples/custom-primitives.ts` 独立展示 `twistKnob` 的定义、默认参数和普通
  调用预览，不依赖 `@code3d.arguments` 或外层包装。
- 管状实体回归同时修复曲面锚点：不再将可能离开曲面的面积质心投影求法线；
  位置保留质心，法线取曲面 UV 参数域中点。原有圆柱、球体一并覆盖。
