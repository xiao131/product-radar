import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Platform, SignalSource, Verdict } from "../shared/types.js";

const opportunities: Array<{
  name: string;
  oneLiner: string;
  targetUser: string;
  source: SignalSource;
  platform: Platform;
  verdict: Verdict;
  score: number;
  delta: number;
  confidence: number;
  scores: number[];
  change: string;
}> = [
  {
    name: "Screenshot Redactor",
    oneLiner: "在分享截图前，一键识别并遮盖姓名、邮箱、定位和聊天隐私。",
    targetUser: "经常公开分享截图的创作者、客服与产品团队",
    source: "APP_REVIEW",
    platform: "IOS",
    verdict: "BUILD_NOW",
    score: 87,
    delta: 6,
    confidence: 82,
    scores: [86, 92, 81, 76, 84, 80, 85, 89, 84],
    change: "隐私类抱怨增加，且现有工具普遍需要多步手工操作。",
  },
  {
    name: "Receipt Vault",
    oneLiner: "面向自由职业者的离线票据扫描、归档与报税导出工具。",
    targetUser: "自由职业者与微型工作室",
    source: "REDDIT",
    platform: "IOS",
    verdict: "BUILD_NOW",
    score: 84,
    delta: 3,
    confidence: 79,
    scores: [79, 88, 70, 85, 75, 78, 84, 90, 72],
    change: "多条新增评论明确表达愿意为隐私优先、无订阅方案付费。",
  },
  {
    name: "Metadata Cleaner",
    oneLiner: "批量清除照片和文档中的位置、设备与作者元数据。",
    targetUser: "摄影师、记者和隐私敏感用户",
    source: "FORUM",
    platform: "WEB_AND_IOS",
    verdict: "VALIDATE_FIRST",
    score: 79,
    delta: 8,
    confidence: 76,
    scores: [78, 86, 88, 62, 71, 73, 82, 85, 78],
    change: "搜索趋势连续两周上升，但免费替代品较多，需要先验证付费场景。",
  },
  {
    name: "CSV Repair Bench",
    oneLiner: "在浏览器本地修复乱码、错列、日期和分隔符混乱的 CSV。",
    targetUser: "运营、分析师和非技术数据处理人员",
    source: "IDEA",
    platform: "WEB",
    verdict: "VALIDATE_FIRST",
    score: 76,
    delta: 1,
    confidence: 74,
    scores: [84, 82, 61, 69, 67, 88, 91, 83, 70],
    change: "需求稳定，新增证据未改变核心判断；重点验证一次性付费。",
  },
  {
    name: "App Review Miner",
    oneLiner: "聚合同类 App 差评，自动归纳尚未解决的高频痛点。",
    targetUser: "独立开发者与移动产品经理",
    source: "IDEA",
    platform: "WEB",
    verdict: "VALIDATE_FIRST",
    score: 74,
    delta: 4,
    confidence: 71,
    scores: [75, 76, 72, 68, 74, 81, 72, 92, 68],
    change: "开发者调研需求明确，但数据成本与平台条款仍需验证。",
  },
  {
    name: "Focus Walk",
    oneLiner: "用短时户外步行任务替代刷手机的轻量专注 App。",
    targetUser: "远程工作者与注意力容易分散的人群",
    source: "X",
    platform: "IOS",
    verdict: "WATCH",
    score: 68,
    delta: 7,
    confidence: 58,
    scores: [72, 69, 79, 48, 55, 64, 88, 74, 61],
    change: "相关讨论热度明显上升，但留存和付费机制尚不清晰。",
  },
  {
    name: "Quiet Invoice",
    oneLiner: "无需账户的本地优先发票生成器，支持中英双语模板。",
    targetUser: "不想使用复杂 SaaS 的个体服务商",
    source: "CUSTOMER",
    platform: "WEB",
    verdict: "VALIDATE_FIRST",
    score: 71,
    delta: -2,
    confidence: 78,
    scores: [68, 73, 54, 82, 62, 79, 94, 86, 72],
    change: "需求真实但同质化严重，评分因竞争密度上升而下调。",
  },
  {
    name: "Voice Note Triage",
    oneLiner: "把散乱语音备忘录整理成任务、灵感和日记。",
    targetUser: "习惯用语音捕捉想法的创作者",
    source: "APP_REVIEW",
    platform: "IOS",
    verdict: "WATCH",
    score: 65,
    delta: 2,
    confidence: 64,
    scores: [71, 74, 65, 53, 49, 69, 70, 80, 62],
    change: "痛点存在，但系统级与大型笔记产品正在快速覆盖。",
  },
  {
    name: "Changelog Lens",
    oneLiner: "监控竞品更新日志，自动标记功能策略和定价变化。",
    targetUser: "小型 SaaS 创始人和产品负责人",
    source: "IDEA",
    platform: "WEB",
    verdict: "WATCH",
    score: 63,
    delta: 0,
    confidence: 66,
    scores: [62, 58, 60, 64, 66, 71, 75, 81, 58],
    change: "本轮没有显著新信号，维持观察。",
  },
  {
    name: "Habit Contract",
    oneLiner: "好友见证的习惯承诺工具，用轻量社交压力提高完成率。",
    targetUser: "需要外部约束的个人成长用户",
    source: "REDDIT",
    platform: "WEB_AND_IOS",
    verdict: "WATCH",
    score: 59,
    delta: -4,
    confidence: 61,
    scores: [64, 66, 48, 44, 41, 55, 78, 60, 54],
    change: "竞品活跃度上升，且用户对持续付费的表达偏弱。",
  },
  {
    name: "Meeting Cost Clock",
    oneLiner: "实时显示会议时间成本并在会后生成精简建议。",
    targetUser: "10–100 人的远程协作团队",
    source: "X",
    platform: "WEB",
    verdict: "SKIP",
    score: 47,
    delta: -1,
    confidence: 73,
    scores: [55, 42, 45, 38, 34, 50, 90, 68, 43],
    change: "传播性强但实际付费意愿弱，不建议占用近期开发时间。",
  },
  {
    name: "AI Prompt Bookmark",
    oneLiner: "跨模型保存、标记和复用提示词。",
    targetUser: "高频使用多个 AI 工具的知识工作者",
    source: "IDEA",
    platform: "WEB",
    verdict: "SKIP",
    score: 42,
    delta: -9,
    confidence: 86,
    scores: [67, 39, 40, 31, 12, 80, 95, 72, 45],
    change: "供给过剩且平台原生收藏能力增强，机会窗口继续收窄。",
  },
];

