import { afterEach, describe, expect, it, vi } from "vitest";
import { isAiConfigured, loadConfig } from "./config.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AI configuration", () => {
  it("enables real research with a custom OpenAI relay", () => {
    vi.stubEnv("RESEARCH_PROVIDER", "real");
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_BASE_URL", "https://relay.example/api");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AI_MODEL", "gpt-5.6-terra");
    vi.stubEnv("AI_REASONING_EFFORT", "xhigh");
    vi.stubEnv("AI_DISABLE_RESPONSE_STORAGE", "true");
    vi.stubEnv("DATAFORSEO_LOGIN", "test-login");
    vi.stubEnv("DATAFORSEO_PASSWORD", "test-password");

    const config = loadConfig();

    expect(config.researchProvider).toBe("real");
    expect(config.aiProvider).toBe("openai");
    expect(config.aiModel).toBe("gpt-5.6-terra");
    expect(config.openAiBaseUrl).toBe("https://relay.example/api");
    expect(config.aiReasoningEffort).toBe("xhigh");
    expect(config.aiDisableResponseStorage).toBe(true);
    expect(isAiConfigured(config)).toBe(true);
  });

  it("falls back to demo mode when the selected AI credential is missing", () => {
    vi.stubEnv("RESEARCH_PROVIDER", "real");
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("DATAFORSEO_LOGIN", "test-login");
    vi.stubEnv("DATAFORSEO_PASSWORD", "test-password");

    const config = loadConfig();

    expect(config.researchProvider).toBe("demo");
    expect(isAiConfigured(config)).toBe(false);
  });

  it("supports an Anthropic Messages relay and legacy OpenAI variable names", () => {
    vi.stubEnv("RESEARCH_PROVIDER", "real");
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_BASE_URL", "");
    vi.stubEnv("OPENAI_BASE_URL", "https://relay.example");
    vi.stubEnv("OPENAI_API_KEY", "anthropic-test-key");
    vi.stubEnv("AI_MODEL", "claude-opus-5");
    vi.stubEnv("DATAFORSEO_LOGIN", "test-login");
    vi.stubEnv("DATAFORSEO_PASSWORD", "test-password");

    const config = loadConfig();

    expect(config.researchProvider).toBe("real");
    expect(config.aiProvider).toBe("anthropic");
    expect(config.aiModel).toBe("claude-opus-5");
    expect(config.anthropicApiKey).toBe("anthropic-test-key");
    expect(config.anthropicBaseUrl).toBe("https://relay.example/v1");
    expect(isAiConfigured(config)).toBe(true);
  });
});
