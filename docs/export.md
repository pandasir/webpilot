# 独立 Playwright 导出

`case_export` 或 CLI `export` 在指定的新目录生成 `plan.json`、`manifest.json`、`webpilot.spec.mjs`、`playwright.config.mjs`、`package.json`、README 和执行内核快照 `runtime/`。已有目录会返回 `EXPORT_EXISTS`，不会覆盖文件。

独立包只依赖 Playwright 与 Zod，无需安装 WebPilot 或提供模型凭证。它使用与解释执行相同的定位、唯一性、等待、iframe/新页面切换、断言和结果分类。整个计划作为一个 Playwright test 执行，保持 suite 共享预算；Playwright 外层 retries=0，内部重试记录由计划控制。

manifest.generator 记录本次复制的 WebPilot 执行器版本，runtime/core/release.json 与版本模块一起随包移交；实际执行报告的 environment.runner 使用该版本。外层测试包自身的 package.json.version（初始 1.0.0）是独立包的版本，不代表 WebPilot。更改外层版本、移动目录或升级宿主，均不改变已有导出执行器的身份，也不需要访问原源码仓库或注入版本环境变量。

构建版本元数据缺失或损坏会使导出或执行失败，不回退到外层包版本。若运行中的 WebPilot 所在磁盘快照被另一构建替换，需重启执行器后再导出。升级执行器要重新导出完整包，不只更改 manifest.generator 或复制一个 release.json；既有历史清单不追溯改写。

直接导出原始计划时先只读解析项目配置；从运行计划导出时使用已保存的最终配置，不重新读取当前项目配置。导出的 target 保留视口、录像选择、保留期限、预算和角色引用，并携带 targetResolution。移动端 390×844、录像关闭的运行，导出后仍保持相同设置；rawTrace/live 按导出策略关闭。

BASE_URL 和 WEBPILOT_TARGET_CONFIG 中实际提供的设置覆盖导出基准，其他设置保留，解析来源随新运行更新。嵌套对象整体替换，例如外部 evidence 对象应同时明确所需的 video/live 策略；原项目路径已移除，不会因缺少该路径恢复桌面默认值。导出后的外部服务和绑定仍需准备，配置冻结不等于环境冻结。

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
