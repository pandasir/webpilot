# 贡献与提 issue 前请先看这里

WebPilot 是本地执行的验收工具，很多“看起来像 bug”的问题其实是环境或目标项目配置不到位。为了少绕弯路，请先按下面的顺序自查，再来提 issue。

## 提 issue 之前

1. 跑一次 `node dist/cli/index.js doctor`，确认 Node 22+、Chromium、存储三项都是 ready。
2. 看看 [安装说明](docs/installation.md) 和 [项目接入](docs/project.md)，安装与目标配置的问题基本都在里面。
3. 搜索现有 issue、[Discussions](https://github.com/pandasir/webpilot/discussions) 和 [兼容记录](docs/compatibility.md)，确认不是已知限制。
4. 准备脱敏后的证据：报告 JSON、run id、失败步骤的错误码。真实账号、Cookie、内部数据不要贴。

## 选哪个模板

| 情况 | 模板 |
|---|---|
| 执行结果不对、步骤失败、报告或看板显示异常 | 🐛 缺陷报告 |
| 想加新能力、新断言、新宿主支持 | ✨ 功能建议 |
| 目标项目启动不了、定位不到元素、登录态接不进去 | 🧩 接入问题 |
| 文档写错、过时、跟着做走不通 | 📄 文档问题 |

只想问“怎么用”，不用开 issue，发到 [Discussions](https://github.com/pandasir/webpilot/discussions) 的 Q&A 分类即可；先翻 [README](README.md) 和 [接口说明](docs/interfaces.md) 也常常能直接解决。

Discussions 只在 GitHub 仓库开着，GitLab 镜像上没有这个功能，那边想提问就直接开 issue。

## 两个托管平台的模板不一样

`.github/ISSUE_TEMPLATE/` 下是 GitHub 专用的 Issue Forms（YAML 表单，能强制必填、有下拉选项），只在 GitHub 仓库生效。

`.gitlab/issue_templates/` 下是 GitLab 版的 Markdown 模板，字段与 GitHub 版一一对应，但 GitLab 只支持 Markdown：没有必填校验，也没有下拉选项，标签靠 `/label` quick action 添加。

改模板时两边都要改，别只改一边。

## 一个高质量的 issue 长什么样

- 说清**期望**和**实际**，而不是先猜原因。
- 复现步骤能让人照着走一遍，包含实际调用的 MCP 工具或 CLI 命令与参数。
- 带上 `doctor` 输出和版本号，跨机器复现时这两项最省时间。
- 贴 HTML 片段而不是描述元素长什么样，定位问题往往就卡在这。

## 提 PR

```sh
npm run typecheck
npm test
```

`npm test` 会先 build，再跑全部真实浏览器用例。测试需要 loopback 服务和启动 Chromium 的权限。

改动涉及界面或执行行为时，同步更新对应的 `docs/*-acceptance.md`；改了用法就更新 README 与 `docs/interfaces.md`。
