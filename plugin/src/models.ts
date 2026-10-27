import { object } from "./codex.ts";

export interface ModelOption {
  model: string;
  name: string;
  isDefault: boolean;
}

export function modelOptions(value: unknown): ModelOption[] {
  if (!Array.isArray(value)) throw new Error("Liste des modèles Codex invalide.");
  return value.map(entry => {
    const model = object(entry);
    if (typeof model.model !== "string" || !model.model || typeof model.displayName !== "string" || !model.displayName) {
      throw new Error("Modèle Codex invalide.");
    }
    return { model: model.model, name: model.displayName, isDefault: model.isDefault === true };
  });
}

export function contextRemaining(value: unknown): number | null {
  const usage = object(value);
  const capacity = usage.modelContextWindow;
  const used = object(usage.last).totalTokens;
  if (typeof capacity !== "number" || !Number.isSafeInteger(capacity) || capacity <= 0
    || typeof used !== "number" || !Number.isSafeInteger(used) || used < 0) return null;
  return Math.floor((capacity - Math.min(used, capacity)) * 100 / capacity);
}
