# 建模内核

本页解释模型、关系、拓扑与资源的内部契约。调用示例和完整作者能力从
[Core README](../../../packages/core/README.md)、
[公开入口](../../../packages/core/src/library/index.ts)和类型测试阅读。

API 文档按批次完善时，同步将相应实现按职责拆出。八个 Solid Primitives 分别由
`box.ts`、`cylinder.ts`、`sphere.ts`、`ellipsoid.ts`、`frustum.ts`、
`regular-prism.ts`、`tube.ts` 和 `coil.ts` 拥有各自构造、参数标注与几何创建，
箱体尺寸检查器和线圈净空检查也跟随对应 API。`validation.ts` 共享正数校验；通用模型构造、
操作记录、缓存与参考元素机制保留在 `runtime.ts`。`union.ts`、`cut.ts`、`intersect.ts` 分别承载布尔作者入口与检查器，
`boolean-model.ts` 共享操作数校验；实体实例方法仍通过运行时的组合机制求值。
`origin-center.ts` 承载单个/数组居中的作者重载与检查器，批量装配和局部变换仍由
运行时统一维护模型身份、拓扑与约束。组合、on/align、独立变换、pivot/axis 选择器和角度耦合的作者入口分别归同名
模块；`group.ts` 同时承载成员检查，原点居中复用该检查入口。runtime 只向这些
模块提供内部参考解析和表达式机制，不反向依赖作者模块。`distance.ts` 承载距离查询的作者入口及检查器，实际有限几何测量、参考解析和关系求解继续共享于 runtime。`text.ts` 调用 `text-geometry.ts` 的字形几何算法；`google-font.ts` 调用 `google-font-sources.ts` 的 CSS 解析与 URL 构造，字体解析和资源身份由 `font.ts` 共享。`authoring-api.ts` 只汇总作者
入口，避免运行时反向依赖独立 API 模块。公开导出与编辑器跟踪指向实际实现，
不保留旧模块转发入口。文档源码基准的维护方式见
[网站维护说明](../../../packages/web/README.md#source-review-baselines)。

点、四种曲线及四种平面轮廓也各自由同名模块拥有构造和参数定义。
`curve-model.ts` 统一曲线模型、起止/参数中点参考的装配及点列校验；
`planar-face-model.ts` 统一轮廓原生法向归一与资源释放。通用边参考的
`curveAnchor`、面模型创建与几何缓存仍由 runtime 共享，避免反向依赖作者 API。
`validation.ts` 共享标量和有限坐标校验，`spatial.ts` 负责坐标表示转换。

成形 API 的自由函数与检查器归 `extrude.ts`、`revolve.ts`、`sweep.ts`、
`loft.ts`、`wrap.ts`、`thicken.ts`；内核算法由 `*-geometry.ts` 拥有。
实例方法、求解、模型身份及资源缓存仍由 runtime 统一管理，作者模块不被 runtime
反向导入。复杂 API 的源码核对范围同时包含共享方法实现与相关内核模块。

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

`on(targetBound)`、`on(sourceElement, targetBound)`、`align(sourceElement, targetElement)` 和 `coupleRotation(otherModel)` 是独立约束函数。省略的 source 在构造时绑定当前 self，显式引用保留原身份。

`relate` 确定接受摆放的 self，约束与独立 Transformation 按顺序保存在新模型值的 placements 中。Constraint 表示 on/align 或独立 coupleRotation 条件，不提供变换或旋转选择器；独立 Transformation 只表示一次 offset 或 rotate，不提供完成后的链式方法。pivot/pivotVertex/pivotPoint 可接一次 pivotOffset，axisEdge/axisLine 可接一次 axisOffset；点与轴选择均用 rotate 返回 Transformation。选择与终结调用共用源码 trace。
连续约束形成联合求解段；独立变换作用于该段结果，随后约束仅继承前段姿态与自由度，不继承其硬条件。求解器先联合求解条件，再执行独立 transformations；只有 Transformation 存储动作与参考，不保留约束内变换路径。引用其他零件时使用其最终姿态。连续 relate 调用接续原排列。快照的 relationStages 保存段边界、结果位姿和固定组合架；原点重表达和嵌套组合一起变换该架。
独立 Transformation 不改变独立查看的局部几何。
旋转选择按输入区分坐标 pivot、self 拓扑 pivotVertex/axisEdge 和直接引用 pivotPoint/axisLine。拓扑 ID 延后由 self 解析；外部点线保留所属模型，参与关系闭包并使用已求解姿态。点引用只改变中心，旋转及 pivotOffset 仍沿 self 操作前局部轴；求解器正向执行与逆向恢复共用同一旋转参考计算，避免在摆放确定前烘焙外部点。

固定轴传动在既有 relation-solver 中先求累计角度，再固定对应姿态的旋转自由度并求位置。
角度投影读取同一份 placements 的完整分段顺序，frame/frame align 传递角度，coupleRotation 应用
传动比和相位；显式 XYZ 或选轴 rotate 保留整圈。独立 `coupleRotation(other, config)` 在构造时从 relate 上下文取得 self，并读取两边模型自己的 axis，形成显式参与引用。模型轴提供局部方向和
角度基准，frame 依赖把该局部轴映射到上游模型。角度只固定姿态，轴位置不增加接触约束。未涉及传动的装配继续既有位姿路径，不增加 App
状态或跨帧历史。Core 拥有通用角度关系，Gears 拥有齿数、啮合相位与中心距离。
当前限制为每个刚体单一固定轴方向的无环驱动依赖；冲突、混合轴和不支持的几何角度驱动明确报错。

原点由构造器确定；派生操作继承主输入坐标系，不按结果包围盒自动居中。
group/union/intersect 使用首个成员或操作数的完整局部坐标系，cut 使用 stock，
loft 使用第一截面，extrude、revolve 与 sweep 保留输入面。group 将求解位姿统一左乘首成员位姿的逆，
保留成员相对装配；空 group 为默认坐标系。原点操作显式重表达坐标且不改变旧值。
完整[原点选择规则](../../../packages/core/docs/local-coordinates.md#default-origin-rules)
统一记录构造器、继承操作、文字和自定义图元的行为。

`originCenter()` 按当前局部有限几何的包围盒中心重设原点；携带的 `center`
锚点继续随变换保持同一几何点，通过 `originPoint(model.center)` 显式选用。
同名自由函数对单对象及单元素数组等价；多成员以首成员坐标架求解完整布局，
再统一把几何、内部平面架、具名引用和拓扑重表达到中心为零的坐标架，返回
相同顺序与类型的普通模型数组。原有关系已在布局中求解，结果不再重复求解
输入关系。Core 保持模型值语义；App 从现有 `isCollection` 派生空间编辑可用性，
数组不能追加单模型方法，单个成员仍可正常编辑。

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

## 同步测量

`distance(a, b, axis?)` 在调用时沿输入及轴引用的现有关系闭包求解，返回普通非负
number；不修改模型，不维护响应式尺寸，不回溯后续关系。未约束模型沿用默认
共同原点与轴向。具体组合实例通过外层 expose 引用测量。

无轴时逐对查询实际有限几何的最短距离；点间直接算术，其他几何使用
BRepExtrema_DistShapeShape 并缓存距离与最近端点。指定轴时将各输入几何变换到轴参考架，
复用解析 transformed-bounds 查询，计算整体投影区间间隔。投影区间可以覆盖
离散成员间空隙，空间距离仍按真实成员取最小值。显式 bound 是有限矩形，
退化时为线段或点；纯参考轴仅支持方向参数，无限平面不作为有限测量输入。

暴露的 group 引用保留各成员的有限拓扑来源和局部摆放；原点、旋转、缩放及
后续 expose 统一变换这些来源，bounds 与 distance 共用它们。group 本身仍保持
嵌套层级，测量不重求其内部装配。查询借用源几何，临时拓扑、变换和距离求解器
句柄按作用域释放，不把模型身份放入几何数值缓存键。

视口测量事件保留当前共同求解位姿和有限元素快照，独立于返回的 number；
参与对象与绘制规则见[相关实体表](tooling.md#相关实体与源码预览范围)。

实现与回归见 [distance tests](../../../packages/core/test/distance.test.ts)，
公开语义见 [Measurements](../../../packages/core/docs/api.md#measurements)。

## 拓扑与维度

点、曲线、面、实体及其拓扑引用都可作为源码值被观察。引用携带有限几何和来源，
不只是 OCCT 句柄或渲染网格中的索引。`expose` 对已有拓扑保留身份，对纯参考几何
保留 Anchor 语义；几何来源与外层装配归属分别记录。

顶点、边和面分别编号。loft、extrude 和布尔构造新命名空间，新增或无法唯一对应的
拓扑使用从 1 开始的 ID；一一对应的继承元素使用 `[输入序号, ...原 ID 路径]`。
多个输入都参与来源映射，内部实现步骤不占作者可见路径。fillet、chamfer、shell
属于局部修改，保留输入命名空间及一一对应元素的完整 ID，不额外加输入前缀。
每类拓扑保存下一可用数字，随模型值及缓存持久化保留；局部修改只向上分配，
即使前一步删除最高数字且没有新增元素，也不能重用已退役 ID。分裂、合并和删除
不靠遍历位置猜测旧身份；变换和引用保持完整路径。

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

公开 `cache(fn)` / `cache(fn, args)` 处理同步数据，内部 `cachedArtifact()` 为相同缓存机制
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

场景定义与选择状态由 [render-scene](../../../packages/app/src/rendering/render-scene.ts)
管理，交互视口显式注入带浏览器持久化的选择实例，独立渲染默认创建不持久化的
Studio 选择。渲染器通过 MobX 派生当前模式的背景、灯光与环境反射；Modeling
固定使用原有场景，Render 使用选择的内置预设。原生 Three.js 资源与右上角场景
菜单通过 reaction 消费同一选择；切换不修改模型材质或相机。
环境纹理按需创建、在同一渲染器内复用并随其销毁；屏幕和视口 PNG 走同一场景。
独立 agent 观察视口使用默认预设，不继承主视口的持久化选择。

Render 的布光预设独立于 Modeling。由
[RenderLighting](../../../packages/app/src/rendering/render-lighting.ts) 统一管理
主光阴影与屏幕空间 GTAO：阴影覆盖范围和 AO 半径从可见不透明实体的世界包围盒
派生，保持不同尺寸、位置与视角下的形体可读性。先用不透明面生成并去噪遮蔽纹理，
再通过光照材质的显示副本仅调制间接光照；保留 Three 的完整颜色与透射管线，
不把透明、透射或裁切面当作实心遮挡，也不压暗自发光和无光照材质。
显示副本随原材质或渲染器释放，不改变作者材质；调用结束时恢复临时材质引用、
可见性、阴影标记、灯光位置和 renderer 状态。
建模路径不运行后处理。视口和 PNG 复用相同处理及确定性采样；AO 中间缓冲按输出
尺寸复用并限制最长边为 1024，阴影贴图与后处理资源随 ModelRenderer 销毁。

场景菜单与工具变体菜单共用 [ChoiceMenu](../../../packages/app/src/ui/choice-menu.ts)
的单选 popover、键盘导航、焦点恢复和视觉样式；选择状态由调用方拥有，菜单只消费
它。Toolbar 保留工具主按钮与变体记忆，场景组件保留视口可见性与当前名称。
两者销毁时释放菜单订阅和事件，不把右键操作菜单或表单 select 强行并入这一接口。

CAD 导出使用当前选定运行时中对应 revision 的完成快照，保留前景模型组合位姿，
排除弱化上下文和辅助标记。组合导出沿用快照的首成员局部坐标系，不重新居中；
导出回归同时核对成员位姿和导出后重新导入的包围盒。导出不借用主机的另一份内核，也不销毁仍需继续导出的
当前快照。实现见 [material](../../../packages/core/src/library/material.ts)、
[model-export](../../../packages/app/src/model/model-export.ts)；验证见
[材质测试](../../../packages/core/test/material.test.ts)和
[导出测试](../../../packages/app/test/model-export.test.ts)。

## 字体与文字

`font()` 和 `googleFont()` 异步提供不可变 Font；模型显式 await，随后 `text()`
同步建模。Core 负责 CSS 和 WOFF2 解码，宿主资源接口负责加载、缓存及取消。
App 在执行依赖模块前安装资源服务，不依赖编译期下载；Node 异步加载 URL 或字节。
HarfBuzz 引擎初始化仍由运行时就绪流程负责，与字体文件加载分开。

HarfBuzz 排版提供真实二次/三次曲线，non-zero winding 布尔合并处理可变字体的
重叠笔画，包含层级保留孔与岛。`text()` 返回普通 FaceModel 数组，使用共同基线
原点，+X 向右、−Z 向上、+Y 法向；不逐字形居中。`extrude()` 的单面/面数组重载
保留输入顺序和位姿，运行时距离默认 10，TypeScript 签名仍要求距离。

作者参数、支持范围和示例以[文字参考](../../../packages/core/docs/api.md#text)
为准。实现与回归见 [font](../../../packages/core/src/library/font.ts)、
[text](../../../packages/core/src/library/text.ts)、[text geometry](../../../packages/core/src/library/text-geometry.ts)、[text tests](../../../packages/core/test/text.test.ts)
和 [third-party notices](../../../packages/core/THIRD_PARTY.md)。

## 曲面包覆与增厚

`wrap` 将共面的输入组转换到第一输入的平面架，以全部轮廓的二维包围矩形为有限
区域。目标先与该矩形的法向柱体求交，原生最近距离返回候选锚点；目标跨越源面
两侧时拒绝。比较候选在整个区域的局部映射，允许圆柱母线等价解，拒绝不同结果。
映射按原生曲面的二阶导数积分测地线，源平面方向最小旋转至锚点切平面；误差按
模型单位控制。自适应拟合的二维 B-spline 边界附在原生支撑曲面上，保留孔洞，
在原目标裁剪域内求交并按周期接缝拆面。完整矩形（含空白）需被目标覆盖。

包覆结果是没有具名 `plane` 的真实 FaceModel。沿平面法线的操作先验证实际支撑
面，不能用默认参考架伪造曲面法向。`thicken` 用原生简单偏移封闭边界；此构造器
不保证实体朝外，必须先 OrientClosedSolid，再检查形体与有符号体积，最后进入
拓扑继承及布尔运算；构造前按曲面主曲率拒绝已检测到的过曲率中心偏移。平面图元
从 Replicad XZ 草图进入 Core 时统一原生面朝向为 +Y，与作者平面架一致，避免
extrude、sweep 与 thicken 使用两套相反法向。两种操作保持既有 Core 值语义与普通 inspect 数据，不引入
App 状态副本。wrap 继承首输入坐标架，thicken 逐个继承源面。

源平面架取模型内部 `geometryAnchor`，不读取能由 expose 改写的具名 plane。
平面包覆输出同步保存实际支撑平面架，后续原点与旋转操作继续重表达该架。

内部职责分为 [wrap 区域定位](../../../packages/core/src/library/wrap-geometry.ts)、
[测地映射与布局校验](../../../packages/core/src/library/wrap-mapping.ts)、
[边界拟合与 BRep 构面](../../../packages/core/src/library/wrap-face.ts)。
[曲面导数与主曲率](../../../packages/core/src/library/surface-geometry.ts)由 wrap 与
[thicken](../../../packages/core/src/library/thicken-geometry.ts)共用；布局校验按曲面上的映射
插值误差自适应细分，所有探测点位于有限矩形内，并检查短 B-spline 节点区间。
增厚校验从[裁剪面的私有三角域](../../../packages/core/src/library/surface-domain.ts)
出发，保留孔与接缝，再按节点区间及曲率裕量/偏移误差细分；不采样整个 UV 包围矩形。
细分不收敛或超出预算时抛错，不能把未完成检查当作有效结果。

[原生资源作用域](../../../packages/core/src/library/kernel-scope.ts)在取得句柄后立即
拥有它，返回结果时显式移交；构造、拟合、重建及检查抛错都经过同一清理路径。
回归见 [wrap tests](../../../packages/core/test/wrap.test.ts)和
[曲面验证 tests](../../../packages/core/test/surface-validation.test.ts)，包括具名引用
覆写、孔内曲率、固定采样线之间的窄曲率峰与原生异常释放。
自适应数值检查与原生有效性检查不构成任意自由曲面全局单射或复杂偏移不自交的
证明；支持范围以[公开约定](../../../packages/core/docs/api.md#curved-surface-wrapping)为准。

## 排布与几何查询

`@code3d/layout` 使用公开 Core `originOffset` 和模型 `rotate` 表达共享局部坐标中的
排布，不追加无约束 relate，不依赖 tooling 或持有 MobX 状态。`repeat(model, count)`
统一已知数量输入；`linear`/`radial`/`flex`/`grid` 消费集合并保留数量与类型。
`fillFlex`/`fillGrid` 只负责从所选轴的目标边界、原型尺寸、净间距计算容量，再复用
对应布局路径；计数只处理浮点舍入误差，不量化尺寸，也不检查任意实体内部空间。

模型和目标空间是独立参数，决定排布的配置统一命名为 `*LayoutConfig`，配置对象必填。
linear/radial/flex/fillFlex 显式指定 axis，grid/fillGrid 显式指定 axes；Flex 换行或
横轴对齐时必须指定 crossAxis，不推测另一个轴。fillFlex 显式指定 gap；fillGrid
指定统一 gap 或同时指定 columnGap/rowGap，紧密填充写零。Grid columns 必填且
没有单列兜底，缺少的行仍由集合长度推导。padding=0、start 对齐、wrap/rotate=false、
径向起始角 0 和整圈 360 保留默认。flex/grid
支持内容尺寸与显式目标空间两种调用形式。无目标时，边界布局从局部零点及 padding
开始；有目标时使用其自身 `.bounds()`。Flex 的主轴 axis、横轴 crossAxis 独立定义，
单行横向对齐可选；wrap 使用逐行主轴分配和行间 alignContent。Grid 先按行列归属
测量 track minimum，再解析 auto/固定/fr 轨道，最后分别对齐轨道与格内模型。
对应 fill 调用复用这些步骤；fillFlex 限单行，fillGrid 计算两个轴的完整网格数量。
带目标空间的结果通过公开 `align(self.frame, space.frame)` 保留目标的完整位姿关系；
目标只参与求解依赖，不作为输出子模型。frame 是独立于几何的坐标系引用，origin
是 frame.origin 的便捷入口。原点引用只约束位置，frame 对齐约束全部六个相对自由度。
全部几何保持固定尺寸，显式轨道或目标空间不能容纳时报告错误。

精确 step 使用 linear，多个轴通过组合 linear 表达；radial 的 rotate 布尔值控制
是否按样本角旋转，额外朝向通过预旋转模型表达。无外部关系时，返回模型原点重合，
直接 group 即保留布局。已有外部关系仍按 Core 组合规则求解，不计入 Layout 的
局部测量；排布装配件时先 group，再对完成布局整体 relate。

公开模型方法 `.bounds(relativeTo?)` 和 `.position(relativeTo)` 与具名引用共用
成员 occurrence 和外部关系的坐标解析，前者测量有限几何，后者只返回模型原点。
