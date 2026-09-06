# code3d 设计目标

## Goals

- 使用完整的 JavaScript/TypeScript 自由构建和组合模型。
- code3d 模型项目是普通的 Node/TypeScript 项目，自行管理 `package.json`、
  lockfile 和 `node_modules`。App 在项目未声明 `@code3d/core` 时提供完整内置
  core/screws，支持零安装开始建模；声明 core 后全部由项目自己的依赖接管。
- 同一份项目源码遵循标准 Node ESM/TypeScript 规则，既可由 App 加载，也可
  在受支持的 Node 环境中直接执行。
- 关注模型对象本身，而不是它的构建过程。
- 模型可以导出、导入、复用、实例化和渲染。
- 当前编辑的任意源码文件都可以直接作为执行根并预览其中的模型。
- 代码与 GUI 围绕同一个模型对象交互。
- 编辑模型时以代码为主；GUI 只在代码不便操作时提供重要但克制的补充。
- 展示模型信息时充分使用 GUI，不要求所有信息都回到代码界面表达。
- 交互具有明确的 scope：整体模型、实例或组件、局部元素或操作。
- GUI 补充代码中不方便、不直观的操作。
- 源文件是模型持久化参数的唯一来源；GUI 修改直接写回源码。
- 模型参数可以追溯到可编辑的上游源码。
- 模型对象采用语义不可变的 value semantics；建模操作产生新值，不改变已有值的可观察模型语义。
- 模型可以公开类型安全的具名点、线、面参考元素，供复用方直接选择、约束和可视化。
- 几何模型经 `expose` 成为相应的拓扑引用，已有拓扑引用保留身份；纯参考几何保留 Anchor 语义。拓扑引用支持按维度继续查询，其几何来源与装配归属分别记录，约束作用于外层模型。见 [#27](https://github.com/vilicvane/code3d/issues/27)。
- 派生模型使用简洁的数字拓扑 ID 指定局部元素；确定性重算会保留一一对应的旧 ID，新元素只从高水位递增分配，已消失的 ID 不再复用。

- `on` 只允许平移，左侧为模型或所选有限点/线/面，右侧仅为 up/down/left/right/front/back 方向 bound。源极值边界在目标方向下计算，不自动转动、居中或匹配真实拓扑面。见 [#38](https://github.com/vilicvane/code3d/issues/38)。
- `relate` 确定接受摆放的 self，与 on 的书写方向分离；原 receiver 引用可重绑定。旋转用独立的 pivot/pivotVertex/around 与 rotate 链显式表达，局部坐标和顶点归属以 self 为准。见 [#36](https://github.com/vilicvane/code3d/issues/36)。

## Non-goals

- 不把构建步骤、历史记录或特征树作为核心抽象。
- 不为方便 GUI 同步而限制 JavaScript/TypeScript 的表达能力。
- 不用虚构模块或声明副本代替真实包产物。项目已声明 core 时，不用内置包掩盖
  缺失或不兼容的依赖；内置模式与项目模式各自保持一致的类型和运行时实例。
- 不要求 GUI 能反向编辑任意 JavaScript/TypeScript 代码。
- 不用 GUI 取代代码，也不复刻完整的传统 CAD 工作流。
- 不为维持一套平行的 GUI 编辑状态投入复杂的双向同步机制。
- 不让公开模型接口依赖 OpenCascade 或具体渲染器。
- 不把 OpenCascade 的瞬时 hash、容器位置或遍历下标当作公开拓扑 ID。
- 不默认引入长度、角度等强数值类型；unit 只作为 UI 元数据。
- 不把全局绝对坐标作为对象组合和装配的默认抽象。
