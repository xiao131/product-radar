import { describe, expect, it, vi } from "vitest";
import { RetryableProviderError, withRetry } from "./retry.js";

describe("provider retry policy", () => {
  it("retries bounded transient failures and then succeeds", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new RetryableProviderError("rate limited", 0))
      .mockRejectedValueOnce(new RetryableProviderError("upstream failed", 0))
      .mockResolvedValue("ok");

    await expect(withRetry(operation, { retries: 2 })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("does not retry permanent provider failures", async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(
      new Error("invalid credentials"),
    );

    await expect(withRetry(operation, { retries: 3 })).rejects.toThrow(
      "invalid credentials",
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
