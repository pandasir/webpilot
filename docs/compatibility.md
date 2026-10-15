# 兼容与发行验收记录

实测日期 2026-10-13，macOS arm64，Node 26.7.0，Playwright/Chromium 1.60.0。机器可读结果和目标文件 SHA-256 见 [compatibility-results.json](compatibility-results.json)。样例依赖独立位于 tests/fixtures，不是插件生产依赖。

| 样例 | 版本 | 接入/验收 | 保存/干净重跑 | 独立 Playwright 导出 |
|---|---|---|---|---|
| React/Vite | React 19.3.0 / Vite 7.3.7 | 通过 | 通过 | 通过 |
| Vue/Vite | Vue 3.5.44 / Vite 7.3.7 | 通过 | 通过 | 通过 |
| Next.js | 16.4.0，SSR + client hydration | 通过 | 通过 | 通过 |
| 静态 HTML | 原生 DOM | 通过 | 通过 | 通过 |
| Monorepo | 两个 Vite 应用及 Next.js，显式选择应用 | 通过 | 通过 | 通过 |

流程覆盖错误密码提示、表单与列表筛选。iframe、新页面、上传下载、延迟加载由辅助浏览器契约覆盖。Next.js 开发工具的 alert 与业务 alert 同名，计划通过 form scope 限定；运行器没有选择任意第一个元素。Next.js 首次启动会由框架生成 AGENTS.md，它已纳入 fixture 基线；验收期间所有受监测源码、依赖声明和 lock 哈希相同。框架构建缓存不算产品源码。

缺陷集：按钮无响应、缺少提示、请求失败 → failed；定位歧义 → inconclusive；延迟条件出现 → passed；失效登录态、数据准备失败 → blocked。请求失败报告保留网络证据，但不把时间相关性当成已验证根因。耗时与 run id 在 JSON 记录中。

静态样例连续五次首次通过，每次尝试数为 1，无隐藏重试。契约测试另行验证 prepare/cleanup 成功、准备失败、断言失败、取消、清理失败、重试先败后过与干净晋升失败。

| 平台 | 核心 CLI/浏览器/导出 | 状态 |
|---|---|---|
| macOS arm64 | 实机 Node 26.7.0 | 已通过 |
| Linux | 提供 Node 22/24 CI matrix | 未执行，不能宣称兼容已验收 |
| Windows | 提供 Node 22/24 CI matrix | 未执行，需重点核查命令启动/进程树与路径 |

当前宿主 Codex CLI 0.162.0-alpha.17.2：已安装并启用 webpilot@webpilot-local；全新 app-server 进程确认四个已安装 Skill 可发现、本地 MCP 已连接且 15 个工具 schema 已加载。发行包 MCP SDK 的工具调用、验收/保存/诊断/导出采用真实 Chromium 检查。无生命周期 hooks，无额外模型 API key。

用户于 2026-10-13 确认任务 8.2 的自然语言验收与保存闭环已完成；该项完成依据为用户确认，未新增执行日志。此前的 SDK 测试记录仍仅代表底层工具验收。CLI 卸载 → not installed → 重新安装恢复已实测，运行资产未删除；setup 首次准备入口返回 ready=true。任务 9.5 的桌面完整发行验收（含诊断、导出及 refresh/UI 显示）仍待完成。宿主明细见 [host-check-results.log](host-check-results.log)。

同日，当前桌面聊天按用户选择使用已保存的 matrix-3 v1 静态表单用例，通过真实 WebPilot MCP 完成基线通过 → 样例副本提示丢失缺陷 → 正式断言失败及报告诊断 → 恢复原字节 → 原用例通过。独立包在项目目录外安装自身依赖并实际执行通过，verified=true；源样例和原始用例未修改，服务已关闭。首次导出验证因临时会话到期而阻塞的记录保留。详见[简体中文验收记录](../.webpilot/reports/desktop-release-20261013/acceptance.md)。此结果补充诊断与导出工作流证据，9.5 中的新聊天与 refresh/UI 验收仍待确认。
