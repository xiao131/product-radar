# Runtime Settings Design

## Architecture

- 继续以环境变量作为部署默认值。
- 使用现有 SQLite `settings` 表保存管理员覆盖值；服务启动时合并环境默认值与数据库覆盖值。
- 非敏感设置存为一份版本化 JSON；AI Key 使用由 `SESSION_SECRET` 派生的 AES-256-GCM 密钥加密后分 Provider 存储。
- `GET /api/settings` 返回当前生效值与连接状态；`PATCH /api/settings` 校验并持久化；`POST /api/settings/test-ai` 做一次无重试的最小连接测试。
- 配置对象在保存后更新，任务启动时复制配置快照，保证修改只影响新任务。

## Runtime boundaries

- `AI_REQUEST_TIMEOUT_MS` 默认 600000，只用于 AI。
- `PROVIDER_REQUEST_TIMEOUT_MS` 继续用于普通数据供应商 HTTP 请求。
- `DATAFORSEO_BATCH_TIMEOUT_MS` 继续用于 Standard 异步任务轮询。
- 自动发现默认每批 60 条信号、每次最多 5 批；每个后续批次保留少量已审信号作为跨批上下文。

## UI

- 新增 `/settings`，沿用现有 Industrial / utilitarian 视觉系统。
- 左侧为 AI、自动发现、市场、成本和缓存分组；右侧固定展示生效摘要、连接状态、测试与保存动作。
- API Key 输入始终为空，只表示“替换”；已有 Key 仅显示已连接状态。
- 高风险基础设施参数不展示。

## Security

- 所有写接口继续经过现有登录、CSRF 与速率限制。
- 密钥不进入 GET 响应、日志、任务结果或前端状态。
- 没有 `SESSION_SECRET` 时禁止从网页保存 Key，但非敏感设置仍可保存。

## Verification

- 单元测试覆盖配置合并、加密密钥、Anthropic/OpenAI 连接配置、分批归并和错误归一化。
- API 测试覆盖读取、保存、校验和密钥不回显。
- 浏览器验证设置页导航、保存、测试连接和移动端基本重排。
