# Spec Delta

## Purpose

把通用 Web 验收能力作为可安装的本地 Codex 插件交付，通过明确的 Skills 工作流、本地工具接口及独立命令入口，让不同项目使用相同引擎完成验收与回归。

## ADDED Requirements

### Requirement: Installable local plugin
系统 SHALL 提供插件清单、本地发行入口、Skills 和 MCP 配置，使支持本地插件的 Codex 宿主能够发现并加载工作流；宿主不支持某组件时 MUST 说明兼容限制，不将未完成加载描述为可用。

#### Scenario: Install into a supported local Codex host
- **WHEN** 用户按照本地安装说明安装插件并启动新会话
- **THEN** 宿主能够发现 WebPilot Skills 并连接其本地工具服务

#### Scenario: Host cannot load a bundled component
- **WHEN** 当前宿主不支持插件声明的本地组件
- **THEN** 系统提供兼容诊断和可用的替代入口，不宣称插件已完整可用

### Requirement: Runtime readiness diagnostics
系统 SHALL 在执行前检查运行时、浏览器、插件版本与可写存储，并提供明确的就绪结果和设置建议；设置插件运行时 MUST 不修改目标项目依赖，浏览器缺失或运行时不兼容时 SHALL 阻塞执行。

#### Scenario: Browser binary is missing
- **WHEN** 首次使用时尚未准备浏览器资源
- **THEN** 系统报告缺少浏览器与插件范围内的设置入口，不要求目标项目安装测试框架

#### Scenario: Environment cannot write artifacts
- **WHEN** 选定运行存储不可写
- **THEN** 系统在执行前报告阻塞，并说明需要可写位置

### Requirement: Explicit acceptance workflow
插件 SHALL 提供接入与验收、回归重跑、失败诊断和测试导出工作流，展示计划及运行结果；首版 MUST 由用户任务或明确调用触发，不依赖自动生命周期钩子。插件 SHALL 复用 Codex 的推理，不额外要求模型 API key。

#### Scenario: Verify a local feature
- **WHEN** 用户要求验收当前功能并保存回归用例
- **THEN** 插件按接入、规划、执行、报告和独立重跑的流程工作，符合条件时保存可回归资产

#### Scenario: Code changes without an acceptance request
- **WHEN** 用户仅修改代码，未发起验收工作流
- **THEN** 首版插件不自行通过生命周期钩子启动浏览器测试

### Requirement: Consistent MCP and CLI behavior
系统 SHALL 通过 MCP 提供结构化接入、会话操作、执行、报告与用例管理能力，并通过 CLI 提供就绪检查、确定性重跑及导出入口；两种入口对同一回归资产 MUST 使用一致的断言与结果分类。

#### Scenario: Same asset through MCP and CLI
- **WHEN** 在等价环境下分别通过 MCP 与 CLI 执行同一用例版本
- **THEN** 两者应用相同断言和结果规则，并记录各自运行证据

#### Scenario: Automation consumes CLI output
- **WHEN** 调用者请求机器可读 CLI 结果
- **THEN** 系统提供结构化输出及能够区分通过、失败、未完整验证和运行错误的退出状态

### Requirement: Host policy and tool errors
插件 MUST 遵守宿主的文件、网络、工具授权边界；工具被拒绝、预算耗尽、接口版本不支持或会话过期时 SHALL 返回明确的结构化错误或相应结果，不绕过限制或虚构执行证据。

#### Scenario: Host denies a startup action
- **WHEN** 宿主拒绝执行目标项目启动动作
- **THEN** 系统记录拒绝和阻塞原因，并仅继续不依赖该动作的工作

#### Scenario: Replay asset schema is newer than supported
- **WHEN** 用例资产声明当前运行器不支持的结构版本
- **THEN** 系统在执行前拒绝运行并报告兼容信息
