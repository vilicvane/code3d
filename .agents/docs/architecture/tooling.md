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
`@code3d.tool` 显式登记没有数值/拓扑 ID 参数的工具调用；pivotPoint/axisLine 的点线引用由空间参考选择器编辑，不能误标为接收 edge ID 的参数。

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
ModelPreviewState 保留当前请求返回的完整源码结果及诊断，接纳不依赖编译完成时的光标。
视口将当前语义焦点与原生几何资源分开：当前焦点具有已完成结果、可修正参数或可靠
self 前置预览时显示该目标。同一文件的新结果没有可用视图时，可保留上一版本画面，
同时撤销旧结果的选择、装饰、手柄与导出入口。光标仅移到当前源码的非目标区域时，
保留当前模型选择与画面，清除源码工具焦点；再次进入目标时恢复对应求值实例。
随后移动光标直接查询已保留的当前结果，不靠重新编译才能恢复工具。只有编译未返回
结果的准备/执行服务错误才撤销结果的可编辑版本。
视口的 sourceContext 由模块、当前目标及求值实例派生；参数面板、gizmo 和候选共同消费
此上下文。模块、源码锚点注册与视图替换在同一 action 发布，删除光标和编译路径里
各自手动刷新面板的入口。参数组由 contextualToolContext 纯派生，源码参数焦点使用
原始实参范围（包括顶点/边 ID），不拿可编辑上游变量范围替代。仅参数列表范围触发
输入高亮；方法名只激活工具。表单会话只保留编辑草稿及 Undo 历史，选择器、偏移、
角度之间移动光标不创建另一份旋转工具。

XYZ 距离输入 step 消费当前网格小格，以参数实参值为单位，与空间拖动一致；方向键
从当前输入值增减一个步长，不跳到绝对网格倍数。缩放只更新步长，不重建输入或覆盖
草稿。角度保留角度步长。

