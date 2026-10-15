# Spec Delta

## Purpose

向开发者和 Codex 提供可核查的验收结论，区分业务失败、环境阻塞与证据不足，通过明确的覆盖说明、脱敏证据和复现信息支持修复以及后续回归分析。

## ADDED Requirements

### Requirement: Four explicit outcome states
系统 SHALL 将正式用例结果表示为 passed、failed、blocked 或 inconclusive；只有前置条件有效且所有必需正式断言完成并满足时才可判定 passed。候选检查、未执行项和能力缺口 MUST 独立标记。

#### Scenario: Missing authentication blocks a case
- **WHEN** 用例需要登录，但登录前置条件无法满足
- **THEN** 用例结果为 blocked，并说明缺少的前置条件

#### Scenario: Business assertion is violated
- **WHEN** 前置条件有效，页面可操作且明确业务断言未满足
- **THEN** 用例结果为 failed，并给出实际状态

#### Scenario: Business evidence is insufficient
- **WHEN** 流程可执行，但缺少可靠预期结果或足够证据
- **THEN** 结果为 inconclusive，不生成正式业务通过结论

### Requirement: Reproducible failure reports
系统 SHALL 为失败或阻塞结果记录用例、步骤、预期与实际结果、环境和可重复执行入口；诊断 SHALL 区分已观察事实、可能原因和已验证原因，源码不可用时不虚构代码位置。

#### Scenario: Code location is only a hypothesis
- **WHEN** 系统推断某组件可能与问题有关，但未验证因果关系
- **THEN** 报告将其标记为可能原因，并引用推断依据

#### Scenario: Failure on a URL-only target
- **WHEN** 仅 URL 接入的项目出现断言失败
- **THEN** 报告提供浏览器步骤、证据与重跑入口，说明代码位置不可用

### Requirement: Coverage and run manifest
系统 SHALL 输出机器可读运行结果和可读报告，记录目标、配置来源、运行器及浏览器版本、视口、用例版本、尝试次数和可获得的代码版本；报告 MUST 列出计划项、已执行项和未验证项，不将缺少执行证据的范围描述为已覆盖。

#### Scenario: Partial plan execution
- **WHEN** 十条计划用例只有六条完成，四条因预算限制未执行
- **THEN** 报告明确显示六条执行结果、四条未验证及其原因

### Requirement: Evidence redaction and local retention
系统 MUST 在默认保存步骤证据和向 Codex 返回证据前，对配置的敏感字段和已识别凭证进行脱敏；默认不保存请求正文及认证头，登录态文件不进入报告或回归资产。无法按配置处理的敏感步骤证据 SHALL 被省略并说明缺口；敏感原始 trace SHALL 仅在显式启用后按指定本地保留策略保存，不自动提供给模型。流程录像作为例外 SHALL 默认保存全部浏览器尝试，明确标记为未经脱敏的敏感本地证据，支持关闭且不向模型返回媒体内容。

#### Scenario: Console message contains a known token
- **WHEN** 控制台证据包含配置的密钥或已识别认证字段
- **THEN** 保存及返回的证据使用替代标记，不包含原始凭证

#### Scenario: Screenshot mask cannot be applied
- **WHEN** 配置要求遮挡的敏感区域无法可靠定位
- **THEN** 系统省略该截图并在报告说明证据缺口

#### Scenario: Sensitive raw trace is not opted in
- **WHEN** 项目未显式启用敏感原始 trace 保存
- **THEN** 系统不保存该原始 trace，仅保留符合策略的步骤证据

#### Scenario: Video remains local and expires with its run
- **WHEN** 默认流程录像已生成
- **THEN** 录像标记为敏感本地证据，只通过本地播放入口访问，不将媒体内容返回给 MCP/模型，并按 run 的 `retentionDays` 与所属运行一同清理

#### Scenario: Report links each attempt recording
- **WHEN** 运行报告包含多个尝试或页面录像
- **THEN** JSON 和 Markdown 报告均将每段录像链接到对应的用例、尝试及页面；没有可播放录像时显示证据缺口

### Requirement: Retries do not erase instability
系统 SHALL 在汇总中保留每次尝试结果；重试通过但此前失败的用例 MUST 标记为不稳定，且不得被描述为首次或稳定通过。存在未验证项时总体 MUST 不宣称全部计划通过。

#### Scenario: Failure followed by success
- **WHEN** 一条用例第一次失败、第二次通过
- **THEN** 报告同时呈现两次结果与不稳定标记

#### Scenario: Completed cases pass but one case is blocked
- **WHEN** 已完成断言全部通过，但另有一条必需用例被阻塞
- **THEN** 总体报告说明验收尚不完整，且不显示全部计划通过
