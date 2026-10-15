# Spec Delta

## Purpose

将用户需求、已有验收资料和可选项目改动转为范围明确、断言可追溯的浏览器验收计划，确保开发者知道测试覆盖了哪些行为，以及哪些结论仍缺少可靠依据。

## ADDED Requirements

### Requirement: Source-aware acceptance plan
系统 SHALL 为每条验收用例记录目标、前置条件、步骤、预期结果与断言来源，并区分用户要求、OpenSpec、已有回归和 AI 推测；来源相互冲突时 MUST 明示冲突并暂停相关正式断言的执行。

#### Scenario: Plan from an explicit feature requirement
- **WHEN** 用户要求错误密码显示错误提示并留在登录页面
- **THEN** 计划包含相应步骤与断言，来源指向该要求

#### Scenario: Requirements conflict with existing regression
- **WHEN** 新要求与已有用例对同一操作的预期结果不同
- **THEN** 系统标记冲突，并等待用户解决冲突后再执行相关正式断言

### Requirement: Candidate assertions remain distinct
系统 SHALL 将没有用户需求、规格或已有回归依据的推测标记为候选检查；候选检查 MUST 不自动成为正式验收标准或稳定回归断言，用户明确采纳后 SHALL 记录新的来源。

#### Scenario: Expected behavior inferred from a page
- **WHEN** 系统仅根据当前页面推测提交后应跳转
- **THEN** 检查被标记为候选，不以当前行为证明该业务需求已通过

#### Scenario: User adopts a candidate assertion
- **WHEN** 用户明确采纳候选检查的预期结果
- **THEN** 系统将其转为有用户依据的正式断言，并记录采纳来源

### Requirement: Optional change context
系统 SHALL 在源码可用时利用选定 Git diff、相关路由和组件信息辅助选择测试，并记录影响推断依据；无源码、无 Git 或无法可靠映射页面时 MUST 允许通过 URL 与需求继续验收。

#### Scenario: Shared component change
- **WHEN** 改动涉及多个页面引用的共享组件
- **THEN** 系统提出相关页面检查，并说明影响分析的依据与不确定部分

#### Scenario: No repository context
- **WHEN** 用户仅提供 URL 和功能说明
- **THEN** 系统生成页面验收计划，并标记代码影响分析不可用

### Requirement: Bounded and visible coverage
系统 SHALL 在执行前列出计划范围、角色、视口、用例和必要前置条件，并记录未纳入或无法覆盖的行为；运行 MUST 遵守配置的总时间、步骤和重试上限。

#### Scenario: User requests mobile form verification
- **WHEN** 验收要求包含移动端表单操作
- **THEN** 计划包含指定移动视口，并明示尚未覆盖的其他设备环境

#### Scenario: Execution budget is exhausted
- **WHEN** 运行达到时间或步骤上限，仍有待执行用例
- **THEN** 系统停止继续探索，将未执行项报告为未验证并说明原因
