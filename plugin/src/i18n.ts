import en from "../../locales/en.json" with { type: "json" };
import fr from "../../locales/fr.json" with { type: "json" };

export const defaultMessages = { en, fr };
const messages = { en: { ...en }, fr: { ...fr } };
export type Locale = keyof typeof messages;
export type MessageKey = keyof typeof en;
let locale: Locale = "fr";

export function resolveLocale(language: string): Locale {
  return language.toLowerCase().replace(/_/g, "-").split("-")[0] === "fr" ? "fr" : "en";
}
export function setLocale(language: string): void { locale = resolveLocale(language); }
export function getLocale(): Locale { return locale; }
export function t(key: MessageKey, parameters: Record<string, unknown> = {}): string {
  return (messages[locale][key] ?? en[key]).replace(/\{(\w+)\}/g, (_match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(parameters, name)) throw new Error(t("translationParameterMissing", { name }));
    return String(parameters[name]);
  });
}

export function setTranslations(language: Locale, value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(t("translationCatalogInvalid"));
  const entries = value as Record<string, unknown>;
  const translated = { ...defaultMessages[language] };
  const parameters = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort();
  for (const key of Object.keys(translated) as MessageKey[]) {
    if (!Object.prototype.hasOwnProperty.call(entries, key)) continue;
    const text = entries[key];
    if (typeof text !== "string" || !text.trim()) throw new Error(t("translationTextInvalid", { key }));
    if (JSON.stringify(parameters(text)) !== JSON.stringify(parameters(translated[key]))) throw new Error(t("translationParametersInvalid", { key }));
    translated[key] = text;
  }
  messages[language] = translated;
}