原点拖动固定手势开始的 snapshot，旋转使用新旧完整旋转的差。
空间工具栏位于参数面板上方，区分平移、绕点旋转、绕轴旋转；两种旋转复用草图的
记忆变体菜单。工具选择、Alt / Shift 和手势状态由 TransformGizmo 持有，显示与拾取消费同一
派生绑定组。手动选择归属当前文件、完整工具调用和求值实例；当前上下文改变即结束该选择，
同链选择器/角度移动和重新求值保持选择。工具栏高亮、参考候选与 gizmo 使用同一派生工具。
普通模型、self 与数组空白上下文只提供可用工具，不默认选择首个 binding；明确源码工具
通过 attach 提供默认选择，手动工具选择优先。CodeEditor 将原生光标与焦点投影为单一
状态，参数焦点和失焦静态光标分别派生。组件持有被动源码 decoration 订阅，消费当前
sourceContext 与实际 toolBinding，标记已存在的调用及统一旋转链，不标记插入锚点或
上游参数变量，被动刷新不改变真实选区和 DOM 焦点。新源码经既有事务与 sourceRef 重定位后更新标记。
显式点击工具通过 activateSourceTool 走同一源码导航入口：已有调用定位完整表达式末尾（offset()|、axisEdge().rotate()|），
缺少调用则从实际 binding 写入锚点定位插入前的步骤，数组光标落在对应空白处
（末尾为 ] 前），不借用前一调用的 identifier。模型、参数和手柄立即使用该阶段。
导航前后在同一 action 内保留用户选择的工具，避免源工具的默认选择覆盖新增工具。
保留求值实例与 viewport DOM 焦点；不从 decoration autorun 反向导航，也不为点击编译新模型。
激活描述使用已登记的 sourceRef，先重定位完整范围再将光标放到末尾；导航命令携带
该 sourceRef 区分无尾逗号数组中重叠的调用末尾和插入点，重新编译沿现有语义焦点保留选择，
不构造源码追踪表中不存在的零宽范围。数组空白只显示光标，不高亮邻接的 identifier。
原生光标在下一条表达式起点时属于该表达式，例如 |self.axis.align(...) 仍按 self 查找工具。
`contextualToolSource` 统一提供参数、拓扑与空间工具的调用范围；`observeSourceContext`
消费其范围并维护标记及自动滚动，范围未变化的刷新不会重置用户滚动。所有带定位信息的
SourceTextEdit 都由编辑器源码事务定位和滚动，不在具体工具中重复实现。Monaco 失焦时
只重定位光标 marker 而不恢复历史光标；编辑器订阅原生内容事务的 resultingSelection
恢复失焦 undo/redo，复用同一历史，不模拟 DOM 焦点或建立第二份撤销记录。这个适配依赖
Monaco 内部事务事件（公共 content event 不含该字段），升级 Monaco 时由浏览器回归验证。
自动定位统一落在本次修改的调用 identifier 后、左括号前：改顶点选择器定位 pivotVertex，
改角度定位 rotate，不用最后一个参数作为任意锚点。声明生成调用的 resolver 通过
SourceTextEdit.focusOffset 提供语义位置；普通实参修改由编辑器沿 AST 定位所属调用，
上游变量修改回到当前操作。源码事务负责坐标换算、滚动和 undo/redo。
选择器关联比较编译器记录的方法范围，避免 namespace 前缀导致完整链被误判为草稿。旋转工具中 Alt 临时移动对应的 pivot/axis，松开恢复对象旋转；手势开始后
固定操作，不影响吸附；平移工具不响应 Alt。SpatialToolbar 持有短期参考选择会话，
由当前旋转工具派生候选模式，自动显示顶点、原生直边及当前模型命名轴，
点选不依赖 Alt，松开 Alt 仍保留候选。候选与参考平移 gizmo 共存，手柄优先拾取，拖动期间保持已开始的操作。
选择器与最终 rotate 通过编译期接收者范围关联为一个工具；光标选中统一到最终旋转，
面板合并各选择器与角度参数，并保留每个参数原有写回来源。未完成选择器同样立即显示完整面板；编译期提供整段调用的签名和参数范围，未执行部分可显示直接数值字面量，缺少 rotate 则显示零角度。角度编辑沿现有参数状态与空间源码事务补齐 rotate，重新求值后接续普通旋转工具；不另外维护一份模型姿态。
工具激活由 contextualToolActivation 统一解析：当前调用匹配则保留，否则只取后面最近
一项 transformation 再比较工具类型；匹配则导航，不匹配则在它之前插入，不能跳过
其他类型继续查找。绑定构建只负责编辑当前语义目标，不再搜索其他调用。现有旋转
保留其参考、上游表达式与调用顺序。共享指针所有者按实际 binding
创建控件，支持同轴不同模式，同时保留耦合约束的预览能力限制。
源码事务成功后，已存在且可准确预览的空间数值操作按提交结果更新参数和参考架，
保留同一操作的连续编辑。pending 绑定限定当前 occurrence 与源码目标，不能把一次
操作的 committed spatial 用于同对象的另一操作。新增调用或省略参数首次补全等待重算；
格式化或撤销导致源码锚点失效时停止拾取。新的模型替换 pending 事实；手势开始会取消
旧编译代次，旧结果不能中断手势。取消与无变化不进入等待。
旋转参考修改使用完整 callRef，普通参数仍使用精确参数范围；完整调用与构造器导入
共同进入源码追踪，避免只改 rotate 方法段而重复插入选择器。pivotOffset/axisOffset
保留引用和表达式，GUI 重复修改同一个偏移调用。坐标 pivot 的拖动直接修改
pivot 坐标；默认中心第一次移动生成 pivot([...])，引用中心才添加 pivotOffset。
独立变换的插入位置、可用构造器和导入修改在编译阶段基于已解析 AST 计算，
通过调用位置元数据传给执行线程，包含没有数值工具面板的 on/align 调用；
执行线程只读取元数据，不能引入 TypeScript 解析器。
平移和旋转统一由 model-spatial-tool 的 transformationBindings 解析独立变换与插入位置，viewport 只消费绑定。
变换工具按保留的 transformation 身份及源码范围关联当前可见实例；同一源码多次求值的实例共享编辑，不要求派生后的 nodeId 等于
最初 relate 的 owner；material 等派生值继续使用当前实例的求解坐标架和原调用参数。
空间参考标记由 viewport 的单个响应式装饰投影拥有，读取当前源码上下文、工具及每个 occurrence 的空间预览；拖动预览与已提交但等待重算的结果共用 model-origin provider，不另建预览标记层，也不手动恢复旧点。取消时退回最近已提交的预览，新模型替换时清除旧预览。原点随平移几何移动，修改原点及旋转参考使用对应操作坐标架；循环实例分别投影，不能按 node ID 合并。连续编辑重基 gizmo 绑定时保留当前工具类型。后续手势暂停编译时保留交互更新状态，取消后继续完成先前已提交的更新，不能提前恢复 Ready。origin 是黄绿色十字加中心点，pivot 是橙色圆环加中心点，圆环始终朝向屏幕。尚未写入旋转调用的插入位置也按已激活工具生成参考：绕点使用当前 self 的默认 pivot，不能回退为 origin 或借用前一旋转中心；Alt 只切换手柄。绕轴在选轴前不生成参考标记。
坐标细节见[坐标技能](../../skills/code3d-coordinate-semantics/SKILL.md)。

