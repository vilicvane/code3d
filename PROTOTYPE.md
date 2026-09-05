# code3d prototype 01

第一个 prototype 验证“TypeScript 模型对象 + scoped GUI 交互”的最小闭环。

当前设计与实施顺序见 [PLAN.md](./PLAN.md)，通用 GUI 工具与源码编辑协议见
[TOOLING.md](./TOOLING.md)。

## 已验证

- 使用普通 TypeScript 自由构建和组合对象。
- 项目通过 ZenFS 使用浏览器持久化存储，或直接读写用户选择的本地文件夹；两种模式
  都可创建多个 TypeScript 模组并使用普通相对导入。
- 项目可使用自身安装的浏览器兼容 npm 包，编辑器读取对应声明。未声明 core 时使用
  内置 core/screws；根 package.json 声明 core 后，完整建模运行时改用项目安装版本。
- 当前编辑文件就是本次执行的根模组；切换到任意源码文件即可直接预览它产生的模型。
- `/model.ts` 和用户创建的文件始终属于工作区；内置功能示例集中在可单独重置的
  `/examples` 目录，`Reset examples` 不会改动其他文件。
- 源码产生任意模型对象即可预览；export 只是可选发布边界和 fallback。
- `model()` 不是入口要求，源码选择决定主要渲染对象。
- Monaco 提供 `code3d` API 的类型、补全、格式化和跨文件定义跳转。
- 用户代码与 OpenCascade 在可终止 Worker 中编译和执行。
- primitive、平面图形、空间曲线、loft、约束定位、布尔运算、圆角、倒角、棱柱、圆台和螺纹由 OCCT B-Rep 计算。
- Worker 将 B-Rep 三角化为 surface、法线和拓扑边线供 Three.js 渲染。
- 几何模型的 vertex、edge 和 surface 使用模型内稳定的数字 ID；派生操作保留可一一追踪的旧 ID，新元素递增分配且不复用已消失的 ID。
- circle、ellipse、rectangle、regularPolygon 平面图形和 line、arc、bezier、spline
  曲线都是可独立渲染、选择和 `relate()` 的一等模型值；平面图形局部位于 XZ 面，法向为 +Y。
- `loft(sections)` 构造普通多截面放样，`loft(sections, {spine})` 使用曲线作为真实 sweep spine；section 和 spine 都保留为源码运行时上下文。
- `.surface(id)`、`.edge(id)` 和 `.vertex(id)` 分别提供带中心/法向、中点/切向和位置的完整关系锚点；对应的 `.surfaces(ids)`、`.edges(ids)` 和 `.vertices(ids)` 返回引用数组，省略数组时返回全部引用，并共享 viewport 单选或多选交互。
- 用户手写 `fillet(radius)`、`fillet(radius, edgeIds)` 或对应的 `chamfer`
  调用后，光标进入整个参数区域即可开启 viewport 选边；viewport 以已应用的操作结果
  为主体，同时在原位置保留可 hover、可 toggle 的输入边。边和参数修改会立即写回源码并
  在后台重编译，单参数形式表示全部边。
- 已生效的 fillet/chamfer 源码上下文以结果实体为主，并叠加弱化的操作前轮廓和被修改的原边，便于比较前后拓扑。
- 点击模型定位源码；移动光标会独立渲染对应的运行时模型节点。
- 同一源码表达式产生多个对象时，源码节点预览会同时显示这些对象。
- 数组、Set 和 Map 中的模型按组合位置预览，即使集合只有一个成员也保留该语义；
  单独模型仍使用自身局部坐标，集合不会隐式变成 group 或额外位置工具 scope。
