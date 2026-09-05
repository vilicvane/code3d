# 公开 API 审阅待办

用途：记录已确认的 API 设计、实现背景及推理。剩余讨论与进度统一跟踪在
[GitHub #5](https://github.com/vilicvane/code3d/issues/5)；不在本文维护另一份待办清单。

## 已确认

- 公开包采用显式白名单；不确定的 API 默认不公开。core 可以提供常用、定义
  清楚的便捷几何原语，不因可组合实现或 UI 入口数量的顾虑刻意排除。
- 坐标系保持 Y-up。primitive 尺寸参数按轴命名为 `x`、`y`、`z`；
  需要消歧义时使用 `sizeX` 等名称。
- `@code3d/core` root 只面向作者建模；Studio 能力放在
  `@code3d/core/tooling`。
- core root 不导出 `ModelObject` 类值或类型；`Constraint` 仅作 type-only
  export。runtime identity、trace、snapshot、资源释放和 kind discriminators
  已从 root 收起。
- package entries 为 `.`、`./tooling` 与 `./replicad`。
- `definePrimitive(build)` 位于 `@code3d/core/replicad`，同步 builder 直接
  返回 Replicad shape，由 core 接管并转成 `SolidModel`；中间资源由 builder
  管理。没有定义选项、显式 adopt 或隐式 scope。
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
- 可选数值参数的面板默认值由 `@code3d.param` 的 `default` 字段静态描述，
  源码与已发布 `.d.ts` 共用解析。省略实参时以 placeholder 展示，主动输入才
  写入显式实参；实际运行默认值由函数实现决定，作者负责保持两者一致。
  具体规则见 [TOOLING.md](../TOOLING.md)，实现跟踪在 [#29](https://github.com/vilicvane/code3d/issues/29)。
- 公共 API 的职责或签名发生设计调整时，先明确说明改动、需求依据和代价。

## 待讨论

未决定的互操作、作者可读属性、group API、判别类型、Quaternion
和 tooling 边界已迁入 [#5](https://github.com/vilicvane/code3d/issues/5)。讨论结果确认
后再更新本文中的设计；迁移本身不代表批准公开这些 API。

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
- `paint` 是否适用于 group 仍是独立审阅项，本修复不要顺带决定。

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
- topology、scale、fillet/chamfer 的 `@code3d.param` 注释放在公共能力签名上，Studio
  继续能从作者实际解析到的 method signature 生成 panel。
- `paint` 暂时仍属于共同能力，因此 group 上的现有行为不变，等待独立审阅。

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