位置拖动按手势开始时的网格小格长度量化沿操作轴的实际位移，再按 sensitivity
反推参数值；以手势开始值为基准，已有非整格数值不会在抓取时跳变。格距、平面和
工具自身的 occurrence 参考架保持到提交或取消，导出也使用同一冻结网格。
位置拖动始终网格吸附，包括按住 Alt 切换到参考平移后开始的手势。Shift 使用大格
位移（5 个小格）或相对手势起点的 15° 实际转角；先量化，再按 sensitivity 反算，
不把 15 当作源码参数步长。网格 shader、图例和吸附共用 grid-scale 的大格比例。
Shift 可在拖动中切换，由当前手势的原始 delta 重新量化，不累加舍入，也不重设起点；
键盘切换即时更新预览，指针事件同步修饰键，非所属指针不影响手势。失焦先取消，
再清理按键，避免产生额外预览。Alt 固定当前操作，Shift 独立控制其吸附精度。
XYZ 距离文本框按当前网格小格调整 step，显式数字输入保持精确值；普通旋转
保持已有角度步长，参数合法性仍由工具计划校验。验证见
[网格冻结](../../../packages/app/test/adaptive-grid.test.ts)与
[空间交互回归](../../../packages/app/test/browser/coordinate-semantics.test.ts)。

拓扑 selector 的单选/多选来自参数类型。空调用复用省略实参的写入目标，展示
接收模型的候选，选中后补写 ID；不为必填拓扑参数指定任意默认 ID，也不放宽签名。
`pivotVertex` 在创建旋转选择器前校验 ID 形状，使缺参错误保留在可追踪的调用阶段，
不延迟到快照求解时破坏可编辑输入。fillet/chamfer 的显式过滤数组非空，
取消最后一个选择删除过滤实参并恢复全部边语义；全部边模式不伪装为显式全选。
无效的旧输入 ID 不进入可选集合。同一轮交互合并撤销；离开源码调用结束面板，
Esc 优先取消尚未提交的拖动，不撤销已提交的选择。

参数高亮按当前调用实参定位，不能按上游变量把所有用途高亮。尺寸语义由操作
快照声明，viewport 从真实几何中选取提示；未声明语义的参数不按名称猜测。
编辑器将原生单光标、选区及文本焦点投影为 observable 参数定位输入；面板从当前
view 与 sourceParameterAt 派生对应的参数。数值输入和拓扑选择摘要均声明参数名并消费同一高亮目标；
数值输入与选择摘要均使用亮色边框；可 Tab 的当前文本框右侧在边框内显示亮色圆角 Tab 提示，
真实输入焦点接替后隐藏提示。Tab 复用定位结果，只聚焦可写文本输入，选择摘要不改变编辑器 Tab 行为。
高亮仅更新样式，不重建输入节点或覆盖草稿。失焦、非空选区、多光标和没有对应控件的参数
取消提示，面板销毁时释放订阅。Tab 保留补全、snippet 和原生编辑器快捷键的优先级。验证见 [spatial-tools](../../../packages/app/test/spatial-tools.test.ts)、
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

