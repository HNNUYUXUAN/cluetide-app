# ClueTide

## 赛道演示 · Track demos

| Track | Live demo | Review source |
| --- | --- | --- |
| GCC · 调查与证据 | [GCC Demo](https://hnnuyuxuan.github.io/cluetide-app/gcc/) | [GCC source and bilingual guide](https://github.com/HNNUYUXUAN/cluetide-review/tree/GCC) |
| BOT · Evidence version history | [English BOT Demo](https://hnnuyuxuan.github.io/cluetide-app/bot/) | [BOT source and English guide](https://github.com/HNNUYUXUAN/cluetide-review/tree/BOT) |

These static demos contain public case material, evidence downloads and browser verification. Full local services and their setup instructions are available in the public review branches. 本仓库 `docs/gcc` 与 `docs/bot` 托管各赛道构建产物；公开源码及当前启动说明位于对应评审分支。

GCC 工作台入口现在提供 UNI / Euler 双案指引和本机实时调查入口。实时模型的启动、实际进度、证据与版本接续见 [GCC 实时调查指南](https://github.com/HNNUYUXUAN/cluetide-review/blob/GCC/docs/LIVE-DEMO.md)。The hosted GCC workbench guides visitors to the two public cases and local live execution; replay reports remain labelled synthetic examples.

The BOT demo presents four verified transactions on **BOT Mainnet 677**: deployment, v1, an exact-version review, and v2 with parent v1. [Registry contract](https://scan.botchain.ai/address/0x951f7b5c68adba4cefd7fa851cb8e030426e81aa) · [Mainnet proof archive](https://hnnuyuxuan.github.io/cluetide-app/bot/mainnet/bot-mainnet-workflow-20261008.json). The complete receipt files and final getter snapshot are published in `docs/bot/mainnet`.

ClueTide 将 Ethereum 大额 Transfer 告警整理成有范围、可引用、可导出的调查证据，并支持报告版本更正与 BOT 合约复核。默认运行公开历史快照和 FunctionModel 规则模拟，便于在本地完整体验调查、导出、第二客户端导入、复核与 v1→v2 更正。

公开静态体验入口为 [离线证据 Demo](https://hnnuyuxuan.github.io/cluetide-app/)（[静态文件](docs/)）。完整本地应用使用 Python 后端与 React 前端；静态 Demo 的功能范围在页面中标明。

## 本地启动

环境：Python 3.12 x64、Node.js 20.19+ 或 22.12+，原生 Windows PowerShell。后端仅监听本机，运行状态首次启动时写入 `local-data/`。

```powershell
py -3.12 -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements-lock.txt
Set-Location frontend
npm ci
npm run build
Set-Location ..
./scripts/run-local.ps1
```

打开 <http://127.0.0.1:8765>。默认端口可用 `run-local.ps1 -Port 8766` 修改。默认离线模式无需 API key 或钱包。全量锁文件含测试与本地 EVM 依赖；用于开发的安装也可使用 `pip install -e ".[dev]"`。

前端开发在后端 8765 端口运行时执行 `npm run dev`，Vite 的 `/api` 代理连接该本地后端。生产构建由 FastAPI 在同一地址提供页面与 API。

## 调查与复核

1. 选择 Uniswap 提案 93 或 Euler DAI 公开案例，检查地址、ERC-20 与有限区块窗口，开始离线调查。金额使用 uint256 十进制字符串，采集区分完整覆盖、空结果与错误。
2. 查看回执、来源摘要、解释候选与逐项证据引用。规则模拟可以演示按观察补查，但其轨迹属于确定性本地运行。
3. 导出 ZIP，在第二个本地客户端导入。导入同时验证安全路径、结构、每成员哈希及引用关联；哈希对应包内字节。
4. 对固定版本填写复核意见，或更正解释形成 v2。父版本内容哈希与案件身份共同绑定版本关系。

Uniswap 样例的 1 亿 UNI dead-address Transfer 有治理执行证据。该事件与 ERC-20 `totalSupply` getter 的减少是独立判断。Euler 案例保留单笔 DAI 交易与明确来源范围，整起事故的损失或恢复情况需要相应证据。

两案的公开 RPC 请求、响应、来源摘要和目录 manifest 位于 [data/cases](data/cases)。来源原站链接与实际核读范围保留在各案 `sources.json`；项目事实摘要为自写内容。

## BOT 合约与钱包

`ClueTideRegistry` 提供 Case、Version、Review 存储，约束作者、同案父版本、当前父版本及固定版本复核。已提交 artifact 可直接用于准备参数、只读 getter 验证和本地 Py-EVM 测试。

```powershell
./.venv/Scripts/python.exe scripts/bot_registry.py networks
./.venv/Scripts/python.exe scripts/bot_registry.py rehearse
```

`rehearse` 在进程内 Py-EVM 中部署并执行合成 v1/v2 证据的版本与复核流程。钱包工作台显示网络、公开账户、合约、方法、案件版本、价值 0 和确认提示；用户确认后由钱包提交交易。后端提供参数准备与只读校验。

浏览器将原链、公开发送账户、合约、动作、本地版本身份和完整交易哈希保存在有版本与完整性校验的本地回验记录中。页面刷新或钱包账户、网络变化后，可选择该记录直接读取原交易回执与 getter。新的签名前重新准备当前钱包上下文。记录可包含公开链上身份，使用共享浏览器时应按个人信息范围管理。

真实 BOT 测试网或主网操作需要用户钱包权限、Gas 和实际回执。自控的本地作者与复核者角色用于验证流程；独立认证需要独立参与者与相应依据。

合约 artifact 使用 Solidity `0.8.30+commit.73712a01`、Paris、optimizer runs 200。重新编译可自行安装对应 Windows `solc`，然后运行：

```powershell
./.venv/Scripts/python.exe contracts/compile.py --compiler .tools/solidity/solc-0.8.30.exe
```

编译器文件的固定 SHA-256 为 `ccbd3ed44d5fbd26fe039702d403421f1212d2e8752e3cbe3bfd074986911586`。脚本只消费本地文件；运行应用与既有 artifact 测试无需编译器。

## 可选在线能力

Ethereum 在线采集使用只读 RPC 白名单和 finalized 有限窗口。可在本地环境变量中配置 `ETHEREUM_RPC_URL`；公开证据以提供者标签记录来源，私人配置保持本地。

真实模型入口使用 PydanticAI 的显式 OpenAI Chat Completions 模型、Tokendance 路由和非流式请求。支持 `deepseek-v3.2` 与 `minimax-m2.7`。本地配置 `TOKENDANCE_API_KEY` 后，还需启用具有 UTC 到期时间的 `local-data/paid-session.json`，格式为 `{"enabled": true, "expires_at_utc": "实际未来UTC时间"}`。每次付费运行先核验余额与路由报价，使用持久预算账本保守预留成本；默认账本上限为 10 元人民币。最多 6 个模型请求、8 次工具尝试和 180 秒，失败请求与工具尝试同样受边界约束。应用会保存停止、partial 和 budget_exhausted 状态供继续复核。

`.env`、运行数据库、预算账本及会话配置均为本地文件。公开源码和静态 Demo 的运行范围与用户自行开启的在线能力分别记录。

## 验证与打包

```powershell
./.venv/Scripts/python.exe -m pytest -q
./.venv/Scripts/python.exe -m pip check
./.venv/Scripts/python.exe scripts/build_public_fixtures.py
./.venv/Scripts/python.exe scripts/package_demo.py --include-demo
```

`data/fixtures/` 中 v1/v2 是公开 RPC 观察和明确标注的合成解释，用于引用校验、导入和版本更正测试。生成脚本使用固定时间与 ZIP 成员规则，重新生成后可按哈希核验。公开打包脚本采用产品目录允许清单，包含自有源码、启动文件、两案快照与上游许可；输出在本地 `local-only/deliverables/`。

## 许可

ClueTide 自有源码采用 [MIT](LICENSE)。上游依赖保留各自署名、声明和 203 份许可原件，详见 [依赖与许可](data/attribution/README.md)。公开案例中的事实、来源解释和合成运行轨迹保留其各自观察范围。
