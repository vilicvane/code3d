# 开发文档

这些文档面向修改 Code3D 源码的人和 agent，说明当前系统的职责、契约及设计理由。
仓库级默认工作规则见 [AGENTS.md](../../AGENTS.md)。先读与任务相关的专题，
再沿链接查看实现和测试；无需每次加载全部文档。

| 任务                                               | 阅读入口                                           |
| -------------------------------------------------- | -------------------------------------------------- |
| 理解产品目标与设计取舍                             | [设计原则](design.md)                              |
| 安装、运行、验证与定位开发流程                     | [开发环境](development.md)                         |
| 准备版本号、发布 tag 与 npm 包                     | [版本发布](development.md#版本发布)                |
| 理解包和子系统之间的关系                           | [架构概览](architecture/overview.md)               |
| 修改模型、关系、拓扑或原生资源所有权               | [建模内核](architecture/modeling.md)               |
| 修改文件系统、npm 安装、语言服务、编译、缓存或取消 | [项目与运行时](architecture/runtime.md)            |
| 修改源码预览、参数追踪、GUI 写回或编辑器状态       | [源码与交互工具](architecture/tooling.md)          |
| 修改共享状态、跨组件联动或订阅生命周期             | [响应式技能](../skills/code3d-reactivity/SKILL.md) |
| 修改草图表示、求解、绘制、修剪或诊断               | [草图](architecture/sketch.md)                     |
| 复查求解器实验和数值问题的原始证据                 | [研究记录](../research/README.md)                  |

## 文档与工作规则

- `.agents/skills/` 规定如何开展工作，包括隔离开发、设计变更、验证和交付。
  本目录解释系统本身；文档不会扩大提交、合并或发布授权。
- `docs/` 用于对外文档；使用 Code3D 建模的 agent 从[必读入口](../../docs/agents.md)
  进入具体操作专题。人的[协作指南](../../packages/web/src/content/docs/docs/guides/agents.mdx)
  介绍产品概念，[Web 包](../../packages/web/README.md)维护发布链路。
  各包 README 提供共享介绍，并将开发者引向本目录的相关架构专题和源码。
  对外操作说明与内部实现专题按各自读者维护，通过链接衔接。
- [GitHub Issues](https://github.com/vilicvane/code3d/issues)记录需求、讨论、方案、
  验收和进度。未合并的工作在其 issue 中说明，不写成当前主分支的能力。
- 同一契约有一个主要出处，其他专题引用它。功能变更时同步其所属专题及受影响的
  对外说明；不追加流水式实施日志，也不在多个文件重复维护功能清单。
- 常量、完整 API 清单和精确测试输入以链接的源码、类型及测试为准。文档保留职责、
  不变量、容易误改的边界和理由；源码与说明不一致时先查明原因再更新。

## 历史资料

初期的全局计划、候选 API 和本地需求记录已退出当前文档体系。原始材料保存在
[固定提交的仓库快照](https://github.com/vilicvane/code3d/tree/933c3b5ec745e68dada4db42ecab8b6a0482ea2a)：
[PLAN](https://github.com/vilicvane/code3d/blob/933c3b5ec745e68dada4db42ecab8b6a0482ea2a/PLAN.md)、
[plans](https://github.com/vilicvane/code3d/tree/933c3b5ec745e68dada4db42ecab8b6a0482ea2a/plans)、
[requests](https://github.com/vilicvane/code3d/tree/933c3b5ec745e68dada4db42ecab8b6a0482ea2a/requests)。
该快照仅用于追溯历史，不代表当前规范。旧 R 编号存在重复，引用时保留完整文件路径。
需求迁移的来源映射见该快照的
[requests/README](https://github.com/vilicvane/code3d/blob/933c3b5ec745e68dada4db42ecab8b6a0482ea2a/requests/README.md)。
当前专题保留仍有效的约定；已结束的实施步骤与验收流水通过原 issue 和 Git 历史查询。
