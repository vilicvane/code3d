# code3d 设计目标

## Goals

- 使用完整的 JavaScript/TypeScript 自由构建和组合模型。
- 关注模型对象本身，而不是它的构建过程。
- 模型可以导出、导入、复用、实例化和渲染。
- 代码与 GUI 围绕同一个模型对象交互。
- 交互具有明确的 scope：整体模型、实例或组件、局部元素或操作。
- GUI 补充代码中不方便、不直观的操作。

## Non-goals

- 不把构建步骤、历史记录或特征树作为核心抽象。
- 不为方便 GUI 同步而限制 JavaScript/TypeScript 的表达能力。
- 不要求 GUI 能反向编辑任意 JavaScript/TypeScript 代码。
- 不用 GUI 取代代码，也不复刻完整的传统 CAD 工作流。
- 不让公开模型接口依赖 OpenCascade 或具体渲染器。
