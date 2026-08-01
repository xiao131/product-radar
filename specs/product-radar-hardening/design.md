# Product Radar Hardening Design

## Decision freshness

- `research_status = READY` 且 `stale_since IS NULL` 才表示“当前结论有效”。
- 数据库保留旧 verdict、分数和 `last_researched_at` 供历史与调度使用；API 增加 `decisionCurrent`，前端在结论失效时隐藏旧结论。
- 失效操作写入 `stale_since`、`change_summary`、`updated_at`，不再清空 `last_researched_at`；若调研正在运行则保持 RUNNING，避免并发启动第二个任务。
- 调研完成时只清除任务开始前已有的失效水位；任务运行期间的新变化会让本次报告保留为历史，但不会被错误标记为当前结论。
- Dashboard 与 verdict 筛选显式要求 READY。

## Research task scope

- `researchDueOpportunities` 接收 `{ targetOpportunityIds?, forceRefreshIds? }`。
- `targetOpportunityIds` 决定任务集合；缺省才表示所有到期候选。
- `forceRefreshIds` 只决定是否忽略缓存。
- job API 增加单 job 读取端点，前端使用可见性感知的退避轮询。

## Evidence and bounded history

- 最新报告的 `evidenceSnapshot` 映射为 `reportEvidence`；旧版不完整 snapshot 只回退到对应 evidence ID。
- 当前 evidence、reports、signals 默认限制 20 条，详情响应返回各自 total；前端可按需提高 limit，最大 100。
- 新报告 snapshot 保存完整的展示字段，确保未来不依赖可变 evidence rows。

## Input and CSV safety

- 共享 schema 提供无凭据的 HTTP/HTTPS URL 校验。
- CSV 使用跨整份文档的状态机解析引号、逗号、CRLF 和引号内换行。
- 每一行映射后走 `createSignalSchema`；未知 source type 返回带行号的 400。
- SQL patch 由字段映射决定空字符串是否为空值，不做全局转换。

## Frontend behavior

- Router 暴露 search，并让 Radar 的 query/platform/verdict/sort/page 由 URL 驱动。
- 全局 toast 提供快速新增结果和“查看证据”动作。
- 产品和候选编辑复用现有表单风格与 PATCH API。
- Modal 使用 portal、唯一标题 ID、焦点圈定、背景 inert、滚动锁与焦点归还。
- 移动侧栏根据 media query 设置 inert/aria-hidden，并处理焦点转移。
- 表格在名称单元格提供真实 button/link，不让 `<tr>` 冒充控件。
- 状态、错误与成功提示使用 `role=status/alert` 或 aria-live。

## Performance and maintainability

- 新建 job polling hook，统一长任务跟踪与页面可见性。
- API 获取保留 AbortController；Operations 在隐藏页面暂停轮询。
- 非核心页面使用 `React.lazy` 路由级拆包。
- 字体入口改为 latin subset；中文继续回退到现有 sans-serif fallback。
- 有界详情替代无界渲染；样式补充 `content-visibility` 处理长列表。

## Verification

- API 单元/集成测试覆盖 freshness、单候选范围、PATCH、CSV、URL、job status 和 bounded detail。
- 组件逻辑用 TypeScript/build 验证，浏览器 smoke 覆盖筛选返回、modal、编辑、快速新增、任务状态和移动侧栏。
- 运行 `npm test`、`npm run build`、`git diff --check` 和官方生产依赖 audit。