项目语言快照区分真实依赖文件与声明映射的导航文件，并显式传递当前项目根文件。
Monaco Worker 不再把 mirror models 和全部 extra libs 当作根文件；生成的 tooling
导入单独提供为编译根，不进入用户文件快照。真实引用的声明继续参与类型解析，
并遵循 App 的 `skipLibCheck`；仅沿声明映射打开的源码不参与项目检查，也不能
通过全局声明污染用户程序。用户直接导入该源码后，它按真实依赖参与检查。
诊断按当前 TypeScript Program 的文件归属产生，不按 node_modules 或只读属性屏蔽。

项目外源码的悬停、补全和继续跳转使用同一 Worker 内独立的导航语言服务，
以当前查询文件为根；切换导航根时释放旧服务，共享文件快照但不共享用户项目的
Program。CodeEditor 排除仅导航文件的编译/执行输入，只读状态由项目语言快照、
当前路径和操作锁派生，autorun 同步 Monaco，销毁时释放订阅。只读文件中的真实
错误仍显示波浪线，保持正文、标签和文件树一致。验证见
[项目语言快照](../../../packages/app/test/project-language.test.ts)、
[语言服务边界](../../../packages/app/test/browser/completion-language.test.ts)和
[真实包导航](../../../packages/app/test/browser/package-install.test.ts)。

语言依赖加载期间只发布语法诊断。CompilerClient 以 observable 快照表示当前编译的
语言环境：开始编译、刷新或重建编译 Worker 时失效，只有当前请求的语言消息可以
重新发布；装配层 autorun 将其同步到 CodeEditor，编辑器销毁时释放。编辑器保留
上一份文件快照供补全与导航使用，就绪标记经 extra libs 同步给语言 Worker，
不通过切换 Monaco 诊断配置重启 Worker。包内容失效后的不完整快照同样标记未就绪。
语义、建议和编译选项诊断等待就绪，真实加载失败仍由原有包/模型错误通道展示。

Monaco 诊断适配器的补丁在每个异步边界核对文档版本、extra libs 快照和文档订阅
身份。依赖更新事件尚未派发时，快照身份也会立即失效；内容修改、语言配置更新及
销毁前发出的旧请求不能回写标记。验证见
[语言就绪与迟到诊断](../../../packages/app/test/browser/language-readiness.test.ts)。

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
标记与截图使用显示相机，工具不得缓存已替换的相机。Arcball 的 _upState 按相机绝对四元数参与旋转，
因此每次交接相机使用局部 Y 作为参考；不能把新相机已有的世界 up 再旋转一次，否则
开始工具拖动时 reset/lookAt 会改变画面朝向。视图记录包含投影模式、
过渡中的透视强度及焦平面可见高度，缩放动画和临时预览恢复沿用同一份状态。
验证见 [相机导航](../../../packages/app/test/browser/camera-navigation.test.ts)与
[相机计算](../../../packages/app/test/view-camera.test.ts)。

编辑器诊断由 ModelPreviewState 按执行入口保存最近结果，与当前预览的状态提示分开。
切换到依赖文件不会清空原入口的错误；同一入口重新执行后替换其结果，源码修改、
文件操作和项目重载时清空过期诊断。CodeEditor 的每个文档通过 autorun 消费该派生
列表，按位置与消息去重；按需打开的子模块立即得到已有标记，移除文档时释放订阅。
CodeEditor 从 Monaco 的非运行时 Error/Warning markers 与入口诊断派生 diagnosticCounts，
逐文件分别统计 errors/warnings，不计 Hint/Info。运行时诊断按位置、严重级别和消息去重，
包含尚未打开的文件，打开后排除其 Monaco 镜像，避免重复计数。
tab 持有可销毁的 autorun，只更新颜色、总数和辅助说明；名称与总数采用最高严重级别，
错误红色、仅警告黄色，悬浮说明分别列出两类数量。ProjectTree 使用同一统计响应式更新
行装饰及 shadow stylesheet，父目录汇总后代错误/警告并以最高严重级别显示小点。
诊断位、剪切标记、agent 活动位依次排列，活动小点保留各 agent 颜色，前三个之后显示
`+N`；全部 agent 名称进入悬浮说明。目录无论折叠或展开都汇总后代活动，与诊断汇总
保持一致；展开时目录和对应文件同时保留活动。错误清除后可降级为警告，
诊断清空不影响 agent 活动。
验证见[运行时诊断](../../../packages/app/test/browser/runtime-diagnostics.test.ts)。

