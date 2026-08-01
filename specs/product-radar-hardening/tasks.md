# Implementation Plan

- [x] 1. 修复结论新鲜度与状态语义
  - 保留上次调研时间，新增 `decisionCurrent`
  - Dashboard、统计、筛选和 UI 只把 READY 当作当前结论
  - _Requirements: 1, 3_

- [x] 2. 限定研究任务范围并增加 job 状态接口
  - 分离 target IDs 与 force-refresh IDs
  - 候选页持续跟踪单个 job
  - _Requirements: 2_

- [x] 3. 修复证据归属和无界详情
  - 从报告 snapshot 生成本次证据
  - 当前证据、报告和信号采用 limit + total
  - _Requirements: 4_

- [x] 4. 修复输入、PATCH 和 CSV
  - 统一 HTTP/HTTPS URL schema
  - 修复空字符串更新
  - 标准 CSV 多行解析和行级共享校验
  - _Requirements: 5_

- [x] 5. 补齐可维护操作和 URL 状态
  - 产品/候选编辑
  - Radar 筛选、排序和分页写入 URL
  - 快速新增成功反馈
  - _Requirements: 5_

- [x] 6. 修复无障碍和异步反馈
  - 表格导航、Modal 焦点、移动侧栏 inert、文件控件、live regions
  - 提升已确认的低对比文字
  - _Requirements: 6_

- [x] 7. 完成性能与结构优化
  - job polling hook、页面可见性、路由懒加载、字体子集、有界渲染
  - _Requirements: 2, 4, 6_

- [x] 8. 增加回归测试并完成浏览器验证
  - 后端/API、构建、diff 检查、依赖审计和核心浏览器流程
  - _Requirements: 1–6_
