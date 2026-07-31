import { describe, expect, it } from "vitest";
import {
  jobErrorLabel,
  jobStatusLabel,
  jobTriggerLabel,
  jobTypeLabel,
} from "./job-format";

describe("job history labels", () => {
  it("translates job metadata into Chinese", () => {
    expect(jobTypeLabel("DISCOVERY")).toBe("自动发现");
    expect(jobTypeLabel("RESEARCH")).toBe("多维调研");
    expect(jobTriggerLabel("scheduled")).toBe("定时执行");
    expect(jobTriggerLabel("manual")).toBe("手动执行");
    expect(jobStatusLabel("COMPLETED")).toBe("已完成");
    expect(jobStatusLabel("FAILED")).toBe("失败");
  });

  it("translates common AI relay failures", () => {
    expect(
      jobErrorLabel(
        "Failed after 3 attempts. Last error: AI_APICallError: Billing service temporarily unavailable. Please retry later.",
      ),
    ).toBe("AI 中转计费服务暂时不可用，重试后仍然失败");
    expect(jobErrorLabel("The operation was aborted due to timeout")).toBe(
      "AI 请求超时，尚未完成归并",
    );
    expect(jobErrorLabel("<none>")).toBe(
      "AI 中转在生成过程中断开，未返回可读错误；请减小每批信号数后重试",
    );
  });
});
