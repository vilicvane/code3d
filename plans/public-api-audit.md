# 公开 API 审阅待办

用途：只记录当前已确认结论和下一步待讨论项；每讨论完一项就更新本文。

## 已确认

- 公开包采用显式最小白名单；不确定的 API 默认不公开。
- 坐标系保持 Y-up。primitive 尺寸参数按轴命名为 `x`、`y`、`z`；
  需要消歧义时使用 `sizeX` 等名称。
- `@code3d/core` root 只面向作者建模；Studio 能力放在
  `@code3d/core/tooling`。
- core root 不导出 `ModelObject` 类值或类型；`Constraint` 仅作 type-only
  export。runtime identity、trace、snapshot、资源释放和 kind discriminators
  已从 root 收起。
- package entries 仅保留 `.` 与 `./tooling`。

## 待讨论

- [ ] `helicalThread` 是否属于通用 core primitive；目前因
      `@code3d/screws` 的真实依赖暂时保留。
- [ ] `kind`、`name`、`color`、`children` 是否应成为作者可读属性。
- [ ] `withChildren()` 是否需要成为正式的 immutable group API。
- [ ] 是否需要公开 `ElementKind`、`ModelKind`、`TopologyKind` 等判别类型。
- [ ] 等旋转/变换 API 定型时，再决定是否从 root 公开 `Quaternion`。
- [ ] 单独最小化 `@code3d/core/tooling`。

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
