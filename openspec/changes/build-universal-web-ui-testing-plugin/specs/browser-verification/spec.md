# Spec Delta

## Purpose

为不同前端技术栈提供一致的真实浏览器操作与断言能力，通过独立会话、明确等待条件和步骤证据验证用户流程，同时在页面歧义或能力不足时保持结果可解释。

## ADDED Requirements

### Requirement: Isolated browser sessions
系统 SHALL 为每次运行创建独立浏览器上下文，按计划设置视口与选定登录态；独立角色 MUST 使用独立上下文，运行结束或取消后 SHALL 释放浏览器资源。

#### Scenario: Separate authenticated roles
- **WHEN** 同一运行包含管理员和普通用户用例
- **THEN** 两种角色分别使用自己的上下文，Cookie 和本地存储不互相污染

#### Scenario: Run cancellation
- **WHEN** 用户取消正在执行的浏览器验收
- **THEN** 系统终止后续步骤，释放上下文，并保留已完成步骤的结果

### Requirement: Semantic and unambiguous element targeting
系统 SHALL 支持依据角色、名称、标签、文本、test id 及显式限定范围定位元素，不要求项目新增 test id；操作定位匹配多个元素时 MUST 报告歧义并要求缩小范围，禁止隐式选择第一个匹配项。

#### Scenario: Page without test ids
- **WHEN** 登录页包含有标签的输入框和命名明确的提交按钮，但没有 test id
- **THEN** 系统可以定位并操作这些元素

#### Scenario: Two buttons have the same name
- **WHEN** 操作定位在页面中匹配两个同名按钮，且没有限定区域
- **THEN** 系统报告定位歧义，不执行任意一个按钮

### Requirement: Common web interactions
系统 SHALL 支持页面导航、点击、输入、选择、勾选、键盘操作、滚动、iframe 与新页面切换，以及本地测试文件上传和下载结果检查；超出当前能力的交互 MUST 返回明确缺口及未验证结果。

#### Scenario: Form submission inside an iframe
- **WHEN** 目标表单位于明确选定的 iframe
- **THEN** 系统在该 frame 中操作和断言，不与外层同名元素混淆

#### Scenario: New page opened by a link
- **WHEN** 验收步骤通过点击打开一个新页面
- **THEN** 系统能够关联并切换到新页面，验证其地址或内容

#### Scenario: Test file upload
- **WHEN** 用户指定本地测试文件和页面上传控件
- **THEN** 系统执行上传并依据计划检查可观察结果

#### Scenario: Unsupported canvas interaction
- **WHEN** 目标流程只能通过当前不支持的 Canvas 操作完成
- **THEN** 系统报告能力缺口，将该流程标记为未验证，不声称验收通过

### Requirement: Condition-based waiting and assertions
系统 SHALL 支持可见性、文本、URL、数量、值及启用状态等明确断言，并按预期页面条件进行有界等待；单个检查的成功 MUST 由断言结果决定，不以动作完成或截图存在代替验证。

#### Scenario: Delayed validation message
- **WHEN** 页面异步显示预期错误提示，且在设定时限内出现
- **THEN** 系统等待条件满足后判定该断言通过

#### Scenario: Click succeeds but business result is absent
- **WHEN** 按钮点击完成，但有效前置条件下预期结果在时限内没有出现
- **THEN** 系统将对应断言判定为失败，并记录预期与实际状态

### Requirement: Step-linked evidence
系统 SHALL 将动作、断言、时间和证据关联到运行及步骤，支持页面快照、截图、控制台错误和相关网络失败；trace 的保存 SHALL 遵守证据保留策略，重试 MUST 保留原始失败记录。

#### Scenario: Assertion fails after a request error
- **WHEN** 表单提交断言失败，且关联时间段内存在请求失败
- **THEN** 系统保存失败步骤及相关网络证据，避免直接将关联推断成已证实的根因

#### Scenario: A retry succeeds
- **WHEN** 一条用例首次失败而允许的重试通过
- **THEN** 系统保留两次结果，并标记曾失败及可能存在不稳定性

### Requirement: Default full-flow video recording
系统 SHALL 默认录制每次实际启动的浏览器尝试的完整流程录像，包含通过、失败和重试尝试；用户 MUST 能按目标显式关闭录像。录像 SHALL 在浏览器上下文关闭后完成写入，并作为 attempt 级证据与相应尝试及运行关联。上下文包含多个页面时，系统 SHALL 保留各页面录像并标明页面关联。录像不可用时 SHALL 记录证据缺口，不改变业务断言结果。

#### Scenario: A successful attempt is recorded by default
- **WHEN** 一条用例在默认设置下完成浏览器尝试
- **THEN** 运行产物包含可播放的本地流程录像，并关联到该次尝试

#### Scenario: Failed attempt and retry are retained separately
- **WHEN** 一条用例首次失败后重试
- **THEN** 两次尝试的录像分别保留，报告能区分其结果与顺序

#### Scenario: Video recording is explicitly disabled
- **WHEN** 用户在目标配置中关闭录像
- **THEN** 系统不创建视频文件，并继续正常采集其他步骤证据

#### Scenario: Video cannot be finalized
- **WHEN** 浏览器上下文关闭后录像文件不可用或未能写完
- **THEN** 报告记录该尝试的录像证据缺口，测试结果仍由正式断言决定
