import type { ProjectSource } from "./project-sources.ts";

// Match only paths present in the project inventory; never interpret a reference as a filesystem grant.
export function linkedStyleExamples(content: string, inventory: readonly ProjectSource[]): string[] {
  const lines = content.split(/\r?\n\s*\r?\n/);
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return inventory.filter(source => {
    const path = source.path.replace(/\.md$/i, "");
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_/\\-])${escape(path)}(?:\\.md)?(?![\\p{L}\\p{N}_/\\-])`, "iu");
    return lines.some(line => {
      const linked = pattern.test(line) || [...line.matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)].some(match => match[1] === path.split("/").pop() || match[1] === source.path.split("/").pop());
      const description = line.replace(pattern, "").replace(/\[\[[^\]]+\]\]/g, "");
      return linked && /style|voix|voice|exempl|inspir|écri|ecri|writing|write|rythm|rhythm/i.test(description);
    });
  }).map(source => source.path);
}
