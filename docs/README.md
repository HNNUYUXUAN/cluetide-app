# ClueTide 离线证据示例

此静态示例展示 Ethereum 转账调查的证据阅读、合成报告 v1/v2 追溯，以及本地 ZIP 完整性校验。入口为 `index.html`，适用于 GitHub Pages 的项目路径。页面使用相对资源路径与 hash 导航，刷新版本复核和导入页面仍读取同一个入口。

## 本地运行

在仓库根目录执行：

```powershell
python -m http.server 8080 --bind 127.0.0.1 --directory docs
```

打开 `http://127.0.0.1:8080`。SHA-256 使用浏览器 Web Crypto，需要 HTTPS 或本机 localhost 安全上下文。静态页面的运行依赖浏览器原生功能，源码由原生 HTML、CSS 和 JavaScript 组成。

## 阅读流程

1. 在案件页查看一亿 UNI 转账的金额、完整交易哈希、目标地址和有限窗口。
2. 切换转账、回执、治理与覆盖证据，点击候选解释旁的引用查看对应材料。
3. 在版本复核页比较合成 v1/v2，检查 v2 父版本 manifest SHA-256 与已校验的 v1 一致。
4. 下载当前 ZIP 和 manifest，在另一浏览器中导入 ZIP，查看完整性结果及报告、原始数据 JSON。

## 数据来源与解释范围

公开 Ethereum 快照的交易为 `0x091f0083242a777d55821c1189e568d6d033d9da501b75087dc736fa143d2c1e`，事件区块 `24106378`，调查窗口 `24106368–24106388`。事件记录从 Timelock 向 `0x000000000000000000000000000000000000dead` 转移 `100000000000000000000000000` 个原始 UNI 单位，即 18 位小数下的一亿 UNI。

包内原始 RPC 观察来自仓库的公开快照。治理背景采用项目编写的事实摘要与原始页面定位。原始来源包括 [Ethereum 交易](https://etherscan.io/tx/0x091f0083242a777d55821c1189e568d6d033d9da501b75087dc736fa143d2c1e)、[Uniswap 提案 93](https://vote.uniswapfoundation.org/proposals/93)、[UNIfication](https://blog.uniswap.org/unification) 和 [UNI 合约源码](https://github.com/Uniswap/governance/blob/master/contracts/Uni.sol)。页面内原始链接由用户主动打开。

报告由确定性本地构建器生成，属于**合成流程示例**，模型请求、生成时网络读取、签名和广播数量均为零。示例作者、示例复核者表示自控流程角色；v2 由示例作者应用更正，包内更正记录保留实际角色标识。它们展示版本追溯，事实正确性和复核独立性需要额外核验。

候选解释区的“支持”绑定成功回执与交易，“反证”绑定事件前后两次保存的历史 `totalSupply()` getter 读数，“未知”保留完整因果解释的待核对范围。转入 dead 地址、token getter 变化和攻击判断是分别需要证据支持的主张。采集状态说明中的四个按钮解释 complete、empty、partial、error 的含义，案件材料始终保持原始包内容。

## 证据包格式

当前查看器读取 `cluetide-public-evidence/v1` 的固定五文件 ZIP_STORED 包：`manifest.json`、`raw.json`、`evidence.json`、`report.json`、`report.md`。JSON 使用 RFC 8785 规范字节；manifest 记录四个内容文件的大小与 SHA-256，manifest 自身的摘要从其规范字节计算。

浏览器按 16 MiB 上限检查 ZIP 的中央和本地目录、路径白名单、常规文件属性、CRC32、规范 JSON、逐成员大小与 SHA-256，并检查金额字符串、窗口范围和报告引用结构。压缩包不会被解压到磁盘，导入内容按纯文本显示。未压缩 ZIP 是当前静态读取器的支持格式；完整本地应用的导入器还提供其他受限格式支持。

SHA-256 校验确认字节完整性，不能证明事实真实、来源认证或作者身份。静态示例不会请求应用 API、链上 RPC、模型服务或钱包权限；其可交互范围是证据阅读、版本切换、下载和本地校验。

## 示例摘要与复现

| 版本 | Manifest SHA-256 | ZIP SHA-256 |
| --- | --- | --- |
| v1 | `51c6cc079efe6dadaecbd439c7779f0d1c217186de660623c4ea9dca6142cf57` | `b06a69d723b91b83c8ec47e51e343f0dbb778782cab8c05d170ea4b4664d1a09` |
| v2 | `02267fad63c5c669c5767b936cc21c6745c5d2e3f3fa692a5528a99359d34347` | `613bf5662f0735b06f4e74bee1314e67fa144919e0b0ab53fb7268c1fea05d65` |

仓库的 `scripts/build_public_fixtures.py` 从公开快照生成同格式的 v1/v2。静态发布使用 `assets/` 中固定字节的副本，`app.js` 校验上述发布摘要。重新生成数据并更新静态发布时，同步核对副本、摘要常量与本说明。

本目录的项目原创代码和图形适用仓库 MIT 许可证。治理原始网页与合约源码以原链接核读，其各自许可和署名保留在原始来源。
