# 桌面工作台 UI 验收

日期：2026-10-15。

## 改版范围

使用浅灰侧栏、白色内容区和紧凑运行列表。总览统计合并为一行，状态仅以小面积色点及标签区分；详情保留执行时间线和更宽的画面区域。沿用 React + Vite，不增加前端运行依赖。

侧栏提供所有运行、正在执行、失败记录和已归档入口。范围和状态写入 URL，刷新后保持；切换范围清空选择，同时保留批量管理模式。桌面展示独立日期、进度和耗时列，较窄窗口将日期与耗时放到名称下方；手机将导航改为顶部横排，详情与并排观看改为纵向布局。

## 验证结果

- `npm run typecheck`：通过。
- `npm run build`：通过。
- 相关浏览器回归共 8 项：全部通过。
- 新增 `tests/dashboard-workspace-browser.test.mjs`：覆盖侧栏筛选及刷新、归档入口、范围切换保留管理模式、320/375/768/1280/1440px 宽度的页面溢出、菜单边界和长标题详情。
- 既有回归：覆盖独立 MCP 双路直播、服务重启、截图/报告/可播放录像、历史记录、归档及撤销、批量管理、永久删除确认、重命名、跨页面同步及不可信内容按文本展示。
- WebPilot 单次浏览器探索：运行总览、失败筛选、详情时间线、步骤预期结果及返回总览检查通过；会话正常关闭，录像定稿，无清理错误。探索记录本身不代表全部业务验收。

复现命令：

```sh
npm run typecheck
npm run build
node --import ./tests/dashboard-env.mjs --test --test-concurrency=1 \
  tests/dashboard-browser.test.mjs \
  tests/dashboard-workspace-browser.test.mjs \
  tests/run-management-browser.test.mjs \
  tests/run-titles-browser.test.mjs
```

## 界面证据

`.webpilot/reports/workspace-acceptance/` 下保存了 `desktop-overview.png`、`desktop-step-detail.png`、`mobile-overview.png` 和 `mobile-detail.png`。桌面视觉预览使用独立临时演示数据；自动化回归各自创建并清理临时存储。

本次验证使用 macOS Chromium，未在其他浏览器引擎或真实移动设备上验证。
