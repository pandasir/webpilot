# 发布版本与运行时版本一致性验收

日期：2026-11-16。环境：macOS arm64、Node 26.7.0、仓库锁定的 Playwright/Chromium。对应 OpenSpec：`fix-release-runtime-version-consistency`。

## 当前构建版本对照

本次不升级发布号。package.json.version 为 0.2.0，插件清单和锁文件根版本原本已一致；修复共享构建版本来源，并增加显式同步、源/构建/候选包校验。

| 位置或入口 | 实际验证值 | 验证方式 |
|---|---|---|
| package.json.version | 0.2.0 | 源校验读取唯一维护源 |
| package-lock.json 两个本项目根版本、plugin.json、plugin-compat.json | 0.2.0 | 精确相等校验，第三方依赖不参与比较 |
| dist/core/release.json 与 version/schema 的 VERSION | 0.2.0 | 构建生成快照，子进程读取实际编译模块 |
| 临时候选包的 package、锁文件根字段与两份插件清单 | 0.2.0 | 包内校验，不复用源码进程缓存 |
| 候选包 MCP serverInfo.version、runtime_info.version、runtime_doctor.version | 0.2.0 | 从临时候选包启动真实 stdio 服务并调用工具 |
| 候选包 CLI doctor.version | 0.2.0 | 从候选包绝对路径启动新 Node 进程 |
| suite 与 planned session 的 environment.runner | 0.2.0 | 真实浏览器完成正式断言，并核对 JSON 与 Markdown |
| 独立导出 manifest.generator、独立运行 environment.runner | 0.2.0 | 仓库外执行独立包；外层 package.version 修改为 9.8.7 后仍保持执行器版本 |
| 旧报告 environment.runner、旧导出 generator | 0.1.0 | 新读取与回放流程未追溯改写，历史文件字节不变 |

版本期望从当前 package.json 动态读取，测试不把所有位置都写死为 0.2.0。另在临时 fixture 中使用 `0.3.0-beta.1+build.5`：同步、构建版本模块和候选包校验保留完整后缀，真实 MCP 握手、runtime_info、doctor 与 CLI 同样返回该值。真实仓库及已安装插件未改成预发布版本。

## 失败与边界验证

- 源清单或锁文件根版本遗漏时，检查以非零状态逐项列出文件、字段、期望与实际值；校验不修改源文件。显式 sync 只更新四个镜像字段，依赖节点及其他 JSON 内容保持不变。
- 源与清单更新但构建仍旧时，直接 package-plugin.mjs 拒绝打包；缺少元数据、编译模块版本不一致也不能通过。现有输出文件在失败时保持原样。
- 候选包兼容清单被改为旧版本时，交付校验失败，既有有效市场未被替换。新包通过后维持原 marketplace/plugin 返回结构，不残留本次暂存与备份目录。
- 打包拒绝仓库本身、被复制的源码目录及其路径别名；非空无关目录不会被替换。已有输出必须为空或可识别的单插件 WebPilot Local 市场。
- 构建元数据缺失、损坏、版本格式无效时，执行器明确提示 build/reinstall，不回退到旧常量、工作目录、外层包或环境变量。加载后的版本固定；导出前能识别磁盘快照被另一版本替换。
- 干净源代码副本在没有任何 release.json 的情况下完成 TypeScript noEmit 检查，版本生成文件只位于 dist。
- 独立版本模块在 Node 文件系统权限仅允许导出目录、明确拒绝读取原仓库的子进程中仍可加载；独立包随后实际执行并产生正确版本报告。移除导出元数据后验证失败，verified=false，generator 不伪造为其他版本。
- apiVersion、schemaVersion、Dashboard PROTOCOL、覆盖 revision 和用例版本分别保持原语义；发布身份修复不作为协议兼容判断条件。

断言见 `tests/release-version.test.mjs` 和 `tests/release-version-browser.test.mjs`。所有候选包、失败 fixture、服务、浏览器与独立导出使用临时目录并清理；未注册市场、安装插件、访问模型服务或修改当前宿主运行进程。

## 检查结果与复现

- `npm run check:version` 与 `npm run check:version -- --built`：通过。
- `npm run typecheck`：通过，包含后端与 Dashboard UI。
- `npm test`：构建通过，125/125 测试通过，0 失败、0 跳过，约 102.9 秒；包括既有配置与回放一致性测试。
- 本次新增目标测试：9 项版本/打包测试与 3 项真实候选包/报告/导出测试通过。
- `openspec validate fix-release-runtime-version-consistency --strict` 与 `git diff --check`：通过。

本机日志保存在 `.webpilot/reports/release-version-consistency/`，沿用仓库忽略规则。可在源码目录重新运行：

```sh
npm run check:version
npm run typecheck
npm test
npm run check:version -- --built
openspec validate fix-release-runtime-version-consistency --strict
```

仅重跑本次目标测试时，先 build，再执行：

```sh
npm run build
node --import ./tests/dashboard-env.mjs --test --test-concurrency=1 tests/release-version.test.mjs tests/release-version-browser.test.mjs
```

CI 已在现有 macOS/Linux/Windows、Node 22/24 流程加入源与构建版本检查；本次实际运行结果仅代表上述 macOS 环境。版本一致不能证明同版本代码内容一致；代码变更仍需重新构建。当前宿主只有在安装新包并启动新进程后才会加载该构建，已有进程和历史产物不被重新标注。
