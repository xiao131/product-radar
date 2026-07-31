import { createAnthropic } from "@ai-sdk/anthropic";
import {
  createOpenAI,
  type OpenAILanguageModelResponsesOptions,
} from "@ai-sdk/openai";
import { gateway, type LanguageModel } from "ai";
import type { AppConfig } from "./config.js";

export function createResearchAiModel(config: AppConfig): LanguageModel {
  if (config.aiProvider === "gateway") {
    return gateway(config.aiModel);
  }

  if (config.aiProvider === "anthropic") {
    const anthropic = createAnthropic({
      apiKey: config.anthropicApiKey,
      baseURL: config.anthropicBaseUrl,
    });
    return anthropic(config.aiModel);
  }

  const openai = createOpenAI({
    apiKey: config.openAiApiKey,
    baseURL: config.openAiBaseUrl,
  });

  return openai.responses(config.aiModel);
}

export function createResearchAiProviderOptions(config: AppConfig) {
  if (config.aiProvider !== "openai") return undefined;

  const options: OpenAILanguageModelResponsesOptions = {
    reasoningEffort: config.aiReasoningEffort,
    reasoningSummary: null,
    store: !config.aiDisableResponseStorage,
    strictJsonSchema: true,
  };

  return { openai: options };
}