- 平移 gizmo 将位置参数追溯到上游变量或源码字面量，拖动时先做临时预览，确认后通过 Monaco 编辑直接写回源码。
- Monaco 使用 Prettier 格式化模型源码；GUI 写回后自动格式化，也可使用 `Shift+Alt+F`。
- 选中对象后可用平移 gizmo 直接调整能唯一追溯的位置参数。
- 相对位置由语义不可变的 `relate()` copy 携带，并在组合或渲染边界求解。
- 几何模型支持 `origin`、`originOffset`、`originVertex`、`originCenter` 与 `rotate`；原点设置不移动几何，旋转按局部固定 X/Y/Z 轴顺序使用角度制。`originCenter()` 取主体包围盒中心随模型变换后的 `.center` 锚点。原点坐标和偏移提供平移手柄，顶点原点复用拾取，中心及顶点原点拖动会生成偏移，旋转提供与角度参数对应的环形手柄。
- 平移工具优先修改唯一安全的上游位置参数，否则在最外层 offset 的参数表达式上
  加减并合并增量，保留原表达式；缺少可逐轴编辑的 offset 时追加一次并在后续拖动中复用。
- 共享参数的其他受影响对象会同步预览并高亮；`Esc` 取消尚未松手的拖动，保留源码面板。
- 可调用 API 的 `@code3d.param` 提供工具参数的 kind、标签和静态约束；变量本身不读取 annotation 元数据。
- 模型函数可用重复的 `@code3d.arguments [...]` 声明设计时调用参数；GUI 可在真实调用与这些候选上下文之间切换，注解内的值也会按对应函数签名提供 TypeScript 补全。
- Monaco 会高亮已识别的 `@code3d.*` JSDoc 标签，非法参数候选会得到源码定位诊断。
- 渲染器只消费模型对象，不依赖对象的构建过程。
- 内置可编辑模组提供 M3–M12 内六角圆柱头螺钉、配合间隙孔和沉孔工具对象。
- core 提供 Y 轴直管 `tube` 和支持小数圈数的 `coil`；自定义实体通过
  `@code3d/core/replicad` 的 `definePrimitive` 接入，螺纹 builder 属于 screws 包内部。
- viewport 右键提供 STEP、STL、3MF 模型导出与 PNG 图像导出。模型导出当前前景上下文，
  保留组合后的放置，不包含弱化背景与辅助图形；可设置毫米比例、朝向与网格精度。

示例中的共享参数：

```ts
const postOffset = 27;
const plate = box(38, 6, 26);

const post = cylinder(4.5, 25).relate(part =>
  part.bottom.on(plate.top).offset(postOffset, 0, 0),
);
```

工具仍会追溯并修改共享变量的数值；步长由当前工具参数的语义决定，不从变量注释推断单位或范围。

圆角和倒角都有明确的单参数重载；第二参数是可选的非空边 ID 过滤：

```ts
const allRounded = box(38, 6, 26).fillet(2);
const rounded = box(38, 6, 26).fillet(2, [1, 5, 9]);
const finished = rounded.chamfer(0.5, [13]);
```

已有数组会在 viewport 中预先选中并可继续 toggle；`Use all edges` 删除第二参数并
回到单参数形式。显式选择不能是空数组：逐个取消到空集合时也会自动回到全部边，
不会把 `[]` 留在源码中。单参数的全部边模式不会把 guide 显示为显式全选，第一次
点击会建立只包含该边的过滤数组；只有数组确实列出所有 ID 时才是显式全选。同一轮
连续交互合并成一个 Monaco undo 历史项。移开源码焦点会关闭对应工具界面；`Esc`
不关闭面板或结束拓扑选择，只取消正在进行的 viewport 拖动，不撤销已经写入的修改。

若后续模型表达式求值失败，App 仍保留此前已经成功求值的模型与源码 trace；因此
错误位置之前的上下文工具仍可进入并修正源码。每次实际进入的调用都按运行时触达顺序
记录其已求值的输入、实参、参数 provenance 以及完成或失败状态；同一源码区域默认使用
首选运行时 context 中最近触达的一次。若报错的调用本身是 fillet/chamfer，工具会以其
已成功求值的输入模型为主体，并过滤已经不存在的边 ID，使该调用自己的边和尺寸参数也
可以直接修复。

这些数字是随模型派生传递的拓扑 ID，而不是当前边数组的下标或 OCCT hash。
相同源码、参数和内核版本会确定性地产生相同 ID；被删除边的 ID 不会在后续步骤中复用。

沿曲线放样两个方向不同的平面图形：

