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

页面 UI 将网格图例、源码更新提示、工具操作错误和诊断放入 viewport 左下角的同一个 stack，
图例位于最下方，提示随内容高度向上排列。图例直接观察 sketch 导航派生的格距或
3D viewport 最后实时帧的格距及渲染模式，显示当前视图的小格长度；不保留转发回调
或页面中的镜像读数。图例在空预览和 3D 渲染模式下隐藏。空预览的
坐标指示器退出布局，使 agent 渲染小窗自动使用共享的顶部边距。
工具错误由 ViewportToolFeedback 单独拥有 observable 状态和 DOM 订阅，保留最近一次失败，
可关闭、同类操作成功后清除，切换文件时清除；不再写入编辑器 errorBar 或 sketch output。
拖动预览错误属于手势，释放时确认失败才报告；恢复或取消不弹错。工具不可用只影响可操作性。
sketch 和 3D 的 Arguments 在当前候选参数组列表非空时显示，沿用既有函数上下文和标注解析，
不单独维护第二套显示资格判断；隐藏 dock 不响应快捷键。
sketch 复用 Arguments dock、Alt+1 和设计上下文选择；切换已编译求值也更新 sketch 与面板，
面板层级高于 sketch 画布，3D Render 状态不隐藏 sketch Arguments。

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
解构坐标数组通过签名里的实参/分量路径映射，无法静态定位的数组在数值面板保留
运行值和只读边界，不猜测具体写入位置。省略整个数组或字面量数组中的分量时，
显示注释默认值；面板只允许在下一个合法位置输入，明确输入后才创建数组或追加
分量。数组空位可原位填入，注释与已有分量保留。参数定位同时描述后续分量所需
的前置默认值；空间工具在用户明确拖动后补齐当前调用中全部省略分量。

省略实参与显式 `undefined` 分开。注释默认值只描述面板 placeholder，不改变
TypeScript 必填性、不读取函数初始化器，也不注入运行时默认值。全部省略参数
可以显示默认值，只有下一个合法位置可补写；聚焦、离开或未输入时提交不写源码。
显式输入与 placeholder 相同的数字仍会写成实参；spread 后无法静态映射的位置
不能假装可编辑。内置图元和数值方法的运行时默认值由实现提供，缺参类型诊断仍保留。
模型与关系方法采用相同规则；公开 capability 接口和方法重载保持必填签名，
实现的默认参数与声明注释分别负责真实求值和面板显示，并由回归核对一致性。

没有匹配重载的调用按 TypeScript 恢复候选和声明中的注释决定工具；错误必须属于
当前 callee 或直接参数，不能把外层错误误归当前调用。工具调用即使尚未产生几何
也可显示参数面板。细则与回归见
[tool-parameter-annotations](../../../packages/app/src/model/tool-parameter-annotations.ts)、
[parameter-definitions](../../../packages/app/src/model/parameter-definitions.ts)、
[contextual-tool-parameters](../../../packages/app/src/tools/contextual-tool-parameters.ts)、
[tool-arguments 测试](../../../packages/app/test/tool-arguments.test.ts)。

## 空间与拓扑编辑

