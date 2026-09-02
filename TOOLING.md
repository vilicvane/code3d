# code3d 工具架构

工具的职责是把交互转换成编辑意图，而不是直接修改模型、Monaco 或 AST。

```text
selection + gesture
        ↓
       tool
        ↓
      intent
        ↓
     resolver
        ↓
 edit plan + preview
        ↓
 source transaction
        ↓
    compile model
```

## 不变量

- 源文件是模型持久化状态的唯一来源。
- preview 可以临时改变视图，但不能成为隐藏的模型状态。
- 工具不直接依赖 Monaco、OpenCascade 或 Three.js。
- 所有提交都带源码版本和 expected text，必须原子应用。
- 无法唯一解析的意图必须提供候选方案，不能静默猜测。

## 核心层次

### Tool

处理 pointer、keyboard、gizmo 或 Inspector 输入，并产生 `ToolIntent`。同一个意图可以来自不同 UI。

### Intent

描述用户想完成什么，而不是具体文本改动。目前定义：

- `parameter.set`：修改已有上游参数。
- `expression.replace`：用结构化 Expression Draft 替换表达式。
- `operation.insert`：在已有模型表达式上追加操作。
- `object.translate`：平移选中对象；必要时在最终表达式上构造 `.move()`。

### Resolver

结合 provenance、selection scope 和源码 anchor，把 intent 解析为一个或多个 edit plan。参数修改优先使用已有声明；结构修改可以插入调用、提取变量或生成局部表达式。

### Edit plan

包含：

- 工具和 intent。
- 开始交互时的源码版本。
- 可供 UI 展示的修改摘要。
- 临时 preview 描述。
- 带 expected text 的源码编辑集合。

### Source transaction

提交时再次检查源码版本和所有 expected text，然后作为一个编辑事务进入 Monaco undo stack。失败时不应用部分结果。

## Tool session

1. `begin` 固定源码 revision。
2. `preview` 可以被连续调用，只产生临时视图。
3. `commit` 重新解析 intent 并原子写入源码。
4. `cancel` 清除 preview，不产生源码修改。

模型重新编译后，tool session 即结束；后续工具必须基于新的 provenance 开始。

## 当前接入的工具

Inspector 参数控件和 viewport 平移 gizmo 都产生同一个 `parameter.set` intent，
共享相同的 preview、冲突检查、源码事务和 undo 语义。

平移 gizmo 目前遵守以下解析规则：

- 优先修改选中对象最终表达式内能够唯一追溯的位置参数。
- 参数归属到具体 API 调用；连续变换只编辑当前最外层调用，不重复追加操作。
- 同一参数表达式同时包含上游变量和字面量时，优先修改上游变量。
- 参数在整个模型中的用途必须都是同一位置轴，避免 preview 遗漏尺寸等副作用。
- 没有唯一安全参数时，在选中对象的最终表达式上构造 `.move(dx, dy, dz)`，不猜测内部组件应如何移动。
- 拖动值遵守参数的 `min`、`max` 和 `step`；没有 `step` 时使用与 Inspector 相同的推断值。
- preview 会更新所有使用该参数的 occurrence，并标出选中对象以外的受影响对象。
- 松手才写入源文件；`Esc` 清除 preview，不产生源码修改。

如果连最终对象表达式也无法稳定定位，才隐藏对应工具。后续 choice UI 可以进一步提供
“移动最终对象”或“修改内部组件参数”等不同 scope 的 edit plan。

## 表达式构造

工具使用 `ExpressionDraft` 描述 number、string、identifier、array、binary、call 和 member，而不是直接提交任意字符串。例如 fillet 工具可以产生：

```text
operation.insert(
  receiver = selected expression,
  operation = "fillet",
  arguments = [number(2.5)]
)
```

Resolver 再生成带 source anchor 的编辑计划。当前 prototype 已具备基础表达式生成和操作插入解析器；基于临时重编译的结构 preview、格式保持和多方案 UI 尚未实现。

## Scope 与歧义

工具必须把以下信息作为解析上下文，而不是自行决定：

- 当前选中的是模型、occurrence、组件、face、edge 还是 operation。
- 一个参数会影响哪些 occurrence。
- 修改已有共享参数，还是为当前 occurrence 构造新表达式。
- 当前 topology 是否还能稳定映射到产生它的源码。

例如拖动由 `x * postOffset` 定位的单个支柱时，resolver 可以提供：

- 修改 `postOffset`，影响两个支柱。
- 为当前 occurrence 构造局部表达式。

第一种可以直接 preview；第二种属于结构编辑，应在提交前展示将要生成的源码。

对于由多个已定位实体布尔运算得到的 `bridge`，工具不会猜测应修改哪个输入实体；
它会把交互解释为当前对象 scope 的平移，并在 `bridge` 最终表达式上追加 `.move()`。