```ts
const spine = bezier([
  [0, 0, 0],
  [12, 7, 0],
  [10, 20, 9],
  [4, 28, 14],
]);
const start = circle(4).relate(profile => profile.plane.on(spine.start).flip());
const end = rectangle(7, 4).relate(profile =>
  profile.plane.on(spine.end).flip(),
);
const result = loft([start, end], {spine});
```

函数的设计时参数使用普通 TypeScript 表达式，并在函数所在模组的作用域中求值：

```ts
/**
 * @code3d.arguments ['M6', 18]
 * @code3d.arguments ['M8', 30]
 */
export function socketCapScrew(input: SocketCapScrewInput, length: number) {
  // ...
}
```

这些调用只生成可视化上下文，不改变普通源码执行结果或导出边界。

## 运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

格式化与检查：

```bash
npm run format
npm run lint-prettier
```

## 工作区与示例

新工作区的 `/model.ts` 直接包含底座与立柱的独立源码，以普通 `group([base, post])`
调用结束，不要求 export，也不依赖 `/examples` 中的文件。
可以直接把实际模型放在任意自建目录中，打开对应文件即可执行和预览。

内置示例覆盖 primitive 与派生操作、Boolean 运算、关系与具名元素、函数工具面板、
设计时参数、自定义旋钮、原点与旋转以及公制紧固件。示例版本变化时会将 `/examples` 自动同步为新的内置版本；顶部的
`Reset examples` 可随时手动恢复它。两种操作都不会改动 `/model.ts`、`/lib` 或其他
用户目录，因此长期维护的模型不应放在 `/examples` 中。

默认 URL 打开浏览器工作区。`Open folder` 会让当前页面直接连接用户选择的真实目录：
空目录会接收当前工作区，已有 TypeScript 文件的目录会被原样采用。code3d 只另外写入
`.code3d/project.json` 来记录托管示例版本，并同步其托管的 `examples` 目录。

每个本地目录连接都有自己的 `?workspace=...` URL，因此一个标签页切换目录不会改变
其他 code3d 页面。目录 handle 会被保存，权限失效时可用 `Reconnect folder` 重新授权；
`Use browser storage` 只让当前页面回到默认浏览器工作区。

应用内编辑会直接写入磁盘。浏览器目前没有稳定的目录监听 API；在外部编辑器中修改
文件后，使用 `Reload folder` 重新读取磁盘内容。

## 当前边界

- 当前文件作为执行根，可使用相对导入与项目 node_modules 中的浏览器兼容包；
  App 不运行 npm install，不提供 Node 内置 API 或 native addon。
- 实例身份依赖源码结构路径和运行序号；大幅改变控制流时仍可能需要重新匹配。
- 当前可沿唯一 TypeScript 定义链追溯数值 initializer，包括变量、具体对象属性、
  解构、import/re-export 及支持的简单算术映射。
- 没有唯一上游目标的函数调用或非线性表达式不会被自动反向求解。面板以运行时值作为
  空 input 的 placeholder；输入数字会替换整个调用参数表达式，同值输入也会替换。
  空缺参数没有 placeholder，按顺序填入后可用 Tab 进入下一项。
- 源码编辑影响共享调用或变量的全部求值实例，不是只针对当前点中的 occurrence 创建覆盖值。
- 数值和单个 topology ID 已能通过 panel 写回；曲线控制点数组仍只通过代码编辑。
- Worker 防止用户代码锁死 UI，但不是安全沙箱。
- 当前精简 OCCT WASM 约 23 MB，gzip 约 7.3 MB。
- 本地目录模式依赖支持 File System Access API 的浏览器和安全上下文；不支持时仍可
  使用默认浏览器工作区。
- STL 和 3MF 只接受实体；曲线和曲面可使用 STEP。导出不会验证可打印性或制造条件，
  接收软件中的比例与朝向仍需核对。

## 下一步

- 增强结构性源码编辑后的实例匹配，并探索对象 lineage / 时间线视图。
- 探索存在多个上游候选时的编辑选择。
- 验证实体布尔失败、取消执行和连续重算的内存行为。

## 依赖许可

- RepliCAD 使用 MIT 许可。
- `replicad-opencascadejs` 包含 Open CASCADE Technology 的定制 WASM 构建，使用 LGPL-2.1-only 许可；发布产品时需要保留相应许可和源码获取信息。
