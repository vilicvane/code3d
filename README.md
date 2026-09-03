# code3d prototype 01

第一个 prototype 验证“TypeScript 模型对象 + scoped GUI 交互”的最小闭环。

当前设计与实施顺序见 [PLAN.md](./PLAN.md)，通用 GUI 工具与源码编辑协议见
[TOOLING.md](./TOOLING.md)。

## 已验证

- 使用普通 TypeScript 自由构建和组合对象。
- 浏览器内项目由 ZenFS 持久化，可创建多个 TypeScript 模组并使用普通相对导入。
- 源码产生任意模型对象即可预览；export 只是可选发布边界和 fallback。
- `model()` 不是入口要求，源码选择决定主要渲染对象。
- Monaco 提供 `code3d` API 的类型、补全、格式化和跨文件定义跳转。
- 用户代码与 OpenCascade 在可终止 Worker 中编译和执行。
- primitive、约束定位、布尔运算、圆角、倒角、棱柱、圆台和螺纹由 OCCT B-Rep 计算。
- Worker 将 B-Rep 三角化为 surface、法线和拓扑边线供 Three.js 渲染。
- 点击模型定位源码；移动光标会独立渲染对应的运行时模型节点。
- 同一源码表达式产生多个对象时，源码节点预览会同时显示这些对象。
- 运行时对象目录按模块绑定组织对象；数组和循环结果会聚合显示实例数。
- 目录支持悬停临时预览、点击固定渲染并定位回对应源码。
- 集合绑定可以展开到单个运行时实例，绑定还可以展开查看局部 lineage。
- 目录展开与固定实例使用 source-aware ID，可在普通重算和参数写回后保持。
- 局部 Inspector 将 API 参数追溯到上游变量或源码字面量。
- 参数拖动先做临时预览，确认后通过 Monaco 编辑直接写回源码。
- Monaco 使用 Prettier 格式化模型源码；GUI 写回后自动格式化，也可使用 `Shift+Alt+F`。
- 选中对象后可用平移 gizmo 直接调整能唯一追溯的位置参数。
- 相对位置由语义不可变的 `relate()` copy 携带，并在组合或渲染边界求解。
- 平移工具编辑现有 `offset(x, y, z)`；缺少 offset 时在约束表达式上创建它。
- 共享参数的其他受影响对象会同步预览并高亮；`Esc` 可取消交互。
- JSDoc 可以提供参数标签、描述、kind、unit、范围和步长。
- 模型函数可用重复的 `@code3d.arguments [...]` 声明设计时调用参数；GUI 可在真实调用与这些候选上下文之间切换，注解内的值也会按对应函数签名提供 TypeScript 补全。
- Monaco 会高亮已识别的 `@code3d.*` JSDoc 标签，非法参数候选会得到源码定位诊断。
- Inspector 只为显式声明有效范围的参数显示滑动条。
- 渲染器只消费模型对象，不依赖对象的构建过程。
- 内置可编辑模组提供 M3–M12 内六角圆柱头螺钉、配合间隙孔和沉孔工具对象。

示例中的共享参数：

```ts
/**
 * @code3d.label 支柱间距
 * @code3d.kind length
 * @code3d.unit mm
 * @code3d.min 18
 * @code3d.max 36
 * @code3d.step 0.5
 */
const postOffset = 27;
const plate = box(38, 6, 26);

const post = cylinder(4.5, 25).relate(part =>
  part.bottom.on(plate.top).offset(postOffset, 0, 0),
);
```

`unit` 只影响 UI 提示，不进行运行时换算。

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

这些调用只生成可视化上下文，不改变导出、Overview fallback 或 Model Outline。

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

## 当前边界

- 项目支持一个入口模组和任意本地 TypeScript 模组；第三方包导入尚未开放。
- 对象目录以模块级绑定为主视图；局部绑定和匿名操作只在 lineage 中显示。
- 实例身份依赖源码结构路径和运行序号；大幅改变控制流时仍可能需要重新匹配。
- 当前可写回顶层数值变量、直接字面量及由它们组成的简单四则表达式。
- 任意函数调用、闭包、解构和非线性表达式还不会被自动反向编辑。
- canonical model anchor 已可用于关系约束；任意 face、edge 和 vertex anchor 尚未开放。
- Worker 防止用户代码锁死 UI，但不是安全沙箱。
- 当前精简 OCCT WASM 约 23 MB，gzip 约 7.3 MB。

## 下一步

- 增强结构性源码编辑后的实例匹配，并探索对象 lineage / 时间线视图。
- 将任意 face、edge 和 vertex 接入 anchor 选择与源码表达。
- 扩展参数追踪到更多词法 scope，并处理存在多个上游候选的编辑选择。
- 验证实体布尔失败、取消执行和连续重算的内存行为。
- 增加 STEP/STL 导出。

## 依赖许可

- RepliCAD 使用 MIT 许可。
- `replicad-opencascadejs` 包含 Open CASCADE Technology 的定制 WASM 构建，使用 LGPL-2.1-only 许可；发布产品时需要保留相应许可和源码获取信息。
