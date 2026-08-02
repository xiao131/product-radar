import type {
  Platform,
  SignalSource,
  Verdict,
  WorkflowStatus,
} from "../shared/types";

export const verdictLabels: Record<Verdict, string> = {
  BUILD_NOW: "现在开发",
  VALIDATE_FIRST: "先验证",
  WATCH: "继续观察",
  SKIP: "暂不开发",
};

export const platformLabels: Record<Platform, string> = {
  WEB: "Web",
  IOS: "iOS",
  WEB_AND_IOS: "Web + iOS",
};

export const sourceLabels: Record<SignalSource, string> = {
  IDEA: "手工点子",
  REDDIT: "Reddit",
  X: "X / Twitter",
  APP_REVIEW: "App 评论",
  APP_STORE: "App Store",
  SEARCH: "搜索需求",
  TREND: "搜索趋势",
  FORUM: "论坛",
  CUSTOMER: "用户反馈",
  OTHER: "其他",
};

export const productStatusLabels = {
  IDEA: "想法",
  BUILDING: "开发中",
  LIVE: "已上线",
  PAUSED: "暂停",
  ARCHIVED: "归档",
} as const;

export const workflowStatusLabels: Record<WorkflowStatus, string> = {
  UNDECIDED: "待决定",
  VALIDATING: "验证中",
  APPROVED: "已批准开发",
  WATCHING: "观察中",
  REJECTED: "已放弃",
};

export function shortDate(value: string | null) {
  if (!value) return "尚未调研";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
