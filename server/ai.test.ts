import { generateText, Output, streamText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createResearchAiModel,
  createResearchAiProviderOptions,
} from "./ai.js";
import type { AppConfig } from "./config.js";
import { createTestConfig } from "./test-config.js";
import { RESEARCH_STAGE_MAX_OUTPUT_TOKENS } from "./research.js";

const relayConfig: AppConfig = {
  ...createTestConfig(),
  researchProvider: "real",
  aiProvider: "openai",
  aiModel: "gpt-5.6-terra",
  openAiApiKey: "test-key",
  openAiBaseUrl: "https://relay.example/api",
  aiReasoningEffort: "xhigh",
  aiDisableResponseStorage: true,
  dataForSeoLogin: "test-login",
  dataForSeoPassword: "test-password",
  researchFreshnessDays: 7,
  researchRateLimitPerHour: 30,
  dataForSeoBatchPollIntervalMs: 1,
  dataForSeoBatchTimeoutMs: 100,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("research AI provider", () => {
  it("uses the custom OpenAI Responses endpoint and privacy settings", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "intentional test response",
            type: "server_error",
          },
        }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateText({
        model: createResearchAiModel(relayConfig),
        output: Output.object({
          schema: z.object({ answer: z.string() }),
        }),
        providerOptions: createResearchAiProviderOptions(relayConfig),
        prompt: "Return a short answer.",
        maxRetries: 0,
      }),
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const headers = new Headers(request.headers);
    const body = JSON.parse(String(request.body)) as {
      model: string;
      store: boolean;
      reasoning: { effort: string };
      text: { format: { type: string; strict: boolean } };
    };

    expect(url).toBe("https://relay.example/api/responses");
    expect(headers.get("authorization")).toBe("Bearer test-key");
    expect(body.model).toBe("gpt-5.6-terra");
    expect(body.store).toBe(false);
    expect(body.reasoning.effort).toBe("xhigh");
    expect(body.text.format.type).toBe("json_schema");
    expect(body.text.format.strict).toBe(true);
  });

  it("keeps AI Gateway available as a provider option", () => {
    const gatewayConfig: AppConfig = {
      ...relayConfig,
      aiProvider: "gateway",
      aiModel: "openai/gpt-5.6-terra",
      aiGatewayApiKey: "gateway-test-key",
    };

    const model = createResearchAiModel(gatewayConfig);
    if (typeof model === "string") {
      throw new Error("Expected a resolved Gateway language model");
    }

    expect(model.modelId).toBe("openai/gpt-5.6-terra");
    expect(model.provider).toContain("gateway");
    expect(createResearchAiProviderOptions(gatewayConfig)).toBeUndefined();
  });

  it("uses the Anthropic Messages protocol for Claude models", async () => {
    const anthropicConfig: AppConfig = {
      ...relayConfig,
      aiProvider: "anthropic",
      aiModel: "claude-opus-5",
      anthropicApiKey: "anthropic-test-key",
      anthropicBaseUrl: "https://relay.example/v1",
    };
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          type: "error",
          error: { type: "api_error", message: "intentional test response" },
        }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateText({
        model: createResearchAiModel(anthropicConfig),
        output: Output.object({ schema: z.object({ answer: z.string() }) }),
        providerOptions: createResearchAiProviderOptions(anthropicConfig),
        prompt: "Return a short answer.",
        maxRetries: 0,
      }),
    ).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const headers = new Headers(request.headers);
    const body = JSON.parse(String(request.body)) as { model: string };

    expect(url).toBe("https://relay.example/v1/messages");
    expect(headers.get("x-api-key")).toBe("anthropic-test-key");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(body.model).toBe("claude-opus-5");
    expect(createResearchAiProviderOptions(anthropicConfig)).toBeUndefined();
  });

  it("uses a bounded streaming request for Anthropic research stages", async () => {
    const anthropicConfig: AppConfig = {
      ...relayConfig,
      aiProvider: "anthropic",
      aiModel: "claude-opus-5",
      anthropicApiKey: "anthropic-test-key",
      anthropicBaseUrl: "https://relay.example/v1",
    };
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          type: "error",
          error: { type: "api_error", message: "intentional test response" },
        }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = streamText({
      model: createResearchAiModel(anthropicConfig),
      output: Output.object({ schema: z.object({ answer: z.string() }) }),
      prompt: "Return a short answer.",
      maxOutputTokens: RESEARCH_STAGE_MAX_OUTPUT_TOKENS.researcher,
      maxRetries: 0,
    });
    await expect(result.output).rejects.toThrow();

    const [, request] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(request.body)) as {
      max_tokens: number;
      stream: boolean;
    };
    expect(body.max_tokens).toBe(4_000);
    expect(body.stream).toBe(true);
  });
});
