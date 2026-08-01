import { z } from "zod";

export const platformSchema = z.enum(["WEB", "IOS", "WEB_AND_IOS"]);
export const verdictSchema = z.enum(["BUILD_NOW", "VALIDATE_FIRST", "WATCH", "SKIP"]);
export const httpUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "只允许不含用户名或密码的 HTTP/HTTPS 链接");

const optionalHttpUrlSchema = z.union([
  httpUrlSchema,
  z.literal(""),
  z.null(),
]);
export const signalSourceSchema = z.enum([
  "IDEA",
  "REDDIT",
  "X",
  "APP_REVIEW",
  "APP_STORE",
  "SEARCH",
  "TREND",
  "FORUM",
  "CUSTOMER",
  "OTHER",
]);

export const createProductSchema = z.object({
  name: z.string().trim().min(2).max(100),
  platform: platformSchema,
  status: z.enum(["IDEA", "BUILDING", "LIVE", "PAUSED", "ARCHIVED"]).default("LIVE"),
  url: optionalHttpUrlSchema.optional(),
  description: z.string().trim().max(600).default(""),
  currentFocus: z.string().trim().max(300).default(""),
});

export const updateProductSchema = createProductSchema.partial();

export const createSignalSchema = z.object({
  sourceType: signalSourceSchema.default("IDEA"),
  title: z.string().trim().min(2).max(140),
  content: z.string().trim().min(3).max(10_000),
  sourceUrl: optionalHttpUrlSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
});

export const opportunityUpdateSchema = z.object({
  name: z.string().trim().min(2).max(140).optional(),
  oneLiner: z.string().trim().min(3).max(500).optional(),
  targetUser: z.string().trim().min(2).max(300).optional(),
  recommendedPlatform: platformSchema.optional(),
});

export const linkSignalSchema = z.object({
  opportunityId: z.string().uuid(),
});

export const dimensionScoreSchema = z.object({
  key: z.enum([
    "demand",
    "pain",
    "trend",
    "willingness",
    "competitionGap",
    "reachability",
    "buildability",
    "founderFit",
    "freshness",
  ]),
  label: z.string(),
  score: z.number().min(0).max(100),
  weight: z.number().min(0).max(1),
  explanation: z.string(),
});

const aiDimensionScoreSchema = z.object({
  key: dimensionScoreSchema.shape.key,
  score: z.number().min(0).max(100),
  explanation: z.string(),
});

const uniqueAiDimensionScoresSchema = z
  .array(aiDimensionScoreSchema)
  .length(9)
  .superRefine((items, context) => {
    const keys = new Set(items.map((item) => item.key));
    if (keys.size !== 9) {
      context.addIssue({
        code: "custom",
        message: "九个评分维度必须唯一且完整",
      });
    }
  });

export const researchStageOneSchema = z.object({
  factualSummary: z.string(),
  evidenceStrengths: z.array(z.string()).max(8),
  evidenceGaps: z.array(z.string()).max(8),
  marketMechanism: z.string(),
});

export const researchStageTwoSchema = z.object({
  supportingReasons: z.array(z.string()).min(2).max(8),
  opposingReasons: z.array(z.string()).min(2).max(8),
  decisiveQuestions: z.array(z.string()).max(6),
  debateSummary: z.string(),
});

export const researchStageThreeSchema = z.object({
  verdict: verdictSchema,
  recommendedPlatform: platformSchema,
  recommendedAction: z.string(),
  confidence: z.number().min(0).max(100),
  dimensionScores: uniqueAiDimensionScoresSchema,
  supportingReasons: z.array(z.string()).min(2).max(8),
  opposingReasons: z.array(z.string()).min(2).max(8),
  citedClaims: z
    .array(
      z.object({
        text: z.string(),
        evidenceIds: z.array(z.string()).min(1).max(8),
      }),
    )
    .min(2)
    .max(10),
  unknowns: z.array(z.string()).max(8),
  risks: z.array(z.string()).max(8),
  platformAnalysis: z.object({
    web: z.object({ score: z.number().min(0).max(100), note: z.string() }),
    ios: z.object({ score: z.number().min(0).max(100), note: z.string() }),
  }),
  mvp: z.object({
    promise: z.string(),
    coreFeatures: z.array(z.string()).min(1).max(8),
    exclusions: z.array(z.string()).max(8),
    validationTest: z.string(),
    estimatedDays: z.number().int().min(1).max(180),
  }),
  changeSummary: z.string(),
});
