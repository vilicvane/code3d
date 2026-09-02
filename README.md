# code3d prototype 01

第一个 prototype 验证“TypeScript 模型对象 + scoped GUI 交互”的最小闭环。

通用 GUI 工具与源码编辑协议见 [TOOLING.md](./TOOLING.md)。

## 已验证

- 使用普通 TypeScript 自由构建和组合对象。
- `default export` 作为渲染入口，命名导出作为可选 scope。
- Monaco 提供 `code3d` API 的类型和补全。
- 用户代码与 OpenCascade 在可终止 Worker 中编译和执行。
- primitive、变换、布尔运算、圆角和倒角由 OCCT B-Rep 计算。
- Worker 将 B-Rep 三角化为 surface、法线和拓扑边线供 Three.js 渲染。
- 点击模型定位源码，移动光标反向选择模型对象。
- 局部 Inspector 将 API 参数追溯到上游变量或源码字面量。
- 参数拖动先做临时预览，确认后通过 Monaco 编辑直接写回源码。
- Monaco 使用 Prettier 格式化模型源码；GUI 写回后自动格式化，也可使用 `Shift+Alt+F`。
- 选中对象后可用平移 gizmo 直接调整能唯一追溯的位置参数。
- 没有唯一位置参数时，平移工具会在对象最终表达式上构造 `.move()`。
- 共享参数的其他受影响对象会同步预览并高亮；`Esc` 可取消交互。
- JSDoc 可以提供参数标签、描述、kind、unit、范围和步长。
- Inspector 只为显式声明有效范围的参数显示滑动条。
- 渲染器只消费模型对象，不依赖对象的构建过程。

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

cylinder(4.5, 25).at(x * postOffset, 18.5, 13);
```

`unit` 只影响 UI 提示，不进行运行时换算。

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

- 只支持一个入口模组；运行时仅能导入 `code3d`。
- code3d API 目前只开放 box、cylinder、sphere 和基础实体运算。
- 当前可写回顶层数值变量、直接字面量及由它们组成的简单四则表达式。
- 任意函数调用、闭包、解构和非线性表达式还不会被自动反向编辑。
- 源码映射目前到模型对象；face/edge ID 已传出，但尚未映射回局部源码 scope。
- Worker 防止用户代码锁死 UI，但不是安全沙箱。
- 当前精简 OCCT WASM 约 23 MB，gzip 约 7.3 MB。

## 下一步

- 将 face/edge group ID 接入拾取，验证局部拓扑 scope。
- 扩展参数追踪到更多词法 scope，并处理存在多个上游候选的编辑选择。
- 验证实体布尔失败、取消执行和连续重算的内存行为。
- 增加 STEP/STL 导出。

## 依赖许可

- RepliCAD 使用 MIT 许可。
- `replicad-opencascadejs` 包含 Open CASCADE Technology 的定制 WASM 构建，使用 LGPL-2.1-only 许可；发布产品时需要保留相应许可和源码获取信息。
