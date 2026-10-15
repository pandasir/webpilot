# WebPilot 接口 v1

MCP 使用本地 stdio；成功返回 `{apiVersion:1,data:...}`，失败返回 `{apiVersion:1,error:{code,message,outcome}}` 并设置 `isError`。步骤执行结果内的业务失败使用 `outcome` 表达。未知字段、操作、较新 schema 和无效参数会被拒绝。完整可执行定义见 `src/core/schema.ts` 与 `src/core/service.ts`。

## MCP 工具

| 工具 | 输入 | 结果 |
|---|---|---|
| dashboard_open | `{open?:boolean,force?:boolean}` | 复用本机共享测试中心并首次打开；跨聊天去重，`shouldOpen:false` 时不再开页；显式要求重开可用 `force:true`。返回带短期访问凭证的 `dashboardUrl`、`opened`、`shouldOpen` |
| runtime_info / runtime_doctor | `{}` | 版本 / Node、浏览器、存储就绪情况 |
| project_inspect / run_prepare | `{target}` | 有效目标、配置来源、候选及缺口；不执行启动命令 |
| context_collect | `{projectPath?,requirements?:string[],diffRef?}` | 需求、文档和 Git 上下文；代码影响需另行核实 |
| session_open | `{target,title?,bindings?:{},role?,headful?:false}` | `sessionId,runId,viewport`；启动必要服务并创建独立 context |
| session_observe | `{sessionId}` | 脱敏 URL、标题、快照、近期错误 |
| session_act / session_check | `{sessionId,step}` | 步骤结果与证据；动作 / 断言必须调用对应工具 |
| session_close | `{sessionId}` | 关闭状态、清理错误、已定稿录像 `recordings` 和本地播放器 `playbackPath` |
| suite_run | `{plan,bindings?:{},headful?:false}` | 完整运行报告 |
| report_read | `{runId}` | 已保存运行报告、录像元数据和本地播放路径；不返回原始 trace 或视频内容 |
| case_save | `{case,target,bindings?:{},promote?:false}` | 不可变用例版本、差异、独立验证 run id |
| case_export | `{plan,output,bindings?:{}}` | 新独立目录与未验证导出清单 |
| export_verify | `{directory,url,bindingsFile?,targetConfig?}` | 独立执行结果与更新后的 verified 标记 |

会话失效返回 `SESSION_EXPIRED`；同一会话并发操作返回 `SESSION_BUSY`。每个操作使用唯一步骤 id。动作、断言和重试共享预算；MCP 调用取消会释放会话，suite 保留已执行步骤并尝试 cleanup。宿主在调用前拒绝工具时，插件尚未获得执行机会：Codex 必须报告宿主拒绝，不能编造运行记录。

`session_open.title` 是本次验证目标，例如 `{"title":"验证 MP4 下载流程","target":{"url":"https://example.com/download"}}`。名称去除首尾空白后限 1–120 字符，拒绝控制字符，保存时沿用脱敏；不能提前声明测试已通过。旧调用不传 title 仍可执行，默认采用“项目名 · 浏览器探索”，其次“网站 host · 浏览器探索”，信息未知时使用“浏览器探索会话”。自动标题不包含 URL 路径、查询、片段或完整本机路径。套件继续使用 plan.scope。

执行前调用 `dashboard_open`，避免等待 `suite_run` 完成才取得看板地址。运行返回可带外层可选 `metadata.dashboardUrl/runUrl`，`data` 中的原报告结构不变。多聊天及 CLI 汇总到同一页面；`dashboard open/status/stop/import`、`--no-open`、`--no-dashboard` 及协议详见 [本地测试中心](dashboard.md)。

测试结束后的最终回复必须附上可点击的“本次测试详情”链接，优先使用本次执行返回的 `metadata.runUrl`（回归重跑使用新运行链接）。缺少该字段时，可用已返回的测试中心地址及真实运行 ID，基于测试中心 origin 构造 `/runs/<runId>`。执行前的首页链接、运行 ID、报告文件和录像路径不能替代最终回复中的本次测试详情链接。通过、失败、阻塞、未完整验证以及报告生成失败时均适用；用户显式禁用测试中心或无法取得链接时，应说明原因，不编造地址或另开测试。

## 最小计划

保存为 `plan.json`，地址可在运行时覆盖：

```json
{
  "schemaVersion": 1,
  "id": "login-acceptance",
  "target": {"url":"http://localhost:3000"},
  "scope": ["错误密码显示提示"],
  "gaps": ["尚未覆盖移动端"],
  "cases": [{
    "schemaVersion": 1,
    "id": "invalid-password",
    "version": 1,
    "title": "错误密码登录",
    "steps": [
      {"id":"email","op":"fill","locator":{"kind":"label","value":"Email"},"value":"test@example.test"},
      {"id":"password","op":"fill","locator":{"kind":"label","value":"Password"},"value":{"ref":"invalidPassword"}},
      {"id":"submit","op":"click","locator":{"kind":"role","value":"button","name":"Log in","scope":["form"]}},
      {"id":"message","op":"expectText","locator":{"kind":"role","value":"alert","scope":["form"]},"expected":"Invalid password","source":{"type":"user","reference":"错误密码必须显示 Invalid password"}}
    ]
  }]
}
```

外部 bindings 文件为字符串字典，例如 `{"invalidPassword":"disposable-invalid-value"}`。登录态和上传文件同样通过命名引用传递；秘密、绝对登录态路径不写入资产。正式来源为 `user / openspec / regression`，推测来源 `inferred` 必须设置 `candidate:true`。角色与数据配置见 [项目接入](project.md)。