空间工具由当前源码操作的可渲染快照提供位置和坐标架；参数省略、未提供注释
默认值或无法定位独立分量均不阻止显示。保留当前操作范围和求解能力边界，不从
一个模型带有关系就推断可以编辑其任意输入。优先修改唯一安全上游；否则对已知
数值实参保留表达式并折叠末尾增量。拖动提交时补齐当前调用中全部省略默认值，
包括拖动已填写或上游参数的情况；补参与参数修改是同一源码事务，可一次撤销。无法定位的
数组或 spread 在明确拖动后将当前操作的输入写成具体求值数值，显式 undefined
则替换该分量。跨实例预览要反映整组参数具体化的实际影响，不能只预测一个轴。
仅查看、零位移或取消不写源码。关系 offset 优先补写已有不完整调用，避免重复
追加；需要新偏移时只追加一次可复用的 offset。预览、写回和正常重新求值使用相同坐标。
后续操作失败不使已完成的当前源码目标失效：按实际 source target 与 evaluation context
判断是否接受新快照，使上游截面等仍可通过 gizmo 修正。当前目标自身失败但仍有
可写工具参数与可渲染输入时，也接受该快照供工具修正，保留真实失败诊断。
没有可用结果或修正入口时保留旧预览，ModelPreviewState 撤销其可编辑版本；不能继续使用旧参数写回。
原点拖动固定手势开始的 snapshot，旋转使用新旧完整旋转的差。
组合输入上下文中选中带关系的成员（含子组合体）时，默认显示平移箭头，按住 Alt 切换旋转环，松开恢复；仅两种工具同时可用时切换。
手势开始后固定模式，平移中 Alt 继续取消吸附，窗口失焦清除按键并取消手势。
工具模式由 observable 按键、绑定与手势状态派生，原生控件显示与拾取共用该模式。
默认工具分别定位关系链中最近的 offset 与 rotate，优先复用其调用而不是只检查链尾。
缺少 rotate 时才在链尾添加绕 self 当前原点和局部轴的旋转；已有 rotate 使用完整
求解结果中的旋转坐标架和现有参数编辑路径，保留 pivot/around、上游表达式与调用顺序。共享指针所有者按实际 binding
创建控件，支持同轴不同模式，同时保留耦合约束的预览能力限制。
默认平移和旋转统一由 model-spatial-tool 的 relationBindings 解析关系与调用，viewport 只消费绑定。
关系工具按保留的 constraint 身份及关系源码范围关联当前可见实例；同一源码多次求值的实例共享编辑，不要求派生后的 nodeId 等于
最初 relate 的 owner；material 等派生值继续使用当前实例的求解坐标架和原调用参数。
选中成员的 pivot 标记复用 model-origin 装饰与 constraint.rotation.origin；拖动时由既有 spatial-preview 接管，取消或结束后恢复，避免重复标记。
坐标细节见[坐标技能](../../skills/code3d-coordinate-semantics/SKILL.md)。

位置拖动按手势开始时的网格小格长度量化沿操作轴的实际位移，再按 sensitivity
反推参数值；以手势开始值为基准，已有非整格数值不会在抓取时跳变。格距、平面和
工具自身的 occurrence 参考架保持到提交或取消，导出也使用同一冻结网格。
Alt 临时取消位置拖动的网格吸附，按下/松开时用原始位移立即更新预览，不需要
额外移动鼠标。文本框继续按自己的 step 调整，显式数字输入保持精确值；旋转
保持已有角度步长，参数合法性仍由工具计划校验。验证见
[网格冻结](../../../packages/app/test/adaptive-grid.test.ts)与
[空间交互回归](../../../packages/app/test/browser/coordinate-semantics.test.ts)。

拓扑 selector 的单选/多选来自参数类型。空调用复用省略实参的写入目标，展示
接收模型的候选，选中后补写 ID；不为必填拓扑参数指定任意默认 ID，也不放宽签名。
`pivotVertex` 在创建关系链前校验 ID 形状，使缺参错误保留在可追踪的调用阶段，
不延迟到快照求解时破坏可编辑输入。fillet/chamfer 的显式过滤数组非空，
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

intersect 输入上下文显示所有操作数的最终共同实体，复用输出网格而不重复计算两两
交集；该网格仍锚定主输入 occurrence，不能使用输出重新求解后的位姿。交集与
union 共用青色效果，拖动时隐藏。无实体交集（含仅接触）由内核提前给出明确诊断，
源码参数继续显示可编辑输入集合。
内联图元等操作的数值工具保留自己的调用身份，同时继承直接外层组合调用的
输入上下文；按源码包含范围和实际 node 身份关联，不把单独定义的图元变量与
所有下游消费混在一起。外层调用失败时也保留其输入集合与当前图元焦点。

批量调用的源码身份由 site/execution 表达，各输出的操作身份另含 output index，
避免 operations Map 覆盖兄弟结果。输入通过 operation.inputs 找到对应输出，同次
调用的操作共享集合上下文。参数引用可使用外层可写工具，内联构造器仍保留自己的
工具；公共尺寸参数为同次调用的每个输出生成几何提示。
extrude 输入预览将对应结果显示为青色，其他结果作为淡灰上下文，各自锚定其源面
的局部坐标。选中输入数组时突出全部结果；交互期间隐藏旧结果，失败保留可编辑
输入集合。这些关联复用公共调用分组与源码选择机制，viewport 不识别 extrude。

