# 建模内核

本页解释模型、关系、拓扑与资源的内部契约。调用示例和完整作者能力从
[Core README](../../../packages/core/README.md)、
[公开入口](../../../packages/core/src/library/index.ts)和类型测试阅读。

## 模型值与公开边界

模型操作产生新值，原几何可共享，但旧模型及其引用的可观察行为不变。内部统一的
`ModelObject` 实现不决定所有作者类型都具有相同能力：group、点、边、面、实体
按实际能力公开方法，具名成员通过类型组合保留。

通用 `Model` 的 kind 是实际 `ModelKind` 的集合，所有具体模型（包括没有 expose
成员的 group）都可直接作为 `Model` 使用。能力接口和 `ModelForKind` 按具体 kind
保留链式返回类型，不引入与真实种类互斥的通用分类。嵌套 group 保留原有层级，
不要求作者用 expose 或类型断言来组合。公开类型同时由 CLI 和 App 的实际 Monaco
语言服务验证；两者可能使用不同的 TypeScript 版本。

作者 root 不暴露 runtime identity、trace、snapshot 或资源释放方法。拓扑引用的
`kind`、`id` 等是正式公开的几何信息，不能与内部模型字段混为一类。
TypeScript 隐藏声明不等于 JavaScript 对象上的字段不可读；这是 API 边界，
不宣称对象级安全隔离。App 通过当前 Core 的 tooling 入口检查其模型，不能使用
另一份 Core 的 `instanceof` 或内部类型强行连接。

公开 exports 使用白名单；签名中出现的命名类型、泛型约束和返回类型一起公开。
类型边界由 [public-api](../../../packages/core/test/public-api.ts)和
[public-types](../../../packages/core/test/public-types.ts)验证。

## 坐标、组合与关系

坐标及原点的唯一详细规范是[坐标语义技能](../../skills/code3d-coordinate-semantics/SKILL.md)。
修改模型前明确局部几何、组合实例位姿、参考元素坐标架及视口坐标的归属。
组合只在需要具体几何、查询或显示时解释相关模型的关系闭包；单独检查一个模型
仍使用它自己的局部几何。复用同一个模型值与创建两个 `relate` 值具有不同身份。

`relate` 确定接受摆放的 self，约束与独立 Transformation 按顺序保存在新模型值的 placements 中。Constraint 只表示 on/align 条件，不提供变换或旋转选择器；独立 Transformation 只表示一次 offset 或 rotate，不提供完成后的链式方法。pivot/pivotVertex/pivotPoint 可接一次 pivotOffset，aroundEdge/aroundLine 可接一次 axisOffset；偏移后的未完成选择只提供 rotate，完成后同样返回单步 Transformation；两者共用源码 trace。
连续约束形成联合求解段；独立变换作用于该段结果，随后约束仅继承前段姿态与自由度，不继承其硬条件。求解器先联合求解条件，再执行独立 transformations；只有 Transformation 存储动作与参考，不保留约束内变换路径。引用其他零件时使用其最终姿态。连续 relate 调用接续原排列。快照的 relationStages 保存段边界、结果位姿和固定组合架；原点重表达和嵌套组合一起变换该架。
独立 Transformation 不改变独立查看的局部几何。
旋转选择按输入区分坐标 pivot、self 拓扑 pivotVertex/aroundEdge 和直接引用 pivotPoint/aroundLine。拓扑 ID 延后由 self 解析；外部点线保留所属模型，参与关系闭包并使用已求解姿态。点引用只改变中心，旋转及 pivotOffset 仍沿 self 操作前局部轴；求解器正向执行与逆向恢复共用同一旋转参考计算，避免在摆放确定前烘焙外部点。

