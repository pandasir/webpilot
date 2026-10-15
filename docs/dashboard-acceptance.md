# 共享实时测试中心验收记录

记录日期：2026-10-15。平台：macOS arm64，Node v26.7.0，仓库锁定的 Playwright/Chromium。OpenSpec change：`add-shared-live-test-dashboard`。

## 自动化结果

- 类型检查、TypeScript/Vite 构建通过。前端位于 `dist/dashboard/public`，CLI 与 MCP 构建产物保留。
- 完整 `npm test`：41/41 通过，包含原有验收、增量会话、四态、清理、重试、录像与独立导出测试。
- 新发行包独立验收：3/3 通过。测试从包内启动 Dashboard 服务及两个 MCP 进程，浏览器加载包内静态资源；没有使用安装到当前桌面应用的旧 MCP。
- 两个 MCP 使用不同 dataDir，自动接入同一总览。两路直播、各自步骤截图、报告和可播放/拖动 WebM 已验证；浏览器无脚本异常。
- 服务运行中重启后，无需刷新即可恢复两路画面；刷新仍能使用已持久化的本机会话。最终报告不因浏览器读取发生改变。
- 显式停止不取消独立测试，现有客户端不立即启动新服务；恢复后从日志和最终报告收敛。执行器意外终止时，只标记该运行中断，不伪造业务失败，另一条运行继续通过。用受控延迟报告验证最终报告优先。
- 已验证单实例竞争、陈旧锁、PID 身份不匹配、占用端口回退、协议不兼容拒绝复用、实例替换保护，以及活跃运行保留与过期索引撤销。
- 已验证无观看者不采集、多观看者复用、最后观看者离开后释放、静态初始画面、页面/尝试隔离、独立禁用直播、CDP 不可用降级、慢观看者隔离及超大消息拒绝。
- 已验证 HTML/脚本证据作为文本展示、认证与来源限制、Range、路径及符号链接逃逸拒绝。直播帧不落盘或作为 MCP 媒体输出；独立导出关闭直播且不依赖 Dashboard 服务。

本次发现并修复的并发问题包括：登记中途断开时连接状态残留、增加观看者时重复启动采集、关闭服务后仍有索引写入，以及重复终止进度记录。回归测试覆盖了相关生命周期。

## 发行包与复现

本地候选市场为 `.webpilot/releases/shared-live-dashboard`，插件位于其中的 `plugins/webpilot`。发行包包含运行依赖、编译后 MCP/CLI/服务和静态前端。目标项目不需要添加 WebPilot 依赖。

在源码仓库运行：

```sh
npm run typecheck
npm test
node scripts/package-plugin.mjs .webpilot/releases/shared-live-dashboard
WEBPILOT_ACCEPTANCE_PACKAGE="$PWD/.webpilot/releases/shared-live-dashboard/plugins/webpilot" node --import ./tests/dashboard-env.mjs --test tests/dashboard-browser.test.mjs
npm run benchmark:dashboard
openspec validate add-shared-live-test-dashboard --strict
```

浏览器证据位于 `.webpilot/reports/dashboard-acceptance/`：`overview.png`、`parallel-live.png`、`recording.png`、`result.json`。该目录忽略提交；临时运行数据和测试服务在验收结束后清理，截图中的地址不保留为访问入口。

## 双路观看开销

同一测试样例交替运行三组：每组两个独立 MCP、各 5 个步骤、默认录像开启；基线只打开总览，观看组打开并排直播。原始数据为上述目录的 `benchmark.json`。

| 指标 | 只打开总览 | 双路观看 |
|---|---:|---:|
| 测试平均总耗时 | 3488 ms | 3424 ms |
| Dashboard/测量 Node 平均 CPU 时间 | 108 ms | 110 ms |
| Dashboard/测量 Node 平均峰值 RSS 增量 | 0.86 MiB | 7.72 MiB |
| 每组收到的画面数 | 0 | 8–9 |
| 每组帧传输 p95 | — | 3–4 ms |

CPU 与 RSS 仅计算 Dashboard 和测试脚本所在 Node 进程，不包括两个 MCP 或 Chromium；RSS 增量受 GC、缓存和启动顺序影响。帧延迟从执行器交付画面时刻算到浏览器 WebSocket 接收，不包含 CDP 采集与图片绘制。耗时差异为 -1.83%，只能说明该样例没有观察到明显变慢，不能据此声称直播加速测试。样例大部分时间静止，不是动画压力测试。

运行上限为 JPEG quality 65、1280×720、约 8 FPS、单帧和 WebSocket 缓冲 2 MiB；缓冲未清空时丢弃新画面，慢观看者不阻塞执行。

## 桌面宿主安装与回滚实测

OpenSpec 任务 8.4 已完成。用户授权后，使用 Codex CLI `0.162.0-alpha.17.2` 将候选包安装到当前桌面应用，并创建两个真实本地聊天；两者通过已安装插件的 MCP 工具操作合成页面，没有以源码 CLI 或手动 MCP 进程替代。

安装前保存原市场位置和已安装包到 `.webpilot/releases/before-shared-live-dashboard`。安装后核对 MCP、Dashboard 服务、前端及 verify Skill 与候选包一致。当前插件版本号仍为 `0.1.0`，以包内容及工具清单区分此次更新。

| 验收项目 | macOS 实测结果 |
|---|---|
| 首次自动打开 | 聊天 B 的 `dashboard_open` 返回 `opened=true`、`shouldOpen=true`，系统打开命令成功 |
| 后续聊天复用 | 聊天 A 返回 `opened=false`、`shouldOpen=false`，两者接入 `http://127.0.0.1:4318` |
| 双路画面与进度 | 同页并排显示 A/B 独立浏览器直播；各自填写、提交、文本检查通过，步骤截图分别保存 |
| 显式停止 | 两个原会话继续完成第二组填写、提交、断言；服务保持停止，没有自动重启 |
| 重新打开与证据 | 两条运行均恢复为已结束、各 6 步；两路 WebM 实际播放，时长分别为 189.4 秒和 231.4 秒 |
| 回退旧包 | 注册备份市场并安装旧包，工具清单为 15 项且无 `dashboard_open`；真实浏览器 suite 通过，JSON/Markdown 报告可读 |
| 恢复新版 | 切回候选市场重新安装，工具清单为 16 项；新版 `report_read` 成功读取刚由旧版生成的报告 |

聊天 A 首回合未发现 `dashboard_open`，留下真实阻塞记录；重新发现工具并进入新回合后成功调用，未重启桌面应用。不能据此保证所有宿主都支持热更新；[OpenAI 官方本地插件更新说明](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually)仍要求更新后重启桌面应用。

这两个桌面聊天使用探索会话，断言通过仅代表相应步骤，界面显示“已结束”，没有伪造正式 suite 通过结论；正式运行报告与不同 dataDir 并发已由前述包级自动化覆盖。两聊天使用同一默认 dataDir，但拥有不同 MCP 进程和运行 ID。

真实验收记录位于 `.webpilot/reports/dashboard-acceptance/`：`installation.json`、`desktop-A.json`、`desktop-B.json`、`desktop-A-after-stop.json`、`desktop-B-after-stop.json`、`desktop-parallel.jpg`、`desktop-result.json`、`rollback.json`、`restored.json`。旧包、报告和证据保留；合成页面服务已停止。最终保留新版安装及共享看板，供用户查看，不注册开机服务。

Windows/Linux 的打包启动、原生浏览器打开、进程身份与桌面插件流程尚未做机器实测，不能沿用本次 macOS 结果宣称验证通过。
