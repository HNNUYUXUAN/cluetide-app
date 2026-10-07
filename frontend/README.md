# ClueTide 前端

React 19 与 Vite 提供案件入口、调查证据、解释候选、引用报告、ZIP 导入与版本复核，以及 BOT 钱包参数与持久只读回验。

```powershell
npm ci
npm run build
```

生产构建由项目 FastAPI 本地服务提供，启动方式见 [根 README](../README.md)。开发时先在 8765 启动后端，再执行 `npm run dev`，Vite `/api` 代理连接同一本地后端。

钱包签名前的上下文与已提交交易的只读回验上下文分别维护。回验记录使用带版本的最小公开字段与 SHA-256 绑定，允许页面刷新后显式恢复原链交易身份；恢复过程只读取回执和 getter。
