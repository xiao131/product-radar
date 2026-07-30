# 产品雷达 MVP 开发文档

**版本：** 1.0
**对应产品设计：** `product_radar_development_spec.md` v2.2
**目标：** 在本机运行一个可用的 Web/iOS 产品机会数据库，能够接收点子与信号、保存全部候选、完成证据驱动的 AI 调研、动态更新评分，并通过网页排序筛选和分页查看。

## 1. 交付边界

本次 MVP 必须实现：

- 首页：展示最高优先级机会、最近涨分机会和产品摘要；
- 雷达库：展示全部 Opportunity，支持排序、筛选、搜索和分页；
- 调研详情：展示 AI 结论、评分、Web/iOS 平台判断、证据和历史变化；
- 产品库：手工添加和管理 Web、iOS、Web+iOS 产品；
- 信号收件箱：添加 IDEA、评论、链接或导入 CSV；
- 调研任务：将 Signal 转为候选，对候选执行三阶段 AI 判断；
- 数据更新：保存研究版本、分数变化和变化原因；
- 本地持久化：SQLite；
- 可替换 Provider：默认演示 Provider，无密钥也能测试；配置密钥后调用真实 Provider。

本次不实现：

- 自动发布产品；
- 多用户权限；
- Reddit/X 自动采集；
- Search Console OAuth；
- 大规模分布式任务系统。

## 2. 技术栈

```text
Frontend: React 19 + Vite 8 + TypeScript
Routing: lightweight History API router
Styling: Tailwind CSS 4
Icons: Lucide React
Backend: Express 5 + TypeScript
Database: SQLite + better-sqlite3
Validation: Zod
AI: Vercel AI SDK 7 + OpenAI Responses / AI Gateway（可选）
Tests: Vitest + Supertest
Browser QA: 本地浏览器自动化
```

## 3. 功能模块

### 3.1 Signal Intake

输入：

- 手工产品点子；
- Reddit/X/论坛/App Store 评论文本；
- 公开 URL；
- CSV 文件；
- 手工已有产品。

输出：标准化 `signals` 记录。

### 3.2 Collection

Provider 接口：

```ts
interface ResearchDataProvider {
  collect(opportunity: Opportunity, version: number): Promise<EvidenceItem[]>;
  collectBatch(
    requests: ResearchCollectionRequest[],
    delivery?: "live" | "standard",
  ): Promise<Map<string, EvidenceItem[]>>;
}
```

默认 `demo` Provider 返回稳定、可追溯的本地证据，用于无密钥开发和测试。

真实 Provider 已实现：

- DataForSEO Google Ads Search Volume / Web SERP；
- DataForSEO Apple App Data；
- 用户手工导入证据。

### 3.3 Research

输入：Opportunity、关联 Signal、已有 Product、Evidence。

三个阶段：

1. Researcher：事实提取和证据缺口；
2. Advocate/Critic：正反论证；
3. Judge：最终结论、评分、平台和置信度。

真实 AI 使用结构化输出；无 AI Key 时使用确定性的 Demo Researcher，但界面必须明确显示 `DEMO`，不得伪装为真实调研。

### 3.4 Decision

输出：

```text
BUILD_NOW
VALIDATE_FIRST
WATCH
SKIP
```

平台：

```text
WEB
IOS
WEB_AND_IOS
```

排序分由九个维度组成，总分 100；最终结论允许基于致命风险否决高分。

### 3.5 Radar Database

核心表：

```text
products
signals
opportunities
evidence_items
research_reports
discovery_runs
settings
```

候选列表字段与证据行独立存储；研究报告的结构化详情和证据快照存 JSON。
研究报告只新增版本，不覆盖历史。

### 3.6 Presentation

页面：

```text
/
/radar
/radar/:id
/products
/signals
/operations
```

## 4. 数据更新

更新触发：

- 手工刷新；
- 新 Signal；
- 新 Product；
- 新证据；
- 评分模型变化；
- 内置定时任务；
- 新信号关联到已有候选。