loft 参数预览突出当前截面，其他截面和完成形体作为淡灰上下文显示。完成形体的
几何属于第一截面的局部坐标，装饰锚定该输入 occurrence；拖动时隐藏旧结果。
多模型调用失败时，executor 按实际调用及执行次数收集已经求值的输入，以
`nodeIds` 保留集合、`focusNodeIds` 保留当前参数，使用公共组合坐标；不依赖不存在的
结果操作快照，也不按函数名称推测身份。验证覆盖别名、数组与重复调用，以及
[loft 参数绘制](../../../packages/app/test/browser/decoration-coordinates.test.ts)和
[成功/失败切换](../../../packages/app/test/browser/coordinate-semantics.test.ts)。

几何归属、操作输入角色与当前关注侧分别保留，不能借用输出位姿显示输入几何。
模型和拓扑引用的绘制使用可见 occurrence 的正确变换。具体颜色、屏幕尺寸、
关系层级和 CAD/PNG 显示边界由[可视化技能](../../skills/code3d-visualization/SKILL.md)维护。

[自适应网格](../../../packages/app/src/rendering/adaptive-grid.ts)与 sketch 共用
[格距计算](../../../packages/app/src/grid-scale.ts)，只绘制当前档位的小格与主间隔，
不混合不同格距。网格和坐标指示器统一使用当前渲染场景的坐标：单模型或 group 的
局部坐标，以及集合或关系上下文的公共组合坐标。snapshot 根节点已经表达该坐标，
不再从选中 occurrence 提取位姿；高亮成员与成员的实时变换不改变网格或导航轴。
操作手柄仍使用各自所属的参考架。透视使用 XZ 工作平面；正交使用场景中最朝向
相机的主平面，中心线使用实际轴向颜色。程序化平面保留真实深度遮挡，
上传 GPU 前约减周期坐标以支持大幅
平移；图片导出更新自己的相机和尺寸，结束后恢复实时网格。
图例强调主间隔中的第一个小格，数字为该小格的模型长度；固定图示解释细分关系，
不暗示透视下屏幕各处具有相同比例。验证见
[网格绘制](../../../packages/app/test/browser/adaptive-grid.test.ts)。

## 编辑器状态与诊断

语法着色由 Monaco 的 tokenizer 和可见行调度负责，与 TypeScript Worker 诊断、
未使用变量淡化和括号配色分别运行。Monaco 0.56 的初次渲染没有登记可见行，
空闲任务延迟时新文件会一直使用空 token；Sticky Scroll 又可能读取视口外的
未分词表头。[Monaco 补丁](../../../patches/monaco-editor+0.56.0.patch)在渲染准备
阶段登记稳定可见行，固定行通过独立的 tokenization view 登记实际显示的行，
复用同一套前台分词调度。该视图由固定行 widget 创建，在隐藏、切换模型或销毁时
释放，不增加模型的编辑器挂载计数。内容修改会失效同一
可见范围和固定行的缓存；可见范围末行恰好是首个失效行时也必须重新分词，涵盖
单行文件。正文与固定行均沿用 Monaco 的可见范围启发式分词，由后台补全准确的
跨行词法状态；远距离跳转不为固定行同步补算整段前文，不在 App 中维护 token
镜像或轮询刷新。
升级 Monaco 时核对并移除上游已解决的补丁。验证见
[编辑器着色回归](../../../packages/app/test/browser/editor-tokenization.test.ts)：
暂停 idle callbacks，检查新文件、单行文件、切换标签、修改内容及滚动到尚未显示
的固定行的实际 DOM 颜色，同时检查固定行隐藏、模型切换和编辑器销毁后的资源
释放，以及跳转时不分词无关前文。

文件树选择、活动标签、源码光标、临时预览和最后成功模型分别维护。关闭最后一个
tab 后允许无活动文档，保留文档内容、撤销和视图状态以便重开；过期编译结果不能
恢复已关闭的预览。空程序或无模型输出是合法结果，不制造 Model error。
[ModelPreviewState](../../../packages/app/src/model/preview-state.ts)管理各文件的预览
生命周期，并以 MobX 派生加载提示、初始提示与交接期间的交互状态。切换模型文件
时立即失效旧文件的编辑结果，但保留现有 3D/sketch 画面，直到新文件及其选定设计
上下文准备好后一次替换；等待期间旧视图不可交互，不记作新文件已预览。新结果
为空或编译失败后清空旧画面，关闭全部文件、打开非模型文件和项目重置立即清空。
同类视口仍可见时继续过渡，跨类型及空视图直接进入；快速切换时忽略过期结果与
进度。相关验收见 [文件切换回归](../../../packages/app/test/browser/preview-file-switch.test.ts)。
有选定但失败的工具调用时仍可显示修正入口。

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
