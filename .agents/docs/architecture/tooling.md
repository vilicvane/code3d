# 源码与交互工具

工具把输入转换为编辑意图，源码事务把意图变成持久修改。视口、Monaco、内核和
具体工具各自承担职责；工具不直接修改模型对象或另一套 GUI 历史。

## 源码目标与运行实例

每个 SourceRef 包含文件路径和文件内范围，不能脱离文件解释 offset。源码追踪
区分声明、表达式、operation receiver、参数和运行实例。同一源码位置多次求值
保留独立 execution；同一 context 中默认使用最近触达的值。

源码及调用输入按真实求值追踪，普通函数、别名、namespace、数组和对象成员都
遵循该路径；不靠列举建模 API 名称建立关联，也不为追踪主动求值 getter。
调用失败仍保留已求值的 receiver、实参、provenance 和触达顺序，允许工具修正
失败调用本身。能预览模型不自动意味着拥有参数面板或空间手柄。

Caret 决定源码 context；点击当前 focus 中的模型只细化运行实例，点击弱化的
operation peer 导航到该输入源码。源码节点的一次求值返回集合时保留集合语义，
多次执行的结果不成为多份源码。模型值的局部预览与集合/关系的组合位置分别解释。
Elements 等面板的临时 hover 预览不改变作者源码或 source-active 身份。

源码编辑期间，[source-ref](../../../packages/app/src/tools/source-ref.ts)追踪旧快照
对应范围，使下一版编译到达前的工具仍有正确 anchor。来源及关系语义见
[operation-context](../../../packages/app/src/model/operation-context.ts)、
[constraint-context](../../../packages/app/src/model/constraint-context.ts)、
[evaluation-trace 测试](../../../packages/core/test/evaluation-trace.test.ts)。

Monaco 补全候选的预览把候选编辑应用到临时项目快照，再走正常编译和选取路径。
真实源码、光标、撤销和文件版本不变；临时结果只用于视口，不替换工具所用的
已接受模块，也不允许拾取写回。切换候选丢弃旧请求，关闭补全恢复实际源码的
预览；具名元素可先用已接受模块显示即时高亮。入口见
[编辑器补全适配](../../../packages/app/src/editor.ts)及
[补全回归](../../../packages/app/test/browser/completion-language.test.ts)。

## 意图、计划与事务

[tool-system](../../../packages/app/src/tools/tool-system.ts)定义 ToolIntent、resolver、
ToolEditPlan、ToolSession 和 host 边界。参数、表达式、实参、拓扑选择、空间操作和
草图编辑共用这条路径，完整意图类型以源码为准。

1. 工具输入产生意图，resolver 结合当前 source anchor、scope 和 provenance 解析。
2. 计划包含源码版本、expected text、修改集合、摘要和可选临时预览。
3. host 提交前重新核对版本及所有编辑片段；不能安全应用时拒绝，不猜测新目标。
4. 一次逻辑操作写回源码并复用 Monaco undo stack，成功后展示实际文本差异。

会话开始时固定交互范围和预览基准，preview 不修改源码；commit 使用追踪后的
最新 anchor，cancel 清除临时状态。参数预览要覆盖全部受影响的运行实例，不能
只移动鼠标下的一个实例却修改共享变量。