新建条目借助 Pierre 的临时行与内联重命名输入框，磁盘操作仍由项目会话执行。
ProjectTree 接管创建输入的确认、取消和校验，因为 Pierre 的 rename 只接受同目录 basename，
且名称不变时不触发回调。Enter 或失焦确认、Esc 或空白取消；文件选区排除最后一个扩展名，
支持 `/` 路径及自动创建父目录。暂存行不进入项目文件快照，取消或页面销毁时移除；
常规重命名仍使用 Pierre 原生路径。验证见[文件浏览器](../../../packages/app/test/browser/project-explorer.test.ts)。

诊断从最内层求值边界附上原 SourceRef，外层不覆盖已有精确位置。源码诊断进入
Monaco marker，无法归属源码的项目/Worker 错误才使用全局入口；安装失败由包
状态处理。viewport 诊断卡片仅接受显式 `viewport: 'sketch-source-sync'` 的草图同步提示，
不再因模型关联或阶段预览失败而展示普通异常。顶部状态独立按求值归属判断错误，
不依赖卡片白名单；交互提交错误仍使用单独的工具反馈条。
ModelPreviewState 的 statusDiagnostic 从当前 presentation 派生，顶部 Model error
使用它显示原生 tooltip，并在有 sourceRef 时支持点击/Enter/Space，复用 revealSource 跨文件定位。
忙碌或恢复 Ready 时同步移除详情和跳转资格，不保存另一份待跳转错误。成功求解的草图 warning 及修复 actions 使用同一诊断与事务接口，
具体作用域和安全写回见[草图](sketch.md#诊断与源码同步)。

工具源码提交经 editor change 进入 ModelPreviewState 的同一活动状态，标记本次更新需要
连续反馈；排队和编译阶段空当显示 Updating model，预览阶段也不延迟隐藏。最终呈现或失败
恢复终态时结束该反馈，下一次普通文本输入仍沿用延迟提示。顶部模式与状态控件各自固定
高度，状态显隐不拉伸模式按钮。工具栏平移用带原点的二维双轴，绕点用实心中心点，绕轴用
同一带箭头圆弧和穿过中心的虚线轴。

### Drag value readout

`TransformGizmo.dragPreview` and `SketchEditor.dragPreview` derive numeric readouts
from their active gestures, observed by the shared `ToolDragPreviewView`. Initial
values stay fixed for the gesture; current values use snapped source parameters
for 3D and solved geometry for sketch point/radius edits. Gesture completion or
cancellation removes the readout, including asynchronous sketch solves that finish
after release. The contextual panel and readout share a flex stack; hidden panels
consume no space. Both containers share their width, padding, border, translucent background,
backdrop blur and shadow, and each readout row uses
`field: old + delta = new` with a signed operator and the unit after the result. No synthetic source tool or second preview value store is needed.

## relate 变换工具的源码目标

整个 `relate(...)` 源码范围都提供空间工具入口，包括 self.axis、约束目标侧、回调块体
及内部表达式；嵌套调用归最内层 relate 的 self。工具栏可用性从所属 relate 派生，
不依赖当前关注几何的 gizmo 绑定，不默认选中工具。具体表达式继续决定参数面板、
轴面高亮和预览；点击工具才以显式工具类型执行一次源码导航，激活 self 的变换。
编译结果关联实际 self 源码目标，回调内部表达式沿所属调用及执行实例解析；约束、
变换与数组空白保留各自阶段和插入语义。首次新增变换时把单个返回值转换为数组，
不恢复约束链式写法。源码标记仅消费当前焦点，不负责派生或触发工具激活。

`offset`/`rotate` 保留调用顺序和每个调用的 sourceRef。选择 self 时展示完整摆放段，
工具栏先保留匹配的当前调用，否则比较紧随其后的第一项 transformation：匹配就
激活该项，不匹配或没有则紧接当前位置插入。self 从共同求解的约束组之后开始；
不能跳过不同类型的 transformation 或跨过后续约束段。
阶段快照由 Core 保留继承及同回调的其他关系，联合求解后提供；当前关系的高亮
不把求解限制为单条约束。独立变换使用联合求解后的阶段坐标架进行 gizmo 预览。

每次位移、旋转均提供自身的阶段坐标架。工具激活后显示当前调用或实际插入位置之前的
阶段，不包含后续操作；参数预览按各次 offset 的 frame 分别计算，不将整链位移累加后
套用一个 frame。旋转中心同样使用当前阶段的参考。预览、源码写回、正常
求值和 Undo 必须一致；共享参数涉及不同调用时改当前表达式，不能借修改参数
同时改变另一操作。内部实现不维护另一份独立的模型摆放状态。

### 独立 Transformation 与分段工具

Core 快照的 relationStages 提供分段边界，transformations 保留动作的 sourceRef 和结果架。contextualToolActivation 是已有调用与插入位置的唯一选择入口；它读取当前完整模块，不能拿截断的阶段预览查找后项。编辑器命令提交源码目标后，源码标记、面板、参考选择和 gizmo 都消费该目标。binding 构建不做候选调用搜索。单值 return 可转数组，完成后的独立变换不允许接链。Constraint 只携带 on/align、参与引用和源码追踪，不携带变换动作或 offset/rotation 快照；工具统一使用 Transformation 快照、spatial bindings 和 model.spatial 事务。

relate 直接返回数组内的空白是 self 的插入上下文，保留实际 callback 的执行实例。编译器记录前置数组项及对应插入锚点；执行器按 callback 实例还原该前缀，Core 从该回调开始前的继承关系构造预览，不混入已完成回调的后续操作。在空白中激活工具同样只比较紧随其后的第一项；匹配则定位已有项，否则保持该插入位置；空数组也提供入口。末尾光标在 ] 前，中间在后续项前，且不高亮邻接的调用名称。

