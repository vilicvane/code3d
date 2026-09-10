# 草图

草图由源码表示，GUI 编辑其几何和约束，Core 求解并生成可观察结果。App 不维护
另一套可独立保存的草图状态，也不把求解器的第三方输入格式作为作者 API。

## 表示、身份与派生

[sketch.ts](../../../packages/core/src/library/sketch.ts)定义 `SketchEntry`、
`SketchConstraint`、`SketchPoint` 及不可变 `Sketch`。实体用 `[kind, id, data]`
tuple，几何当前数据与 `constraints` 分开。点、线、圆、圆弧具有本层唯一的正整数
ID；新建取本层最大 ID 加一，不持久化 `nextId`，不重排现存实体。
约束不持久化 ID，源码范围和本次求解索引负责诊断定位。

点既可存坐标，也可引用本层点 ID 或具名上游的 `base.point(id)`。别名保留作者
ID，但共享 canonical 求解点；缺失、循环及非法跨层引用明确报错。
`derive` 的上游只读，本层可引用其点而不能写回上游。源码没有可安全识别的
具名 binding 时，不为匿名上游发明相对层级语法或自动改写声明。

显式拖动吸附在松手时原子写入点别名，同时移除因此退化的本层直线及其约束；
两点 ID 均保留。预览显示相同的合并和删线结果，移开或取消恢复原拓扑。
坐标恰好相同不自动合并身份。表达式锁、固定冲突及上游只读优先。
验证见 [sketch-alias](../../../packages/core/test/sketch-alias.test.ts)、
[sketch-source](../../../packages/app/test/sketch-source.test.mjs)。

## 空间参考架与模型上下文

`Sketch.plane` 是法向为局部 `+Y` 的无界参考平面；草图 `[x,y]` 映射到参考架
`[x,0,-y]`。`relate(self => self.plane.align(target))` 返回新的空间值，共享原始
二维定义和点身份，不增加派生层、不重求二维约束或将摆放烘焙到 tuple 坐标。
空草图和开放轮廓同样可关联，不为它们伪造 B-Rep 面或 group。

[runtime](../../../packages/core/src/library/runtime.ts)中的 `SketchFrame` 与模型
共用 `RelationObject` 的关系存储、位姿求解和阶段预览。`align` 使用相同的有向
平面及目标参考架 offset/rotation 语义，不按裁剪面边界自动居中或额外锁定切向
自由度。无界平面不支持依赖有限几何的 `on`；`pivotVertex` 仍要求模型拓扑。
引用绑定实际的不可变目标值，不会因作者之后创建另一个旋转模型而自动转向新值。

`derive`、`face` / `faces` 和拉伸继承空间关系；布尔和 loft 在已有组合上下文中
求解输入，不提前改变局部几何。派生层可引用原始草图或其空间副本的同一上游点，
校验和求解按共享二维定义归一到实际上游层，而不是误判为非法跨层引用。

[sketch-trace](../../../packages/app/src/model/sketch-trace.ts)分别追踪空间值身份、
几何求值身份和源码定义。同一几何的不同摆放保留各自的使用位置与参考架，但
回写同一份数组；检查原始值不带入某个下游摆放。回调 self 的临时追踪身份须在
完整求值后解析，不能固化成与最终空间值不一致的来源。

