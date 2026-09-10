# 建模内核

本页解释模型、关系、拓扑与资源的内部契约。调用示例和完整作者能力从
[Core README](../../../packages/core/README.md)、
[公开入口](../../../packages/core/src/library/index.ts)和类型测试阅读。

## 模型值与公开边界

模型操作产生新值，原几何可共享，但旧模型及其引用的可观察行为不变。内部统一的
`ModelObject` 实现不决定所有作者类型都具有相同能力：group、点、边、面、实体
按实际能力公开方法，具名成员通过类型组合保留。

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

`relate` 确定接受摆放的 self，关系保存在新模型值上。

运行时的 `RelationObject` 提供关系存储、位姿求解与阶段预览，`ModelObject`
负责有限几何和拓扑，`SketchFrame` 表达不依赖 B-Rep 的草图参考架。两者共用
关系语义，不用虚构面或组合体把空草图接入模型路径；参考架快照不参与几何导出。
草图局部定义、空间副本及上下文编辑的契约见[草图专题](sketch.md#空间参考架与模型上下文)。

- `on` 将模型或有限拓扑的支撑边界放到目标方向 bound，只求平移；不暗中旋转、
  匹配真实面或把切向位置居中。显式 offset 在目标参考架中表达其定位语义。
- `align` 表达底层几何重合或包含，可以解位置与姿态。线、面使用解析几何，
  忽略裁剪边界；方向的 `reverse`、`flip` 与参考轴分别处理。
- 旋转链、pivot 和引用轴按明确的参考系构造；关系预览必须来自光标所在阶段，
  不能混入下游链操作之后的姿态。

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
当前 builder 同步执行每次调用，将返回的单个实体所有权转移给 Core；作者负责
释放中间形状，不能再复用或删除已转移的返回形状。操作缓存识别真实 B-Rep 内容，
不据此把任意 builder 的闭包和参数当作纯函数缓存。

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
排除弱化上下文和辅助标记。导出不借用主机的另一份内核，也不销毁仍需继续导出的
当前快照。实现见 [material](../../../packages/core/src/library/material.ts)、
[model-export](../../../packages/app/src/model/model-export.ts)；验证见
[材质测试](../../../packages/core/test/material.test.ts)和
[导出测试](../../../packages/app/test/model-export.test.ts)。
