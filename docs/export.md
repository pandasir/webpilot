# 独立 Playwright 导出

`case_export` 或 CLI `export` 在指定的新目录生成 `plan.json`、`manifest.json`、`webpilot.spec.mjs`、`playwright.config.mjs`、`package.json`、README 和执行内核快照 `runtime/`。已有目录会返回 `EXPORT_EXISTS`，不会覆盖文件。

独立包只依赖 Playwright 与 Zod，无需安装 WebPilot 或提供模型凭证。它使用与解释执行相同的定位、唯一性、等待、iframe/新页面切换、断言和结果分类。整个计划作为一个 Playwright test 执行，保持 suite 共享预算；Playwright 外层 retries=0，内部重试记录由计划控制。

导出包不携带已有运行的录像、播放器或原始 trace。独立包执行时遵循目标的 `evidence.video` 配置，默认生成本次运行自己的本地录像及播放器；可通过 `WEBPILOT_TARGET_CONFIG` 的 `evidence.video:false` 关闭。录像未经脱敏，不应作为公开 CI 附件上传。

```sh
cd /path/to/export
npm install --ignore-scripts
npx playwright install chromium
BASE_URL=http://localhost:3000 npm test
```

Windows PowerShell 可使用 `$env:BASE_URL='http://localhost:3000'; npm test`。安装后生成的 lockfile 应由接收方纳入版本控制，后续使用 npm ci。

地址、机器路径和 data 命令不会从目标配置直接打包；角色登录态仅保存引用名。绑定通过 `WEBPILOT_BINDINGS_FILE` 外部 JSON 提供；数据生命周期通过 `WEBPILOT_TARGET_CONFIG` 外部目标配置提供。原计划有 prepare/cleanup 时，导出包要求对应接口存在，否则明确阻塞。用等价配置恢复身份和数据，不能用配置覆盖预期来规避失败。

```sh
node /path/to/webpilot/dist/cli/index.js export-verify \
  --directory /path/to/export --url http://localhost:3000 \
  --bindings /path/to/bindings.json --target-config /path/to/equivalent-target.json
```

清单初始 `verified:false`，列出用例版本、外部引用、数据要求和能力缺口。`export-verify` 有界执行独立包，稳定完整通过才更新 verified=true；失败再次变回 false。测试 JSON 报告作为 Playwright 附件保留。未知 schema/操作在导出前拒绝；显式 unsupported 步骤保留在计划和 gaps 中，执行结果不可能算作通过。

移交项目或 CI 时复制整个目录及 lockfile，准备 Chromium/系统依赖、BASE_URL 和外部配置，再执行 npm test。runtime 是发行时快照：升级运行器需要重新导出到新目录并审查差异。业务断言改变仍需新的需求依据和采纳记录。