const englishOpportunityCopy: Record<
  string,
  { oneLiner: string; targetUser: string; changeSummary: string }
> = {
  "Screenshot Redactor": {
    oneLiner: "Detect and redact names, email addresses, locations, and private chat details before sharing a screenshot.",
    targetUser: "Creators, support teams, and product teams that regularly share screenshots publicly",
    changeSummary: "Privacy complaints increased, while existing tools still require several manual steps.",
  },
  "Receipt Vault": {
    oneLiner: "An offline receipt scanner, archive, and tax export tool for freelancers.",
    targetUser: "Freelancers and micro studios",
    changeSummary: "New reviews explicitly show willingness to pay for a privacy-first, non-subscription option.",
  },
  "Metadata Cleaner": {
    oneLiner: "Remove location, device, and author metadata from photos and documents in batches.",
    targetUser: "Photographers, journalists, and privacy-conscious users",
    changeSummary: "Search interest has risen for two weeks, but free alternatives make payment validation necessary.",
  },
  "CSV Repair Bench": {
    oneLiner: "Repair encoding, shifted columns, dates, and delimiter problems in CSV files locally in the browser.",
    targetUser: "Operators, analysts, and non-technical data users",
    changeSummary: "Demand remains stable; the next question is whether users will pay once rather than subscribe.",
  },
  "App Review Miner": {
    oneLiner: "Aggregate negative reviews from competing apps and surface recurring unresolved pain points.",
    targetUser: "Independent developers and mobile product managers",
    changeSummary: "Research demand is clear, but data cost and platform terms still need validation.",
  },
  "Focus Walk": {
    oneLiner: "A lightweight focus app that replaces phone scrolling with short outdoor walking tasks.",
    targetUser: "Remote workers and people who are easily distracted",
    changeSummary: "Discussion is growing, but retention and monetization remain unclear.",
  },
  "Quiet Invoice": {
    oneLiner: "A local-first invoice generator with no account requirement and bilingual templates.",
    targetUser: "Solo service providers who do not want a complex SaaS product",
    changeSummary: "The need is real, but rising competition lowered the score.",
  },
  "Voice Note Triage": {
    oneLiner: "Organize scattered voice memos into tasks, ideas, and journal entries.",
    targetUser: "Creators who capture ideas by voice",
    changeSummary: "The pain exists, but system features and large note apps are covering it quickly.",
  },
  "Changelog Lens": {
    oneLiner: "Monitor competitor changelogs and flag shifts in features, strategy, and pricing.",
    targetUser: "Small SaaS founders and product leads",
    changeSummary: "No material new signal appeared in this cycle, so the opportunity remains on watch.",
  },
  "Habit Contract": {
    oneLiner: "A witnessed habit commitment tool that uses light social pressure to improve completion.",
    targetUser: "People who benefit from external accountability",
    changeSummary: "Competitor activity increased while willingness to pay remains weak.",
  },
  "Meeting Cost Clock": {
    oneLiner: "Show the live cost of a meeting and generate concise improvement suggestions afterward.",
    targetUser: "Remote teams with 10–100 people",
    changeSummary: "The idea is shareable, but payment intent is too weak to justify near-term development.",
  },
  "AI Prompt Bookmark": {
    oneLiner: "Save, tag, and reuse prompts across AI models.",
    targetUser: "Knowledge workers who use multiple AI tools frequently",
    changeSummary: "Supply is saturated and native bookmarking is improving, so the opportunity window keeps narrowing.",
  },
};

