# 运行标题验收

2026-10-15，`add-descriptive-run-titles` 的创建命名、默认标题和显示名称重命名已实现。

- `npm run typecheck`、`openspec validate add-descriptive-run-titles --strict` 通过；完整 `npm test` 的 62 项测试全部通过，含新增 6 项标题数据层、接口和真实 Chromium 回归。
- 验证任务标题由 `session_open.title` 传入进度及会话，沿用脱敏；缺省调用保持兼容，项目/host 自动名称不包含完整路径或 URL 查询，套件范围名称保留。
- 验证活跃、已结束和归档记录重命名，独立显示文件不修改原始 live/session/events，不覆盖归档和永久保存属性。执行器继续写入、跨页面、搜索和重启后均保留显示名。
- 验证空白、超长、控制字符、未认证、外部来源和任意路径字段请求被拒绝，归属替换/删除竞争不越界或复活记录；损坏显示名称可重新保存修复。
- 真实浏览器验证取消、Escape、关闭不写入，错误时保留输入供重试，HTML 片段作为纯文本显示，随后打开的删除确认使用新名称。
- 独立 Playwright 导出与原归档永久保留、删除补偿、旧记录兼容回归继续通过；没有新增运行依赖。

浏览器证据位于忽略提交的 `.webpilot/reports/run-title-acceptance/`：`rename-dialog.png`、`renamed-archive.png`。回归使用临时运行和服务，未改名用户真实历史记录。

已通过 `npm run package:plugin` 打包，备份原插件至 `.webpilot/releases/before-descriptive-run-titles` 后重新安装。已核对核心标题、服务、进度、投影、管理、Dashboard 页面和验证技能与发行包哈希一致，并在原地址 `http://127.0.0.1:4318` 重启共享看板。

安装验收时共享列表为空，未添加演示记录。另以已安装插件启动隔离的临时看板，通过 Browser 实测任务标题、重命名弹窗与保存成功，截图为 `installed-rename-dialog.png`。临时服务及数据已清理，浏览器已回到共享看板。安装前快照和结果分别为 `before-update.json`、`result.json`；已有聊天中的常驻 MCP 进程未被强制中断。