跨文件编辑先完成全部校验，再应用逻辑源码事务；各文件的 undo 仍属于其编辑器
历史。文件系统持久化的队列和失败语义见[运行时](runtime.md#文件与项目状态)。
通用事务不等于任意磁盘写入的原子回滚。

差异提示由真实编辑前后文本生成，同一行多处修改只计一次，不按替换的 AST 大小
推算行数。只有用户点击差异行才导航源码；提示保留悬停/焦点，后续源码变化关闭
过期内容。GUI 聚焦时的撤销转发给活动文档且不抢焦点，Monaco 和输入框保留
原生编辑行为。验证见 [source-edit-diff](../../../packages/app/test/source-edit-diff.test.ts)、
[source-edit-popover](../../../packages/app/test/browser/source-edit-popover.test.ts)。

页面 UI 将网格图例、源码更新提示和诊断放入 viewport 左下角的同一个 stack，
图例位于最下方，提示随内容高度向上排列。3D viewport 与 sketch 只通知格距变化，
共用图例显示当前视图的小格长度；图例在空预览和 3D 渲染模式下隐藏。空预览的
坐标指示器退出布局，使 agent 渲染小窗自动使用共享的顶部边距。

## 参数与注释

`@code3d.param` 从实际调用签名读取参数 kind、约束和默认显示值，可用于函数、
方法及公开 callable 变量。类型、重载、导入和发布后的声明共用分析路径；变量
本身不携带独立参数元数据。`@code3d.arguments` 提供函数的设计时求值上下文，
不改变正常源码执行或导出，注释里的表达式在所属词法范围内求值。

签名解析使用 TypeScript 的实际定义链，支持唯一可追踪的别名、属性、解构和
简单算术映射。不能因表达式中只有一个数字就把它当作可修改上游。数值面板、
gizmo 和参数高亮共用参数定位及[候选策略](../../../packages/app/src/tools/parameter-policy.ts)。

可唯一反向编辑的参数显示并修改来源。无法唯一反向编辑的整个调用实参以运行时
结果作 placeholder，用户明确输入时替换整个表达式；不能在预览时悄悄替换。
解构坐标数组通过签名里的实参/分量路径映射，无法静态定位的数组保留运行值和
只读边界，不猜测具体写入位置。

省略实参与显式 `undefined` 分开。注释默认值只描述面板 placeholder，不改变
TypeScript 必填性、不读取函数初始化器，也不注入运行时默认值。全部省略参数
可以显示默认值，只有下一个合法位置可补写；聚焦、离开或未输入时提交不写源码。
显式输入与 placeholder 相同的数字仍会写成实参；spread 后无法静态映射的位置
不能假装可编辑。内置图元的运行时默认值由函数实现提供，缺参类型诊断仍保留。

没有匹配重载的调用按 TypeScript 恢复候选和声明中的注释决定工具；错误必须属于
当前 callee 或直接参数，不能把外层错误误归当前调用。工具调用即使尚未产生几何
也可显示参数面板。细则与回归见
[tool-parameter-annotations](../../../packages/app/src/model/tool-parameter-annotations.ts)、
[parameter-definitions](../../../packages/app/src/model/parameter-definitions.ts)、
[contextual-tool-parameters](../../../packages/app/src/tools/contextual-tool-parameters.ts)、
[tool-arguments 测试](../../../packages/app/test/tool-arguments.test.ts)。

## 空间与拓扑编辑

空间工具只在源码确实提供相应操作范围时启用，不从一个模型带有关系就推断
可以编辑其任意输入。优先修改唯一安全上游；否则保留完整表达式并折叠末尾位移
增量，必要时追加一次可复用的 offset。预览、写回和正常重新求值使用相同坐标。
原点拖动固定手势开始的 snapshot，旋转使用新旧完整旋转的差。
坐标细节见[坐标技能](../../skills/code3d-coordinate-semantics/SKILL.md)。

位置拖动按手势开始时的网格小格长度量化沿操作轴的实际位移，再按 sensitivity
反推参数值；以手势开始值为基准，已有非整格数值不会在抓取时跳变。格距、平面和
occurrence 参考架保持到提交或取消，导出也使用同一冻结网格。
Alt 临时取消位置拖动的网格吸附，按下/松开时用原始位移立即更新预览，不需要
额外移动鼠标。文本框继续按自己的 step 调整，显式数字输入保持精确值；旋转
保持已有角度步长，参数合法性仍由工具计划校验。验证见
[网格冻结](../../../packages/app/test/adaptive-grid.test.ts)与
[空间交互回归](../../../packages/app/test/browser/coordinate-semantics.test.ts)。

拓扑 selector 的单选/多选来自参数类型。fillet/chamfer 的显式过滤数组非空，
取消最后一个选择删除过滤实参并恢复全部边语义；全部边模式不伪装为显式全选。
无效的旧输入 ID 不进入可选集合。同一轮交互合并撤销；离开源码调用结束面板，
Esc 优先取消尚未提交的拖动，不撤销已提交的选择。

参数高亮按当前调用实参定位，不能按上游变量把所有用途高亮。尺寸语义由操作
快照声明，viewport 从真实几何中选取提示；未声明语义的参数不按名称猜测。
Tab 跳转沿同一 source ref 聚焦有效参数输入，保留补全、snippet 和原生编辑器
快捷键的优先级。验证见 [spatial-tools](../../../packages/app/test/spatial-tools.test.ts)、
[parameter-highlight](../../../packages/app/test/browser/parameter-highlight.test.ts)、
[parameter-tab](../../../packages/app/test/browser/parameter-tab.test.ts)。

## 装饰与显示

[ViewportDecoration](../../../packages/app/src/viewport-decoration.ts)表达辅助几何，
每条记录声明所属模型和局部变换，由 host 按 owner 应用/清理图层。viewport 消费
数据，不识别具体建模操作或具名元素名称。

[Source decoration providers](../../../packages/app/src/model/source-decorations.ts)读取
运行时操作元数据，按源码范围产生装饰；精确 Boolean region 由内核计算，provider
决定显示方式。交互期间需要隐藏旧 region 的 provider 声明对应策略，取消恢复，
提交后等待新编译。App 和网站图片渲染共用同一路径。

几何归属、操作输入角色与当前关注侧分别保留，不能借用输出位姿显示输入几何。
模型和拓扑引用的绘制使用可见 occurrence 的正确变换。具体颜色、屏幕尺寸、
关系层级和 CAD/PNG 显示边界由[可视化技能](../../skills/code3d-visualization/SKILL.md)维护。

[自适应网格](../../../packages/app/src/rendering/adaptive-grid.ts)与 sketch 共用
[格距计算](../../../packages/app/src/grid-scale.ts)，只绘制当前档位的小格与主间隔，
不混合不同格距。透视使用 XZ 工作平面；正交使用当前参考架中最朝向相机的主平面。
网格跟随坐标指示器的世界或 occurrence 原点和朝向，不继承实例缩放，中心线使用
实际轴向颜色。程序化平面保留真实深度遮挡，上传 GPU 前约减周期坐标以支持大幅
平移；图片导出更新自己的相机和尺寸，结束后恢复实时网格。
图例强调主间隔中的第一个小格，数字为该小格的模型长度；固定图示解释细分关系，
不暗示透视下屏幕各处具有相同比例。验证见
[网格绘制](../../../packages/app/test/browser/adaptive-grid.test.ts)。

## 编辑器状态与诊断

文件树选择、活动标签、源码光标、临时预览和最后成功模型分别维护。关闭最后一个
tab 后允许无活动文档，保留文档内容、撤销和视图状态以便重开；过期编译结果不能
恢复已关闭的预览。空程序或无模型输出是合法结果，不制造 Model error。
[ModelPreviewState](../../../packages/app/src/model/preview-state.ts)管理各文件的预览
生命周期；有选定但失败的工具调用时仍可显示修正入口。

布局偏好与受窗口限制后的实际尺寸分开，临时缩窄不能覆盖用户宽度；取消分隔条
拖动恢复手势前偏好。Pierre 的虚拟列表、滚动空间和 portal 菜单使用真实视口
尺寸，不能把同步回调当作异步文件事务。验证见
[editor-layout](../../../packages/app/test/browser/editor-layout.test.ts)、
[editor-tabs](../../../packages/app/test/browser/editor-tabs.test.ts)、
[project-explorer](../../../packages/app/test/browser/project-explorer.test.ts)。

相机状态归属当前显示的模型实例或集合，切换源码 context 与细化实例不能混用
全局相机记录。交互预览不重置视角；相同根的参数编辑保持视角，新的显示范围
才按对应规则恢复或初始化。相机与导航细节由
[viewport-navigation](../../../packages/app/src/ui/viewport-navigation.ts)及
[viewport-memory 回归](../../../packages/app/test/browser/viewport-memory.test.ts)维护。

点击坐标轴端点进入原生正交投影；实际旋转视图才恢复透视，平移、缩放和空间工具
拖动保留投影。导航分别管理操作相机与显示相机，投影过渡联动距离和 FOV，保持
焦平面比例；恢复透视期间操作相机继续响应拖动。轴选择沿用视角切换过渡，拖动
引起的镜头恢复使用更短过渡；中断从当前显示状态继续，减少动态效果偏好跳过动画。
裁剪和雾范围随虚拟视点平移；拾取、坐标指示器、TransformControls、固定像素
标记与截图使用显示相机，工具不得缓存已替换的相机。视图记录包含投影模式、
过渡中的透视强度及焦平面可见高度，缩放动画和临时预览恢复沿用同一份状态。
验证见 [相机导航](../../../packages/app/test/browser/camera-navigation.test.ts)与
[相机计算](../../../packages/app/test/view-camera.test.ts)。

诊断从最内层求值边界附上原 SourceRef，外层不覆盖已有精确位置。源码诊断进入
Monaco marker，无法归属源码的项目/Worker 错误才使用全局入口；安装失败由包
状态处理。成功求解的草图 warning 及修复 actions 使用同一诊断与事务接口，
具体作用域和安全写回见[草图](sketch.md#诊断与源码同步)。
