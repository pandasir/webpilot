# Spec Delta

## Purpose

把一次浏览器验收沉淀为拥有明确依据和版本的长期回归资产，使开发者能够不依赖模型重跑、审查测试变化，并将用例移交给项目或持续集成环境独立执行。

## ADDED Requirements

### Requirement: Versioned regression assets
系统 SHALL 保存版本化用例，包含目标参数、角色与数据引用、步骤、等待条件、正式断言及来源；只有执行验证完成且无未解决来源冲突的用例才可标记为可回归，候选和未验证用例 SHALL 保持草稿状态。

#### Scenario: Save a verified acceptance case
- **WHEN** 用例正式断言有明确依据，且已在浏览器中完成验证
- **THEN** 系统保存其版本和来源，并允许标记为可回归

#### Scenario: Save a speculative case
- **WHEN** 用例只有 AI 推测的预期结果
- **THEN** 系统可以保存草稿，但不将其作为稳定的正式回归标准

### Requirement: Model-free replay
系统 SHALL 通过独立运行入口重复执行已保存用例，重跑过程 MUST 不需要模型调用或新的模型 API key，并保留原有正式断言、等待语义和结果分类。

#### Scenario: Replay with no model credentials
- **WHEN** 测试运行环境没有模型凭证，但浏览器和项目环境已就绪
- **THEN** 已保存用例仍可执行并生成结果报告

#### Scenario: Saved assertion no longer holds
- **WHEN** 页面业务行为发生变化，不再满足保存的断言
- **THEN** 回归报告失败或相应环境状态，不自动改变预期结果

### Requirement: Independent export package
系统 SHALL 按用户指定位置导出可独立运行的 Playwright 测试包，包含执行依赖说明、所需配置或准备引用，以及运行命令；不支持保留语义的步骤 MUST 明示并阻止将导出包标记为已验证。

#### Scenario: Export a supported login flow
- **WHEN** 已验证用例的所有步骤与断言都支持导出
- **THEN** 系统生成独立测试包，并用相同目标验证导出后的业务断言

#### Scenario: Export requires an external data fixture
- **WHEN** 用例依赖未包含在导出包内的数据准备能力
- **THEN** 系统说明该依赖和配置入口，在依赖满足前不声称导出包可直接完成验证

### Requirement: Auditable test maintenance
系统 SHALL 记录用例版本差异、定位调整及断言变更；自动发现的新定位 MUST 保持原断言并作为候选修复呈现，业务预期改变 MUST 具有新的需求依据和明确采纳记录。

#### Scenario: Button label changes
- **WHEN** 原定位失效，系统发现可能对应的新按钮
- **THEN** 系统展示定位变更候选及原断言，并保留原失败结果

#### Scenario: Proposed repair weakens an assertion
- **WHEN** 系统建议删除或放宽失败的业务断言
- **THEN** 建议被识别为业务标准变更，需要新的依据与采纳记录，不静默应用

### Requirement: Portable runtime values
系统 SHALL 通过运行参数或外部引用传递地址、账号、登录态和动态数据，回归资产与导出包 MUST 不内嵌凭证、绝对登录态路径或仅本次有效的秘密值；缺少必需引用时 SHALL 返回阻塞结果。

#### Scenario: Replay against a different local port
- **WHEN** 用例通过运行参数提供新的目标地址
- **THEN** 系统使用新地址执行相同用例，无需修改业务断言

#### Scenario: Required secret reference is missing
- **WHEN** 用例引用的运行时凭证没有提供
- **THEN** 系统返回阻塞及缺少的引用名称，不回退到保存的秘密值

### Requirement: Promotion requires clean replay
系统 SHALL 在将新用例标记为可回归前，于独立上下文中重跑，并重新满足数据前置条件；不能恢复前置条件或独立重跑失败时 MUST 保留草稿并说明原因。

#### Scenario: Exploratory run succeeded because of leftover state
- **WHEN** 首次探索通过，但独立上下文重跑不能满足同一断言
- **THEN** 系统保留失败证据，不将该用例标记为可回归