原点由构造器确定；派生操作继承主输入坐标系，不按结果包围盒自动居中。
group/union/intersect 使用首个成员或操作数的完整局部坐标系，cut 使用 stock，
loft 使用第一截面，extrude 保留输入面。group 将求解位姿统一左乘首成员位姿的逆，
保留成员相对装配；空 group 为默认坐标系。原点操作显式重表达坐标且不改变旧值。
完整[原点选择规则](../../../packages/web/src/content/docs/docs/concepts/local-coordinates.md#default-origin-rules)
统一记录构造器、继承操作、文字和自定义图元的行为。

运行时的 `RelationObject` 提供关系存储、位姿求解与阶段预览，`ModelObject`
负责有限几何和拓扑，`SketchFrame` 表达不依赖 B-Rep 的草图参考架。两者共用
关系语义，不用虚构面或组合体把空草图接入模型路径；参考架快照不参与几何导出。
草图局部定义、空间副本及上下文编辑的契约见[草图专题](sketch.md#空间参考架与模型上下文)。

- `on` 将模型或有限拓扑的支撑边界放到目标方向 bound，只求平移；不暗中旋转、
  匹配真实面或把切向位置居中。独立 offset 在联合解上沿固定组合参考架平移 self；零位移不添加约束，后续求解段保留前段未受约束的自由位置。
- `align` 表达底层几何重合或包含，可以解位置与姿态。线、面使用解析几何，
  忽略裁剪边界；方向的 `reverse`、`flip` 与参考轴分别处理。
- 独立旋转、pivot 和引用轴按明确的参考系构造；关系预览必须来自光标所在阶段，
  不能混入当前操作之后的姿态。同一连续段内的兄弟约束参与联合求解，
  前段只提供输入姿态；阶段预览截止当前变换，不越过独立变换收集后段约束。

实现见 [bound-solver](../../../packages/core/src/library/bound-solver.ts)、
[alignment-geometry](../../../packages/core/src/library/alignment-geometry.ts)和
[relation-solver](../../../packages/core/src/library/relation-solver.ts)。
回归包括 [alignment](../../../packages/core/test/alignment.test.ts)、
[constraint-preview](../../../packages/core/test/constraint-preview.test.ts)及
[group-origins](../../../packages/core/test/group-origins.test.ts)。

## 拓扑与维度

点、曲线、面、实体及其拓扑引用都可作为源码值被观察。引用携带有限几何和来源，
不只是 OCCT 句柄或渲染网格中的索引。`expose` 对已有拓扑保留身份，对纯参考几何
保留 Anchor 语义；几何来源与外层装配归属分别记录。

顶点、边和面分别编号。当前操作新增或无法唯一对应的拓扑使用从 1 开始的 ID；
一一对应的继承元素使用 `[输入序号, ...原 ID 路径]`。多个输入都参与来源映射，
内部实现步骤不占作者可见路径。分裂、合并和删除不靠遍历位置猜测旧身份；
变换和引用保持完整路径。每个后续操作使用它自身输入模型的命名空间。

源码追踪、选中、拾取、导出应消费同一份拓扑和位姿。拓扑候选来自操作输入时，
绘制需应用输入到结果及结果到实例的变换，不能直接使用输入坐标。
实现与验证见 [topology-id](../../../packages/core/src/library/topology-id.ts)、
[topology-lineage](../../../packages/core/test/topology-lineage.test.ts)和
[exposed-topology](../../../packages/core/test/exposed-topology.test.ts)。

## 互操作与资源所有权

`@code3d/core/replicad` 提供绑定当前内核的 Replicad 接口及 `definePrimitive`。
`definePrimitive(builder)` 默认按确定性定义和参数缓存 builder、实体规范化及几何
分析，命中仍产生独立模型元数据、shape handle 和本次追踪。影响结果的动态闭包
状态须显式传参。builder 返回的单个实体所有权转移给 Core；作者负责释放中间形状，
不能再复用或删除已转移的返回形状。screws 螺纹复用同一机制，不再维护私有 B-Rep LRU。

公开 `cached(fn, options?)` 处理同步数据，内部 `cachedArtifact()` 为相同缓存机制
增加内容身份、retain/instantiate/release 和远端查询接纳。内存直接保留计算/解码
结果，encoder/decoder 只在磁盘写入/恢复时运行。几何、bounds、mesh、字体解析、
CSS 解析和字形轮廓共用预算；解析后的字体对象只驻内存。定义身份与持久化边界见
[运行时专题](runtime.md#计算缓存持久化与并行快照)。

原生句柄释放依据所有权处理：借用不销毁，独立包装取得的句柄和临时原生值及时
释放；重复拓扑遍历结果也须逐个释放。缓存包可能持有模型，不能在一次源码求值
结束时强制销毁所有曾出现的对象。当前内核修正过上游生成析构器的问题，释放 JS
handle 不足以证明原生几何已释放。

相关实现见 [replicad](../../../packages/core/src/library/replicad.ts)、
[kernel-shapes](../../../packages/core/src/library/kernel-shapes.ts)、
[runtime](../../../packages/core/src/library/runtime.ts)及
[内核构建说明](../../../packages/opencascade/README.md)。
资源回归见 [native-topology-lifecycle](../../../packages/core/test/native-topology-lifecycle.test.ts)、
[retained-memory](../../../packages/core/test/retained-memory.test.ts)。
求值与缓存的收尾边界见[运行时专题](runtime.md)。

## 材质与导出

`@code3d/core/three` 共享原生 Three.js 类和类型。`material` 在调用时捕获材质及
已加载纹理的值，后续修改输入实例不改变旧模型；组合体覆盖子树，外层覆盖优先。
快照跨 Worker 传值，App 创建并释放显示实例。Modeling 强调样式使用显示副本，
Render 与 PNG 使用作者材质。

CAD 导出使用当前选定运行时中对应 revision 的完成快照，保留前景模型组合位姿，
排除弱化上下文和辅助标记。组合导出沿用快照的首成员局部坐标系，不重新居中；
导出回归同时核对成员位姿和导出后重新导入的包围盒。导出不借用主机的另一份内核，也不销毁仍需继续导出的
当前快照。实现见 [material](../../../packages/core/src/library/material.ts)、
[model-export](../../../packages/app/src/model/model-export.ts)；验证见
[材质测试](../../../packages/core/test/material.test.ts)和
[导出测试](../../../packages/app/test/model-export.test.ts)。

## 字体与文字

`font()` 和 `googleFont()` 同步提供不可变资源，异步下载及 WOFF2 解码由 App
资源准备负责；Node 入口初始化 HarfBuzz，普通 Node 调用使用本地文件或已解码字节。
字体初始化在运行时就绪阶段完成，不以顶层 await 阻塞编辑器或 Worker 消息入口。

HarfBuzz 排版提供真实二次/三次曲线，non-zero winding 布尔合并处理可变字体的
重叠笔画，包含层级保留孔与岛。`text()` 返回普通 FaceModel 数组，使用共同基线
原点，+X 向右、−Z 向上、+Y 法向；不逐字形居中。`extrude()` 的单面/面数组重载
保留输入顺序和位姿，运行时距离默认 10，TypeScript 签名仍要求距离。

作者参数、支持范围和示例以[文字参考](../../../packages/web/src/content/docs/docs/reference/core.md#text)
为准。实现与回归见 [font](../../../packages/core/src/library/font.ts)、
[text](../../../packages/core/src/library/text.ts)、[text tests](../../../packages/core/test/text.test.ts)
和 [third-party notices](../../../packages/core/THIRD_PARTY.md)。