## 步骤与定位

所有步骤有 `id,op,timeoutMs?`。定位为 `{kind,value,name?,exact?:true,scope?:string[]}`，kind 支持 `role,label,text,testId,selector`。scope 逐层限定 CSS 区域；操作匹配必须唯一，数量断言允许多个元素。

| op | 额外字段 |
|---|---|
| navigate | `path:string 或 {ref}`，相对目标 URL 解析 |
| click | `locator` |
| fill / select | `locator,value:string 或 {ref}` |
| check | `locator,checked:boolean` |
| press | `locator,key` |
| scroll | `x,y` |
| frame | `selector:string 或 null`；null 返回当前页面主 frame |
| openPage / switchPage | `locator,name` / `name` |
| upload | `locator,file:{ref}` |
| download | `locator,filename,source,candidate?` |
| expectVisible / expectEnabled | `locator,expected:boolean,source,candidate?` |
| expectText | `locator,expected:string 或 {ref},contains?:false,source,candidate?` |
| expectValue | `locator,expected:string 或 {ref},source,candidate?` |
| expectCount | `locator,expected:number,source,candidate?` |
| expectURL | `expected:string 或 {ref},source,candidate?` |
| unsupported | `capability`；明确记录未验证能力 |

## CLI

在插件目录运行 `node dist/cli/index.js`，或使用安装位置的绝对入口。它不从目标项目加载依赖，不调用模型。所有正常结果写 JSON stdout，错误诊断写 JSON stderr；`--json` 可用于明确机器消费意图。

```sh
node dist/cli/index.js doctor --data-dir /path/to/webpilot-data
node dist/cli/index.js setup
node dist/cli/index.js inspect --project /path/to/app
node dist/cli/index.js context --project /path/to/app --requirements '错误密码必须显示提示'
node dist/cli/index.js run --plan plan.json --bindings /path/to/bindings.json
node dist/cli/index.js save --plan plan.json --case invalid-password --bindings /path/to/bindings.json --promote
node dist/cli/index.js replay --case invalid-password --version 1 --url http://localhost:3001 --bindings /path/to/bindings.json
node dist/cli/index.js replay --run RUN_ID
node dist/cli/index.js report --run RUN_ID
node dist/cli/index.js export --run RUN_ID --out /path/to/new-test-package
node dist/cli/index.js export-verify --directory /path/to/new-test-package --url http://localhost:3001
node dist/cli/index.js prune --days 7
```

重跑入口支持 `--plan FILE`、`--run ID`、`--case-file FILE`、`--case ID --version N`。保存单独 case 不绑定目标机器地址；后续重跑必须提供 `--url` 或 `--project / --config`。所有存储命令可用 `--data-dir` 或 `WEBPILOT_DATA_DIR` 覆盖存储位置。可用 `--headful` 显示浏览器。

流程录像默认开启，`target.evidence.video:false` 可关闭。`replay` 命令重新执行测试；观看上一次流程录像无需重新执行，直接用浏览器打开结果中的 `playbackPath`（本地 `recordings.html`）。录像在浏览器上下文关闭后定稿，按尝试及页面保存为 WebM，并按 `retentionDays` 清理。原始视频未经脱敏，仅本地保存，MCP 返回元数据和路径。

退出码：`0` 完整稳定通过；`1` 正式断言失败；`2` 阻塞、未完整验证或重试后通过；`3` 内部错误或无效调用。退出码 2 的具体原因以报告为准。SIGINT/SIGTERM 取消后保留已完成结果并执行有界清理。

## 运行记录管理

测试中心的认证网页接口支持以下操作（需要有效本机会话及同源 Origin，写请求使用 JSON）：

| 接口 | 参数与行为 |
|---|---|
| `GET /api/runs?scope=current` | 默认当前记录；`scope=archived` 查看归档。状态、搜索、分页作用于所选范围，顶部统计使用范围全量 |
| `POST /api/runs/:id/archive` | `{}`，归档并永久保存 |
| `POST /api/runs/:id/restore` | `{}`，恢复到当前记录且保持永久保存 |
| `POST /api/runs/:id/title` | `{"title":"验证下载流程"}`，保存显示名称；独立返回 `{id,status:"renamed",title}` |
| `DELETE /api/runs/:id` | `{"confirmPermanent":true}`，弹窗确认后的不可逆删除 |
| `POST /api/runs/manage` | `{"action":"archive或restore或delete","ids":["run-id"]}`，最多 20 个 ID，删除还需 `confirmPermanent:true` |

归档/删除管理写接口返回 `{results:[{id,status,error?}]}`。成功状态为 `archived`、`restored`、`deleted`；部分失败返回逐项 `error`，删除尚未完成返回 `cleanup_pending`，不能按 HTTP 200 推断全成功。重复删除返回已删除结果；缺少永久删除确认字段不会执行删除。活动、尚未清理完毕或执行器状态不明的运行拒绝归档/恢复/删除，但允许通过独立 title 接口改名。改名使用同样的认证、来源与运行归属检查，不接受任意文件路径。详情 SSE 的 `deleted` 事件独立于执行序号，包含 `pending` 或 `deleted` 状态。

归档后永久保存所有已有运行文件，恢复/撤销也不重启过期计时，自动清理与显式 `prune --days` 都跳过永久保存记录。管理文件损坏时保守保留并给出诊断。旧版清理器不认识此规则，带归档数据的存储根不能交给旧版执行器或 prune；回滚时需保留永久保存实现或暂停旧版清理。
