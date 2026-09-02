# code3d prototype 01

第一个 prototype 验证“TypeScript 模型对象 + scoped GUI 交互”的最小闭环。

## 已验证

- 使用普通 TypeScript 自由构建和组合对象。
- `default export` 作为渲染入口，命名导出作为可选 scope。
- Monaco 提供 `code3d` API 的类型和补全。
- 用户代码与 OpenCascade 在可终止 Worker 中编译和执行。
- primitive、变换、布尔运算、圆角和倒角由 OCCT B-Rep 计算。
- Worker 将 B-Rep 三角化为 surface、法线和拓扑边线供 Three.js 渲染。
- 点击模型定位源码，移动光标反向选择模型对象。
- 整体 scope 提供分解视图，局部 scope 提供临时位置调整。
- 渲染器只消费模型对象，不依赖对象的构建过程。

## 运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

## 当前边界

- 只支持一个入口模组；运行时仅能导入 `code3d`。
- code3d API 目前只开放 box、cylinder、sphere 和基础实体运算。
- GUI 调整是临时 preview override，不写回任意 TypeScript 表达式。
- 源码映射目前到模型对象；face/edge ID 已传出，但尚未映射回局部源码 scope。
- Worker 防止用户代码锁死 UI，但不是安全沙箱。
- 当前精简 OCCT WASM 约 23 MB，gzip 约 7.3 MB。

## 下一步

- 将 face/edge group ID 接入拾取，验证局部拓扑 scope。
- 验证实体布尔失败、取消执行和连续重算的内存行为。
- 增加 STEP/STL 导出。

## 依赖许可

- RepliCAD 使用 MIT 许可。
- `replicad-opencascadejs` 包含 Open CASCADE Technology 的定制 WASM 构建，使用 LGPL-2.1-only 许可；发布产品时需要保留相应许可和源码获取信息。