关联编辑背景来自同一关系闭包中有限模型相对于草图参考架的位姿，经
[sketch-context](../../../packages/app/src/tools/sketch-context.ts)投影到局部二维
编辑平面；嵌套组合保留各 occurrence 的变换。背景仅供观察，不参与拾取、吸附
或外部几何约束。拖动、绘制、源码事务和撤销继续使用原有二维编辑路径。
跨 Worker 的参考架快照为无 mesh 的 `reference`，不进入几何查询、模型导出或
最后一个几何结果 fallback。选面后自动创建草图的 GUI 入口仍由
[#114](https://github.com/vilicvane/code3d/issues/114)跟踪，不属于已完成能力。

验证见 [Core 关系回归](../../../packages/core/test/sketch-relations.test.ts)、
[编译与上下文](../../../packages/app/test/compiler-sketch-relations.test.ts)和
[浏览器关联编辑](../../../packages/app/test/browser/sketch-relations.test.ts)。

## 求解与精度

[sketch-solver](../../../packages/core/src/library/sketch-solver.ts)适配 PlaneGCS。
独立的硬约束、临时拖动条件和软目标各有职责；原生返回 Success 不替代对全部
原始约束的几何残差检查，已移除的冗余方程也必须参与最终验证。
冲突和未收敛有来源诊断，不能通过悄悄删除作者约束或放宽容差得到成功状态。

[SketchPrecision](../../../packages/core/src/library/sketch-precision.ts)统一局部
尺度、数值归一化、原生收敛和几何精度预算。尾差清理优先作者准确输入及本次
拖动值，并重新检查硬约束和圆弧结构；后续写回不再进行另一套舍入。
中间阶段的数值解只是下一阶段种子，不提升为作者输入或持久约束。

圆弧的中心、半径、起终点与 cw/ccw 共同定义有限弧。不一致初值的径向投影只
建立种子，不能覆盖锁定坐标、显式半径或上游数据，也不能引入隐藏约束。
共享端点同时接收各弧的投影建议，避免按数组顺序相互覆盖。
整圆使用 circle，零半径或重合端点不伪装成有效弧。

参数按每层稳定实体 ID 构造，不受作者数组顺序影响。含圆弧的硬约束使用 BFGS，
其他硬约束使用 DogLeg，软目标仍走 BFGS；原因是欠约束圆弧的基本解会受原生
地址排序影响。不能把全面替换算法或重试另一个求解器当作等价实现。
实验依据见[求解器研究记录](../../research/sketch-solver-evaluation.md)，当前行为由
[sketch-arc](../../../packages/core/test/sketch-arc.test.ts)、
[sketch-constraints](../../../packages/core/test/sketch-constraints.test.mjs)等回归约束。

## 拖动规则与临时关系

[sketch-drag-rules](../../../packages/core/src/library/sketch-drag-rules.ts)按规则分派
手势，通用执行器不预先把点分成中心、端点或独立组件。规则取得完整参考几何，
返回按优先级求解的目标阶段和可选初值。

- 永久约束、上游只读和 AST 表达式锁始终生效。
- 圆弧端点先尽量保持关联圆心；圆心手势先尽量保持所属曲线半径。
  点兼具多个角色时保留这些优先级，不强行固定原位置。
- 随后依次求鼠标最近可达位置、局部平移和外围少动。后层保留前层已经达到的
  目标参数，不能以小权重混合替代优先级，也不能把当前帧的锁持久化。
- 最低优先级保持其他点的手势起始位置，只收敛剩余自由度，不拉回前层已决定
  的位移。别名按 canonical 点去重，不能重复增加权重。

参考几何固定在手势开始时，上一帧结果只作迭代种子。拖动开始时已在线、圆或弧
上的点可随曲线运动，有限线段和实际弧区间提供边界；途中经过另一条曲线不自动
建立关系。这些手势条件不写入 `constraints`，提交只写实际可编辑几何。
写回前通过相同源码正向求值复核，不靠隐藏的 viewport 状态保持结果。

回归见 [sketch-drag-rules](../../../packages/core/test/sketch-drag-rules.test.ts)、
[sketch-curve-incidence](../../../packages/core/test/sketch-curve-incidence.test.ts)、
[sketch-arc-radius](../../../packages/core/test/sketch-arc-radius.test.ts)及
[浏览器连续手势](../../../packages/app/test/browser/sketch-drag-rules.test.ts)。

## 绘制、输入与约束编辑

草图滚轮缩放不设固定上下限，初始取景也能容纳大型草图及关联模型背景。
网格与吸附共用当前缩放对应的格距；页面 UI 接收格距变化，与 3D 共用左下角图例，
退出草图时恢复当前 3D 的读数和可见性。图例及提示布局见
[源码与交互工具](tooling.md#意图计划与事务)，缩放及视图切换由
[浏览器回归](../../../packages/app/test/browser/camera-navigation.test.ts)验证。

绘制会话拥有阶段、草稿、吸附候选和数字字段，preview 不写源码。成功绘制一个
图元或一个矩形时，通过[源码事务](tooling.md#意图计划与事务)一起写入几何和约束。
连续线按每段提交和撤销；工具退出或取消不留下半成品。

未指定的量跟随鼠标，显式输入不被 pointer move 覆盖。数字、Tab、Enter、Esc
按绘制字段和工具作用域处理，输入框保留原生文本编辑及撤销。X/Y 方向锁与角度
输入互斥，以最终有效选择为准；显式尺寸和方向在创建时成为持久约束，普通自动
吸附不因此增加约束。输入完成后由几何或求解验证可行性。

矩形由普通点线和约束组成。对角矩形约束相邻两边尺寸，不重复约束对边；中心
矩形增加一个可引用中心点和一组三点 midpoint，不生成额外对角线或隐式实体。
圆和弧共用解析几何，半径是当前数据，只有明确尺寸输入才增加 radius 约束。
弧的 sweep 是独立有向扫角约束，cw/ccw 不由短弧推断。

已有几何的尺寸编辑支持 TypeScript 表达式：输入时检查表达式语法，原样写回，
由正常编译在原词法作用域求值。绘制中的即时定位仍走数字输入，两者不能混为
同一个求值入口。对表达式坐标或半径的直接拖动保持只读边界。

选中后的约束操作使用作者图元身份，对同一曲线的多个显示分段去重。添加先检查
完整选集和写入范围；移除约束保留当前可编辑几何及原表达式，不跳回旧初值。
Fixed 不能把表达式初值与求解结果间的差异隐藏为一次意外移动。
两线 angle 使用作者线方向的有符号转角，单线 angle 表示相对 +X 的方向。

约束标记来自真实约束及关联几何，只读上游和本层分别显示，不保存 UI 布局或
虚构约束 ID。事件不穿透标记触发底层绘制、拖动或修剪。布局和输入细节见
[sketch-constraint-layout](../../../packages/app/src/tools/sketch-constraint-layout.ts)、
[drawing-inputs](../../../packages/app/src/ui/drawing-inputs.ts)、
[sketch-constraint-actions](../../../packages/app/src/tools/sketch-constraint-actions.ts)。
验证见 [sketch-drawing](../../../packages/app/test/sketch-drawing.test.mjs)、
[sketch-dimension-expressions](../../../packages/app/test/browser/sketch-dimension-expressions.test.ts)。

## 修剪、删除与区域

[解析曲线](../../../packages/core/src/library/sketch-curves.ts)与
[交点](../../../packages/core/src/library/sketch-curve-intersections.ts)共用显示、拾取、
有限区间、吸附和修剪几何。不能用屏幕折线求交替代模型几何精度。
划分显示区间不修改源码，真正删除时才生成新的实体及引用。

线或有限弧剩一个片段保留 ID，剩两段退役旧 ID 并分配新 ID；其他实体不重排。
圆按循环区间处理，不制造零角接缝；剪开后成为 CW 弧并保留 ID。
重叠曲线在同一区间一起处理，保留区间外部分；新交点共享，相关约束按存活几何
映射，整线 length 或整弧 sweep 不转移为片段尺寸。

删除只清理因此失去连接的本层点及相关约束，保留无关独立点、共享点及只读上游。
上游可以提供修剪边界，但不被改写。Trim 与 Select + Delete 共用一次源码事务，
取消和撤销同时恢复实体身份、表达式与约束。

[sketch-regions](../../../packages/core/src/library/sketch-regions.ts)从本层及上游
闭合边界提取区域，实体/孔/岛按包含关系交替。开放、相交、相切、重叠或分叉
轮廓明确诊断，不隐式补线、修剪或改 ID。区域预览不创建作者实体或拦截拾取。

`face()` 要求唯一有效区域，`faces()` 返回普通只读数组；数组位置不是稳定区域 ID。
草图 `[x,y]` 映射到模型 `[x,0,-y]`，不自动居中，拉伸沿面法向解释有符号距离。
`extrude(faces, distance)` 按数组顺序独立拉伸并保留每个面的摆放，返回普通只读
实体数组；loft 的截面数组是单次运算输入，孔的对应不能按遍历序号猜测。

验证见 [sketch-circular-trim](../../../packages/app/test/sketch-circular-trim.test.ts)、
[sketch-overlap](../../../packages/app/test/sketch-overlap.test.ts)、
[sketch-regions](../../../packages/core/test/sketch-regions.test.ts)、
[sketch-modeling](../../../packages/app/test/browser/sketch-modeling.test.ts)。

## 诊断与源码同步

草图 viewport 只显示当前 execution 及上游定义的错误，不把失败的下游派生、
其他模型或同源码的另一实例混入。编辑器仍显示完整源码诊断。重新编译失败时
可保留同一源码目标最后成功的只读快照；离开范围清除，成功编译恢复正常编辑。

成功求解但几何初值与显示结果超出局部精度时，产生非阻塞 warning，状态仍为
Ready。通用 diagnostic actions 携带标签和 ToolIntent，UI 不实现修复算法。
显式 Fix 只同步本层可写的字面量坐标和半径，保留表达式、实体 ID 与约束。
动态数组、同一源码存在多个独立几何求值或必须覆盖表达式的修复不能伪装成安全
操作；共享 geometry identity 的空间副本不算独立几何求值，不因此禁用 Fix。
上游需打开所属草图再处理。提交使用编译 revision、expected text 和一次源码撤销。

实现与验证：[sketch-diagnostics](../../../packages/app/src/tools/sketch-diagnostics.ts)、
[compiler-sketch-diagnostics](../../../packages/app/test/compiler-sketch-diagnostics.test.mjs)、
[浏览器诊断回归](../../../packages/app/test/browser/sketch-diagnostics.test.ts)。
