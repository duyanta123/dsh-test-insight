# dsh-test-insight

当前实现版本：`1.0.0-rc.2`。

`dsh-test-insight` 是面向 DeepSeek Harness 的测试洞察插件：基于仓库事实和变更风险生成可审查的测试计划与测试草稿。

## 功能

- `all`、`change`、`target` 三种分析模式。
- 基于 scanner 文件、模块、符号、入口和 Git 事实的测试映射、证据等级、风险目标和缺口。
- lcov、Istanbul final/summary、Cobertura coverage 解析，以及目标 × 用例类别矩阵。
- 默认只读；独立测试草稿写入 `.dsh/test-insight/drafts`，不覆盖现有测试。
- 可选的显式授权测试执行：仅 allowlist 命令、`shell:false`、固定工作目录、超时和输出上限。
- 报告记录共享缓存、冷/热命中、端到端性能预算与实际 scanner 版本。

## Development

```powershell
npm i dsh-repo-scanner
npm ci
npm test
npm run pack:check
```

核心扫描能力由 `dsh-repo-scanner` 提供。本项目负责测试证据、缺口识别、风险排序、测试设计和报告生成，不复制 scanner 源码。

## 网络代理

在受限网络环境中，由启动环境提供代理变量后再安装依赖；不把代理地址写入项目配置或报告：

```powershell
$env:HTTP_PROXY="http://127.0.0.1:7877"
$env:HTTPS_PROXY="http://127.0.0.1:7877"
npm ci
```

## 安全边界

分析、scanner 库接口和默认 CLI 路径不执行目标仓库测试、构建、lint 或 typecheck。CLI 仅为 change 输入执行参数化的只读 Git 查询。测试执行必须同时提供 `--execute-tests` 和 allowlist `--test-command`；草稿不能被视为已通过。

发布前检查见 [`docs/RELEASE-CHECKLIST.md`](docs/RELEASE-CHECKLIST.md)。