数组/return 插入位置由当前源码 AST 确认，与 Core 构造函数导入共同组成一次源码事务；复用已有别名或 namespace，新增名称避开已有绑定。源码无法安全定位为返回值或数组项时不虚构插入位置。新增操作的焦点以替换文本内偏移记录在源码事务中，编辑器合并导入变化计算最终位置；同一次 Undo 恢复源码和光标。共享 map 的每次执行携带自己的 owner 和动作架，预览按各实例计算，提交仍只改一处源码，取消不改文件，Undo 同时恢复调用和导入。

最近一项的工具类型按运行时 axisOnly 元数据及草稿选择器分类：裸 rotate、pivot 系列属于绕点，axis 系列属于绕轴。先确定最近项再比较类型，不分别搜索两类旋转。工具可用性只表达当前能进行哪些操作，不负责选择其他源码目标；它由绑定推导，不依赖当前旋转参考，避免计算环。

关系中的未完成旋转参考选择沿当前 `relate` self 保留执行归属。编译阶段记录直接数组项的前置范围，执行追踪按 self 实例和执行顺序还原已完成前缀；Core 仅构造该前缀的预览副本，不把未完成选择器写入实际摆放。抛错的自由构造器和命名空间调用同样保留拓扑选择参数，缺参及缺少 rotate 的诊断在代码补全前继续存在。编译器记录选择器到可选偏移/rotate 的完整范围；点/轴选择使用统一源码事务，保留已有偏移与角度，仅在缺少 rotate 时补零角度。参考选择状态由当前工具、源码版本、self occurrence 和实际绑定派生，无有效旋转时只显示候选，不借用上一条操作绑定。
