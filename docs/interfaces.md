# WebPilot 接口 v1

MCP 使用本地 stdio；成功返回 `{apiVersion:1,data:...}`，失败返回 `{apiVersion:1,error:{code,message,outcome}}` 并设置 `isError`。步骤执行结果内的业务失败使用 `outcome` 表达。未知字段、操作、较新 schema 和无效参数会被拒绝。完整可执行定义见 `src/core/schema.ts` 与 `src/core/service.ts`。

## MCP 工具

| 工具 | 输入 | 结果 |
|---|---|---|
| runtime_info / runtime_doctor | `{}` | 版本 / Node、浏览器、存储就绪情况 |
| project_inspect / run_prepare | `{target}` | 有效目标、配置来源、候选及缺口；不执行启动命令 |
| context_collect | `{projectPath?,requirements?:string[],diffRef?}` | 需求、文档和 Git 上下文；代码影响需另行核实 |
| session_open | `{target,bindings?:{},role?,headful?:false}` | `sessionId,runId,viewport`；启动必要服务并创建独立 context |
| session_observe | `{sessionId}` | 脱敏 URL、标题、快照、近期错误 |
| session_act / session_check | `{sessionId,step}` | 步骤结果与证据；动作 / 断言必须调用对应工具 |
| session_close | `{sessionId}` | 关闭状态、清理错误、已定稿录像 `recordings` 和本地播放器 `playbackPath` |
| suite_run | `{plan,bindings?:{},headful?:false}` | 完整运行报告 |
| report_read | `{runId}` | 已保存运行报告、录像元数据和本地播放路径；不返回原始 trace 或视频内容 |
| case_save | `{case,target,bindings?:{},promote?:false}` | 不可变用例版本、差异、独立验证 run id |
| case_export | `{plan,output,bindings?:{}}` | 新独立目录与未验证导出清单 |
| export_verify | `{directory,url,bindingsFile?,targetConfig?}` | 独立执行结果与更新后的 verified 标记 |

会话失效返回 `SESSION_EXPIRED`；同一会话并发操作返回 `SESSION_BUSY`。每个操作使用唯一步骤 id。动作、断言和重试共享预算；MCP 调用取消会释放会话，suite 保留已执行步骤并尝试 cleanup。宿主在调用前拒绝工具时，插件尚未获得执行机会：Codex 必须报告宿主拒绝，不能编造运行记录。

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
