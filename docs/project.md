# Project onboarding

Accept a URL, an existing service, or a project directory. Configuration precedence is explicit input, selected `webpilot.config.json`, then discovery. Unknown frameworks are supported through a URL. No source or Git repository is required.

Optional target fields:
- `projectPath`, `configPath`, `application`: select the application/workspace.
- `url`: HTTP/HTTPS target; explicit addresses win.
- `command`: `{ executable, args, cwd?, timeoutMs? }`; no shell interpolation.
- `staticDir`: serve only a selected static directory on a loopback ephemeral port.
- `ready`: `{ timeoutMs, statuses, path }`; default status 200. Configure expected redirects explicitly.
- `allowedOrigins`: extra permitted navigation origins, including needed authentication or frame hosts.
- `viewport`: `{ width, height }`; default 1280 × 720.
- `roles`: named `{ required, storageStateRef?, login: Step[], verify: Step[] }` profiles. Required roles need formal observable verification, so expired states cannot count as authenticated.
- `data`: `prepare` and `cleanup` commands. Cleanup runs even after verification fails; cleanup problems keep the run incomplete.
- `budget`: `{ totalMs, maxSteps, assertionMs, attempts }`; defaults 600000, 100, 10000, 1.
- `evidence`: `{ masks: string[], secrets: [{ ref }], rawTrace: false, video: true, live: true, retentionDays: 7 }`. 流程录像默认保留所有浏览器尝试，含通过、失败与重试；设置 `video:false` 关闭录像、`live:false` 独立关闭看板直播。直播只在观看时采集，为可能未经脱敏的敏感本地画面，详见 [测试中心](dashboard.md)。

Discovery reads package scripts, known lockfiles, README URLs and nested applications without running discovered commands. Multiple candidates need explicit selection. Missing target dependencies are environment blockers; WebPilot does not install them. Existing servers survive verification; only owned processes/static servers are stopped. Data commands have individual timeouts and use their own process groups.

Login-state/file/secret references are supplied as runtime bindings. Use disposable accounts and project-specific data preparation appropriate to your requested test environment. The framework's startup and backend dependencies remain the application's own requirements.

## 流程录像配置

默认录像仅保存在本地运行目录，未经脱敏，可能拍到登录信息或页面业务数据。录像沿用 `evidence.retentionDays`（默认 7 天）。需要关闭时，在计划的 `target` 或 `webpilot.config.json` 中设置：

```json
{"url":"http://localhost:3000","evidence":{"video":false}}
```

录像使用与浏览器视口一致的尺寸。浏览器上下文关闭后视频才完整；查看报告返回的 `playbackPath`，用浏览器打开 `recordings.html` 即可播放、暂停和拖动进度。弹出的新页面单独录制，在播放器中标明页面名称。

## 数据生命周期示例

```json
{
  "url":"http://localhost:3000",
  "data":{
    "prepare":{"executable":"node","args":["scripts/seed-test-data.mjs"],"cwd":"/path/to/app","timeoutMs":30000},
    "cleanup":{"executable":"node","args":["scripts/cleanup-test-data.mjs"],"cwd":"/path/to/app","timeoutMs":30000}
  }
}
```

每条用例/尝试和晋升验证重新 prepare；准备失败依赖项为 blocked，仍尝试 cleanup。断言失败和取消后也尝试 cleanup，清理拥有自己的 timeout，不继承已取消信号；清理失败独立记录并使完整通过变为 inconclusive。不要把生产数据删除命令当作测试 fixture。