const products = [
  {
    name: "Photo GPS",
    platform: "IOS",
    status: "LIVE",
    url: "https://example.com/photo-gps",
    description: "查看与清除照片定位信息。",
    focus: "优化商店截图与英文关键词。",
  },
  {
    name: "Tiny CSV",
    platform: "WEB",
    status: "LIVE",
    url: "https://example.com/tiny-csv",
    description: "轻量 CSV 查看与格式转换。",
    focus: "观察自然搜索与修复类需求。",
  },
  {
    name: "Draft Box",
    platform: "WEB_AND_IOS",
    status: "BUILDING",
    url: null,
    description: "跨端的本地优先灵感收集工具。",
    focus: "完成 iOS TestFlight 内测。",
  },
] as const;

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function seedDemoData(db: Database.Database) {
  const count = db.prepare("SELECT COUNT(*) AS count FROM opportunities").get() as {
    count: number;
  };
  if (count.count > 0) return;

  const insertOpportunity = db.prepare(`
    INSERT INTO opportunities (
      id, name, one_liner, target_user, source_type, recommended_platform,
      verdict, research_status, score, score_delta, confidence,
      demand_score, pain_score, trend_score, willingness_score,
      competition_gap_score, reachability_score, buildability_score,
      founder_fit_score, freshness_score, change_summary,
      original_language, target_markets_json, localized_content_json,
      created_at, updated_at, last_researched_at
    ) VALUES (
      @id, @name, @oneLiner, @targetUser, @source, @platform,
      @verdict, 'READY', @score, @delta, @confidence,
      @demand, @pain, @trend, @willingness,
      @competitionGap, @reachability, @buildability,
      @founderFit, @freshness, @change,
      'mixed', '["CN","US"]', @localizedContent,
      @createdAt, @updatedAt, @lastResearchedAt
    )
  `);

  const insertEvidence = db.prepare(`
    INSERT INTO evidence_items (
      id, opportunity_id, category, source_name, source_url, metric, value, unit,
      direction, strength, summary, raw_excerpt, collected_at, freshness_days
    ) VALUES (
      @id, @opportunityId, @category, @sourceName, @sourceUrl, @metric, @value, @unit,
      @direction, @strength, @summary, @rawExcerpt, @collectedAt, @freshnessDays
    )
  `);

  const insertReport = db.prepare(`
    INSERT INTO research_reports (
      id, opportunity_id, run_id, version, provider_mode, verdict,
      recommended_platform, recommended_action, score, score_delta, confidence,
      payload_json, change_summary, researcher_summary, debate_summary, created_at
    ) VALUES (
      @id, @opportunityId, @runId, 1, 'DEMO', @verdict,
      @platform, @action, @score, @delta, @confidence,
      @payload, @change, @researcherSummary, @debateSummary, @createdAt
    )
  `);

  const insertRun = db.prepare(`
    INSERT INTO discovery_runs (id, opportunity_id, status, provider_mode, started_at, finished_at)
    VALUES (@id, @opportunityId, 'COMPLETED', 'DEMO', @createdAt, @createdAt)
  `);

  const tx = db.transaction(() => {
    opportunities.forEach((item, index) => {
      const id = randomUUID();
      const createdAt = isoDaysAgo(18 - (index % 6));
      const researchedAt = isoDaysAgo(index % 4);
      const [
        demand,
        pain,
        trend,
        willingness,
        competitionGap,
        reachability,
        buildability,
        founderFit,
        freshness,
      ] = item.scores;

      insertOpportunity.run({
        id,
        ...item,
        demand,
        pain,
        trend,
        willingness,
        competitionGap,
        reachability,
        buildability,
        founderFit,
        freshness,
        localizedContent: JSON.stringify({
          "zh-CN": {
            name: item.name,
            oneLiner: item.oneLiner,
            targetUser: item.targetUser,
            changeSummary: item.change,
          },
          en: {
            name: item.name,
            oneLiner: englishOpportunityCopy[item.name]?.oneLiner ?? item.oneLiner,
            targetUser: englishOpportunityCopy[item.name]?.targetUser ?? item.targetUser,
            changeSummary:
              englishOpportunityCopy[item.name]?.changeSummary ?? item.change,
          },
        }),
        createdAt,
        updatedAt: researchedAt,
        lastResearchedAt: researchedAt,
      });

      const evidence = [
        {
          category: "SEARCH",
          sourceName: "Demo Search Dataset",
          metric: "monthly_searches",
          value: 900 + demand * 37,
          unit: "queries",
          direction: trend >= 70 ? "UP" : trend < 50 ? "DOWN" : "FLAT",
          strength: Math.round(demand * 0.9),
          summary: `相关问题词存在稳定搜索需求，需求分 ${demand}/100。`,
          rawExcerpt: null,
        },
        {
          category: "COMPLAINT",
          sourceName: `${item.source} sample`,
          metric: "pain_mentions",
          value: 18 + Math.round(pain / 3),
          unit: "mentions",
          direction: item.delta > 2 ? "UP" : "FLAT",
          strength: pain,
          summary: `样本中反复出现“步骤太多、隐私顾虑或现有方案不够专注”等抱怨。`,
          rawExcerpt: "I just want one focused tool that solves this without a subscription maze.",
        },
        {
          category: "COMPETITOR",
          sourceName: "Demo Competitor Scan",
          metric: "unmet_gap_score",
          value: competitionGap,
          unit: "score",
          direction: competitionGap > 70 ? "UP" : "FLAT",
          strength: competitionGap,
          summary: `竞品覆盖度与差评空档综合为 ${competitionGap}/100；数值越高代表切入空档越清晰。`,
          rawExcerpt: null,
        },
      ] as const;

      const evidenceIds = evidence.map((entry) => {
        const evidenceId = randomUUID();
        insertEvidence.run({
          id: evidenceId,
          opportunityId: id,
          ...entry,
          sourceUrl: null,
          collectedAt: researchedAt,
          freshnessDays: index % 4,
        });
        return evidenceId;
      });

      const runId = randomUUID();
      insertRun.run({ id: runId, opportunityId: id, createdAt: researchedAt });
      const payload = {
        dimensionScores: [
          ["demand", "需求强度", demand, 0.16],
          ["pain", "痛点强度", pain, 0.15],
          ["trend", "趋势动量", trend, 0.11],
          ["willingness", "付费意愿", willingness, 0.13],
          ["competitionGap", "竞争空档", competitionGap, 0.12],
          ["reachability", "用户触达", reachability, 0.09],
          ["buildability", "可构建性", buildability, 0.1],
          ["founderFit", "个人匹配", founderFit, 0.09],
          ["freshness", "证据新鲜度", freshness, 0.05],
        ].map(([key, label, score, weight]) => ({
          key,
          label,
          score,
          weight,
          explanation: `${label}由当前演示证据计算，得分 ${score}/100。`,
        })),
        supportingReasons: [
          `核心用户痛点得分 ${pain}/100，问题描述具体且重复出现。`,
          `以当前范围可在较短周期交付验证版，可构建性 ${buildability}/100。`,
          `与个人开发能力和现有产品组合的匹配度为 ${founderFit}/100。`,
        ],
        opposingReasons: [
          willingness < 70 ? "直接付费证据仍不足，需要先做价格页或预售测试。" : "即使有付费表达，也要验证真实转化。",
          competitionGap < 65 ? "同类供给偏密集，必须收窄人群或工作流。" : "竞争空档存在，但可能被平台功能快速填补。",
        ],
        unknowns: ["真实渠道获客成本", "首周留存率", "目标用户对一次性付费与订阅的偏好"],
        risks: ["样本量有限", "演示证据不能替代真实搜索与商店数据"],
        platformAnalysis: {
          web: {
            score: item.platform === "IOS" ? Math.max(48, item.score - 18) : Math.min(95, item.score + 4),
            note: item.platform === "IOS" ? "工作流更依赖系统照片与移动场景。" : "适合通过搜索落地页触达并快速验证。",
          },
          ios: {
            score: item.platform === "WEB" ? Math.max(45, item.score - 16) : Math.min(95, item.score + 5),
            note: item.platform === "WEB" ? "当前价值不依赖移动端系统能力。" : "移动端场景、隐私或系统能力构成优势。",
          },
        },
        mvp: {
          promise: item.oneLiner,
          coreFeatures: ["完成一个最关键输入流程", "输出可保存的明确结果", "提供一次轻量复用入口"],
          exclusions: ["团队权限", "复杂自动化", "多层套餐"],
          validationTest: "先发布单页说明与可操作原型，收集 20 个目标用户行为并争取 3 次真实付费。",
          estimatedDays: item.score >= 80 ? 10 : 14,
        },
        evidenceIds,
      };

      insertReport.run({
        id: randomUUID(),
        opportunityId: id,
        runId,
        verdict: item.verdict,
        platform: item.platform,
        action:
          item.verdict === "BUILD_NOW"
            ? "进入 7–14 天 MVP，实现最窄闭环并同步开放预售。"
            : item.verdict === "VALIDATE_FIRST"
              ? "先做价格页和人工服务测试，再决定是否开发。"
              : item.verdict === "WATCH"
                ? "保持在观察池，等待趋势或付费证据变化。"
                : "停止投入，把时间转向更高分机会。",
        score: item.score,
        delta: item.delta,
        confidence: item.confidence,
        payload: JSON.stringify(payload),
        change: item.change,
        researcherSummary: `${item.name} 的需求、痛点、竞争与实现成本已按九维度整理。`,
        debateSummary: `正方强调具体痛点和交付速度；反方聚焦付费证据与竞争防御。最终结论为 ${item.verdict}。`,
        createdAt: researchedAt,
      });
    });

    const productStatement = db.prepare(`
      INSERT INTO products (
        id, name, platform, status, url, description, current_focus, created_at, updated_at
      ) VALUES (
        @id, @name, @platform, @status, @url, @description, @focus, @createdAt, @createdAt
      )
    `);

    products.forEach((product, index) =>
      productStatement.run({
        id: randomUUID(),
        ...product,
        createdAt: isoDaysAgo(28 - index * 4),
      }),
    );

    const signalStatement = db.prepare(`
      INSERT INTO signals (
        id, source_type, title, content, source_url, tags_json, status,
        opportunity_id, created_at, updated_at
      ) VALUES (
        @id, @sourceType, @title, @content, NULL, @tags, 'NEW',
        NULL, @createdAt, @createdAt
      )
    `);
    [
      {
        sourceType: "REDDIT",
        title: "Calendar apps hide the actual free time",
        content: "I need a calendar view that tells me the usable two-hour blocks, not another list of meetings.",
        tags: ["calendar", "complaint", "productivity"],
      },
      {
        sourceType: "APP_REVIEW",
        title: "Exporting a clean chat screenshot takes forever",
        content: "Please let me blur names and avatars automatically before exporting a conversation screenshot.",
        tags: ["privacy", "screenshot"],
      },
      {
        sourceType: "IDEA",
        title: "Subscription renewal evidence box",
        content: "Collect renewal emails and show which subscriptions have not delivered value since the last charge.",
        tags: ["finance", "subscription"],
      },
    ].forEach((signal, index) =>
      signalStatement.run({
        id: randomUUID(),
        ...signal,
        tags: JSON.stringify(signal.tags),
        createdAt: isoDaysAgo(index),
      }),
    );
  });

  tx();
}
