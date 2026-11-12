import type { DataAdapter } from "obsidian";
import { defaultMessages, setTranslations, t, type Locale } from "./i18n.ts";

export async function loadTranslationFiles(adapter: Pick<DataAdapter, "exists" | "mkdir" | "read" | "write">, directory: string): Promise<string[]> {
  const errors: string[] = [];
  for (const language of Object.keys(defaultMessages) as Locale[]) {
    setTranslations(language, {});
    const file = `${directory}/${language}.json`;
    try {
      if (!await adapter.exists(directory)) await adapter.mkdir(directory);
      if (!await adapter.exists(file)) await adapter.write(file, JSON.stringify(defaultMessages[language], null, 2) + "\n");
      const value: unknown = JSON.parse(await adapter.read(file));
      setTranslations(language, value);
    } catch (error) {
      errors.push(t("translationFileError", { file, error: error instanceof Error ? error.message : String(error) }));
    }
  }
  return errors;
}
