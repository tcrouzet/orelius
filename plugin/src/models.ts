import { t } from "./i18n.ts";
import { object } from "./codex.ts";

export interface ModelOption {
  model: string;
  name: string;
  isDefault: boolean;
  supportedReasoningEfforts?: { reasoningEffort: string; description: string }[];
  defaultReasoningEffort?: string;
}

export function modelOptions(value: unknown): ModelOption[] {
  if (!Array.isArray(value)) throw new Error(t("invalidCodexModelList"));
  return value.map(entry => {
    const model = object(entry);
    if (typeof model.model !== "string" || !model.model || typeof model.displayName !== "string" || !model.displayName) {
      throw new Error(t("invalidCodexModel"));
    }
    let efforts: ModelOption["supportedReasoningEfforts"];
    if (model.supportedReasoningEfforts !== undefined) {
      if (!Array.isArray(model.supportedReasoningEfforts)) throw new Error(t("invalidCodexModel"));
      efforts = model.supportedReasoningEfforts.map(value => {
        const option = object(value);
        if (typeof option.reasoningEffort !== "string" || !option.reasoningEffort.trim() || option.description !== undefined && typeof option.description !== "string") throw new Error(t("invalidCodexModel"));
        return { reasoningEffort: option.reasoningEffort, description: typeof option.description === "string" ? option.description : "" };
      });
    }
    if (model.defaultReasoningEffort !== undefined && (typeof model.defaultReasoningEffort !== "string" || !model.defaultReasoningEffort.trim())) throw new Error(t("invalidCodexModel"));
    return { model: model.model, name: model.displayName, isDefault: model.isDefault === true,
      ...(efforts ? { supportedReasoningEfforts: efforts } : {}),
      ...(typeof model.defaultReasoningEffort === "string" ? { defaultReasoningEffort: model.defaultReasoningEffort } : {}) };
  });
}

export function reasoningEffortFor(model: ModelOption | undefined, requested?: string | null): string | null {
  const options = model?.supportedReasoningEfforts ?? [];
  for (const effort of [requested, model?.defaultReasoningEffort]) if (effort && options.some(option => option.reasoningEffort === effort)) return effort;
  return options[0]?.reasoningEffort ?? null;
}

export function contextRemaining(value: unknown): number | null {
  const usage = object(value);
  const capacity = usage.modelContextWindow;
  const used = object(usage.last).totalTokens;
  if (typeof capacity !== "number" || !Number.isSafeInteger(capacity) || capacity <= 0
    || typeof used !== "number" || !Number.isSafeInteger(used) || used < 0) return null;
  return Math.floor((capacity - Math.min(used, capacity)) * 100 / capacity);
}