更新流程：

```text
新证据
→ 比较旧证据
→ AI 重新判断
→ 新增 research_report
→ 更新 current_score
→ 计算 score_delta
→ 保存 change_summary
```

## 5. API

```text
GET    /api/dashboard
GET    /api/opportunities
GET    /api/opportunities/:id
POST   /api/opportunities/:id/research
PATCH  /api/opportunities/:id

GET    /api/products
POST   /api/products
PATCH  /api/products/:id

GET    /api/signals
POST   /api/signals
POST   /api/signals/import
POST   /api/signals/:id/process
POST   /api/signals/:id/link

GET    /api/settings
GET    /api/health/live
GET    /api/health/ready
GET    /api/auth/session
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/operations/status
POST   /api/operations/research
POST   /api/operations/backup
```

列表接口统一支持：

```text
page
pageSize
sortBy
sortDirection
query
platform
verdict
researchStatus
```

## 6. 环境变量

```bash
PORT=8787
DATABASE_PATH=./data/product-radar.db
RESEARCH_PROVIDER=demo
RESEARCH_FRESHNESS_DAYS=7
RESEARCH_RATE_LIMIT_PER_HOUR=30

DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=
DATAFORSEO_BATCH_POLL_INTERVAL_MS=60000
DATAFORSEO_BATCH_TIMEOUT_MS=14400000

AI_PROVIDER=openai
OPENAI_BASE_URL=https://mdkj.lol
OPENAI_API_KEY=
AI_MODEL=gpt-5.6-terra
AI_REASONING_EFFORT=xhigh
AI_DISABLE_RESPONSE_STORAGE=true

AI_GATEWAY_API_KEY=
```

完整变量与默认值以 `.env.example` 为准。开发环境未配置真实凭据时以 Demo
模式运行；生产环境请求真实模式但凭据不完整时直接拒绝启动。

切换到真实调研需要同时配置：

- `OPENAI_API_KEY`（`AI_PROVIDER=openai`）或 `AI_GATEWAY_API_KEY`
  （`AI_PROVIDER=gateway`）：执行 Researcher、Advocate/Critic、Judge 三阶段判断；
- `DATAFORSEO_LOGIN` 与 `DATAFORSEO_PASSWORD`：获取关键词搜索量、月度变化、
  CPC、Google Organic 竞品和 Apple App Search 市场数据。

OpenAI 模式使用 Responses API，并默认发送 `store=false`。Reddit 与 X 可以先
通过手工信号或 CSV 导入；信号在处理或关联后会成为带原文与来源的证据。

默认情况下，7 天内的调研直接复用缓存。生产调度器和
`npm run research:batch` 共享持久化任务锁、重试、每日预算和任务历史。相同候选
的并发调研返回 `409`，新用户证据会立即把候选标记为待重新判断。

## 7. 测试策略

- 单元测试：评分、分页、过滤、状态转换、CSV 解析；
- API 测试：Product、Signal、Opportunity 和 Research；
- 研究合同测试：Demo Provider 稳定输出、缓存复用、强制刷新后报告版本递增；
- 浏览器测试：首页、雷达库、详情、添加产品、添加点子、处理信号；
- 空状态和错误状态；
- 构建与本地启动验证。

## 8. 验收

当以下条件全部满足时，MVP 才算完成：

- 能添加 Web/iOS 产品；
- 能添加产品点子或评论 Signal；
- 能从 Signal 生成 Opportunity；
- 能执行一次调研并生成带证据的报告；
- 全部 Opportunity 可排序、筛选和分页；
- 数据更新后分数、历史版本和变化原因正确；
- 页面清楚区分 Demo 与真实数据；
- 本地启动、测试和构建全部通过；
- 浏览器主要流程无阻塞错误。

详细需求、模块设计和任务追踪位于 `specs/product-radar-mvp/`。
