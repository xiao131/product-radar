import { createAnthropic } from "@ai-sdk/anthropic";
import {
  createDeepSeek,
  type DeepSeekLanguageModelChatOptions,
} from "@ai-sdk/deepseek";
import {
  createOpenAI,
  type OpenAILanguageModelResponsesOptions,
} from "@ai-sdk/openai";
import { createGateway, type LanguageModel } from "ai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import type { AppConfig } from "./config.js";

export const DEEPSEEK_CONTEXT_WINDOW_TOKENS = 1_000_000;
export const DEEPSEEK_MAX_OUTPUT_TOKENS = 384_000;

export function createResearchAiModel(config: AppConfig): LanguageModel {
  if (config.aiProvider === "gateway") {
    return createGateway({ apiKey: config.aiGatewayApiKey })(config.aiModel);
  }

  if (config.aiProvider === "anthropic") {
    const anthropic = createAnthropic({
      apiKey: config.anthropicApiKey,
      baseURL: config.anthropicBaseUrl,
    });
    return anthropic(config.aiModel);
  }

  if (config.aiProvider === "deepseek") {
    const deepSeek = createDeepSeek({
      apiKey: config.deepSeekApiKey,
      baseURL: config.deepSeekBaseUrl,
    });
    return deepSeek(config.aiModel);
  }

  const openai = createOpenAI({
    apiKey: config.openAiApiKey,
    baseURL: config.openAiBaseUrl,
  });

  return openai.responses(config.aiModel);
}

export function createResearchAiProviderOptions(
  config: AppConfig,
): ProviderOptions | undefined {
  if (config.aiProvider === "deepseek") {
    const options: DeepSeekLanguageModelChatOptions = {
      thinking: { type: "enabled" },
      reasoningEffort: "max",
    };
    return { deepseek: options };
  }

  if (config.aiProvider !== "openai") return undefined;

  const options: OpenAILanguageModelResponsesOptions = {
    reasoningEffort: config.aiReasoningEffort,
    reasoningSummary: null,
    store: !config.aiDisableResponseStorage,
    strictJsonSchema: true,
  };

  return { openai: options };
}
