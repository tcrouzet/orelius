export const DEFAULT_FONT = "";

export function readingState(storage, scope) {
  const prefix = `orelius:reader:${scope}:`;
  const read = key => {
    try { return JSON.parse(storage?.getItem(prefix + key) ?? "null"); }
    catch { return null; }
  };
  const write = (key, value) => {
    try { storage?.setItem(prefix + key, JSON.stringify(value)); }
    catch { /* Reading remains available when browser storage is blocked. */ }
  };
  const validPosition = value => typeof value === "string" && value.startsWith("epubcfi(") && value.endsWith(")") && value.length <= 4096;
  return {
    loadPreferences(fonts) {
      const value = read("config");
      if (value?.fontFamily === "'iA Writer Duo V', monospace" && value.fontDefaults !== "book") {
        value.fontFamily = DEFAULT_FONT;
        write("config", { ...value, fontDefaults: "book" });
      }
      return {
        fontFamily: fonts.includes(value?.fontFamily) ? value.fontFamily : DEFAULT_FONT,
        fontSize: Number.isInteger(value?.fontSize) && value.fontSize >= 70 && value.fontSize <= 200 ? value.fontSize : 100,
        format: ["paginated", "scrolled"].includes(value?.format) ? value.format : "paginated",
      };
    },
    savePreferences(value) { write("config", { ...value, fontDefaults: "book" }); },
    position(book) {
      const value = read(`position:${book}`);
      return validPosition(value) ? value : undefined;
    },
    savePosition(book, value) {
      if (validPosition(value)) write(`position:${book}`, value);
    },
  };
}
