# 运行归档与删除验收

2026-10-15，变更 `add-run-archive-and-delete` 已完成实现与本地验收。

- `npm run typecheck` 通过；`npm test` 全部 53 项通过，其中新增 10 项管理数据层/接口测试和 2 项真实 Chromium 管理交互测试。
- 已验证归档永久保存、撤销/恢复后仍永久保存，以及超过原保留期 90 天后显式 prune 仍保留证据。
- 已验证报告、截图及可播放 WebM 在归档后可访问，原详情链接不变；执行结果和原事件日志不因管理操作改变。
- 已验证删除前弹窗确认，取消、关闭和 Escape 不发送删除请求，焦点默认在取消按钮；只有确认后删除。
- 已验证批量可选择多于两条、只全选当前页、切换条件清空选择、固定确认集合、部分失败保留选择供重试、删空末页回退。
- 已验证两个存储根、跨页面详情同步、重启和索引重建、已删除 ID 不再发现、重复删除幂等。
- 已验证跨进程锁与清理竞争、损坏策略保守保留、执行器状态限制、符号链接替换拒绝、冲突存储根不重定向删除，以及删除中断和部分文件已清理时的补偿。
- 已验证独立 Playwright 导出继续运行；导出执行快照包含 Store 所需的 `dashboard/projection.js`，不引入 Dashboard 服务或 ws/React 运行依赖。
- `npm run package:plugin` 通过。已检查 `.webpilot/marketplace/plugins/webpilot` 内管理运行时、Dashboard 服务及页面资源，确认归档、确认删除文案及管理实现已打包。

浏览器证据保存在忽略提交的 `.webpilot/reports/run-management-acceptance/`：`archived.png`、`delete-confirmation.png`、`batch-archive.png`、`result.json`。所有操作使用临时目录和测试记录，未归档或删除用户真实历史数据；验收服务和浏览器均已关闭。

2026-10-15，按用户要求完成已安装插件更新与共享 Dashboard 重启。`webpilot-local` 已指向当前 `.webpilot/marketplace`，插件重新安装至 `/Users/edy/.codex/plugins/cache/webpilot-local/webpilot/0.1.0`；管理、存储、Dashboard 服务、注册表和页面资源与验收发行包的 SHA256 全部一致。旧版插件已备份至 `.webpilot/releases/before-run-record-management`。

看板在原地址 `http://127.0.0.1:4318` 启动，新服务实例已确认，原有 8 条运行记录全部保留。真实页面已核对“当前记录 / 已归档”“批量管理”“归档并永久保存”和“删除…”入口，未对用户真实记录执行归档或删除。更新前后结果和截图保存为上述证据目录内的 `update-before.json`、`update-result.json`、`installed-dashboard.png`。已有聊天中常驻的 MCP 进程未在本次操作中强制重启。

回滚时需保留永久保存规则，或暂停不识别该标记的旧版清理器。已保存回归用例、项目文件和独立导出包不属于运行删除范围。

2026-10-15，补充旧探索记录兼容修复：没有执行元数据和日志、会话明确关闭或已有可读取定稿录像的历史记录可以管理；不生成虚假执行器身份，未知日期和时长显示为未知。损坏元数据、已有日志、明确未关闭、无定稿录像、空录像、外部路径、符号链接及活跃执行器仍拒绝管理。

修复后 `npm run typecheck`、全部 56 项测试（含新增 3 项数据层/真实浏览器回归）、严格 OpenSpec 校验及插件打包通过。已重新安装插件，核对管理模块、投影、协议、服务与页面资源哈希，并重启共享看板。在真实历史记录 `run-b28545e0-39c4-4ca8-a2cf-44e065cd45e0` 上确认管理按钮可用、删除弹窗可打开并取消，操作前后 `session.json` 哈希一致。新增证据为 `legacy-before-update.json`、`legacy-fix-result.json`、`legacy-delete-confirmation.png`（临时测试记录）及 `legacy-installed-confirmation.png`（安装后的真实记录）。更新前插件备份在 `.webpilot/releases/before-legacy-record-fix`。
