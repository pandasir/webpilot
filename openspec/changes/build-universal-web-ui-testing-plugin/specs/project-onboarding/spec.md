# Spec Delta

## Purpose

让开发者能够通过页面地址、已运行服务或项目目录接入任意框架的 Web 前端项目，统一处理启动、配置、登录与数据准备，并在环境信息不足时提供可执行的补充路径。

## ADDED Requirements

### Requirement: Framework-independent target access
系统 SHALL 接受 HTTP/HTTPS URL、已运行服务地址或项目目录作为入口；目标页面可访问时 MUST 不因未知框架或缺少源码而拒绝浏览器测试。

#### Scenario: URL without project source
- **WHEN** 用户提供可访问的 URL，且没有项目目录
- **THEN** 系统建立浏览器测试目标，并将源码分析标记为不可用

#### Scenario: Unknown frontend framework
- **WHEN** 项目使用无法识别的框架，但提供了可访问地址
- **THEN** 系统仍允许页面观察、交互和验收

### Requirement: Explicit configuration precedence
系统 SHALL 按本次显式参数、选定项目配置、自动发现的顺序解析目标地址、工作目录和启动命令，并展示解析来源；多应用或启动候选存在歧义时 MUST 请求选择或补充信息。

#### Scenario: Explicit URL overrides discovery
- **WHEN** 自动发现地址与用户显式地址不同
- **THEN** 系统使用显式地址并在接入结果中记录其来源

#### Scenario: Monorepo contains multiple applications
- **WHEN** 项目中存在多个前端应用，且用户没有指定应用或工作目录
- **THEN** 系统返回候选列表，等待选择后再启动目标应用

#### Scenario: No usable startup information
- **WHEN** 未发现可用启动命令，且没有已运行地址
- **THEN** 系统将接入标记为阻塞，说明需要的命令、工作目录或 URL

### Requirement: Non-invasive runtime ownership
系统 SHALL 从插件管理的运行时提供测试能力；默认 MUST 不修改目标项目的源码、依赖清单、锁文件或测试配置。目标项目依赖缺失时 SHALL 报告准备条件，而不自动安装目标依赖。

#### Scenario: Project has no test framework
- **WHEN** 可访问的项目未安装测试依赖，也没有测试配置
- **THEN** 系统能够执行浏览器验收，且目标项目文件不发生变化

#### Scenario: Startup depends on missing project packages
- **WHEN** 启动命令因目标项目依赖缺失而失败
- **THEN** 系统报告环境阻塞及可执行的准备建议，不自动修改依赖文件

### Requirement: Managed development service lifecycle
系统 SHALL 检查已有服务、对启动服务设置就绪超时，并记录服务所有权；结束或取消运行时 MUST 只清理本次运行创建的进程，不停止用户原有服务。

#### Scenario: Reuse an existing service
- **WHEN** 指定地址已有可用服务
- **THEN** 系统复用服务，并在验收结束后保留该服务

#### Scenario: Service does not become ready
- **WHEN** 系统启动的服务在配置时限内未达到就绪条件
- **THEN** 系统报告阻塞，保留脱敏后的启动诊断，并清理本次创建的进程

### Requirement: Configured authentication and data lifecycle
系统 SHALL 支持指定已有浏览器登录态及测试数据准备、清理方式，记录准备结果，并在配置清理步骤时于结束或取消后尝试清理；必要前置条件缺失或失败时 MUST 将依赖用例标记为阻塞。

#### Scenario: Required login state is unavailable
- **WHEN** 用例要求已登录角色，但缺少有效登录态且未配置登录流程
- **THEN** 系统报告所缺前置条件，且不将该用例判定为产品失败

#### Scenario: Data preparation fails
- **WHEN** 已配置的数据准备步骤失败
- **THEN** 系统将依赖该数据的用例标记为阻塞，并记录清理尝试结果

#### Scenario: User cancels after preparing test data
- **WHEN** 数据准备已完成且运行随后被取消
- **THEN** 系统尝试配置的清理步骤，并记录未完成的清理项

### Requirement: Default video recording configuration
目标配置 SHALL 默认启用每次浏览器尝试的流程录像，并允许用户按目标显式关闭；录像保留期限 SHALL 使用目标配置的运行证据保留期限。

#### Scenario: Default target records videos
- **WHEN** 用户没有设置录像选项
- **THEN** 浏览器尝试录制流程视频，并按默认运行证据保留期限保存

#### Scenario: Target disables videos
- **WHEN** 用户显式关闭目标录像
- **THEN** 浏览器不创建录像文件，其他验收和证据采集照常执行
