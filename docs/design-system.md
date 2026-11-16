# 测试中心设计系统

WebPilot 的视觉规范以仓库根目录的 [DESIGN.md](../DESIGN.md) 为准。该文件来自
[awesome-design-md](https://github.com/VoltAgent/awesome-design-md) 的 NerdWallet
分析：深林绿主色、薄荷色阶梯、发丝边框、近乎无阴影的层级，适合本机测试工作台这类
信息密集但需要长期阅读的界面。

## 接入方式

- `DESIGN.md` 定义视觉语言、组件规则和 Do's / Don'ts。
- `dashboard-ui/src/tokens.css` 把规范中的色板、间距、圆角、字体和阴影映射为 CSS 变量。
- `dashboard-ui/src/style.css` 只通过变量使用颜色、圆角、阴影和字体，不再新增临时色值。

项目当前使用 Vite + 原生 CSS，没有引入 Tailwind。若以后接入 Tailwind v4，可在
`@theme` 中直接引用 `tokens.css` 的色板与间距变量；Tailwind v3 则把同一变量映射到
`theme.extend`。

## Token 分层

| 层 | 示例 | 用途 |
|---|---|---|
| 原始色板 | `--color-primary`、`--color-mint-100`、`--color-hairline` | 对应 `DESIGN.md` 的 `colors` |
| WebPilot 语义色 | `--color-pass`、`--color-fail`、`--color-warn`、`--color-info` | 通过、失败、阻塞、执行中状态 |
| 间距 | `--space-xs` 到 `--space-section` | 8px 基准的布局节奏 |
| 圆角 | `--radius-xs` 到 `--radius-xxxl` | 控件接近方形，卡片停在 8px |
| 组件别名 | `--radius-control`、`--radius-surface`、`--radius-card` | 看板组件的稳定引用 |
| 字体 | `--font-sans`、`--font-display`、`--font-mono` | Gotham 的替代字体栈与等宽字体 |

## 使用约束

- 主色 `--color-primary` 只用于主按钮、选中态、链接和通过状态。
- 大块区域优先用 `--color-mint-50` / `--color-mint-100` 分隔，不靠阴影堆层级。
- 卡片使用 `--color-hairline-strong` 边框，阴影保持极轻。
- 控件圆角固定为 `--radius-control`，卡片使用 `--radius-card`。
- 状态色只出现在徽标、圆点、进度条和错误提示等小面积元素上。
- 中文字体回退到 PingFang SC / Microsoft YaHei；正文不使用 300 字重，避免小字号发虚。

## 变更流程

调整视觉时先改 `DESIGN.md`，再同步 `tokens.css`，最后检查 `style.css` 是否仍有硬编码
颜色或圆角。涉及布局与交互的改动仍需运行 `npm run typecheck`、`npm run build` 和对应
的浏览器回归。
