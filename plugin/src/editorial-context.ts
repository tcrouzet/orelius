import { chapterPath, correctionReport } from "./corrections.ts";
import { readProjectFile } from "./project-files.ts";
import { validateProjectFolders, type ProjectFolders } from "./settings.ts";

export async function readEditorialContext(cwd: string, folders: ProjectFolders, versions: Record<string, string>): Promise<string[]> {
  validateProjectFolders(folders);
  const sources: { path: string; content: string }[] = [];
  const add = async (path: string) => {
    const file = await readProjectFile(cwd, path);
    if (file) sources.push({ path, content: file.text });
    return file?.text ?? "";
  };
  await add(`${folders.bibleFolder}/Style/Narration.md`);
  await add(`${folders.bibleFolder}/Style/rules.md`);
  await add(`${folders.bibleFolder}/Suivi/Connaissances.md`);
  const index = await add(`${folders.bibleFolder}/suivi.md`);
  const reports = [...index.matchAll(/\]\(Suivi\/([^/\\\r\n()]+\.md)\)/g)].map(match => match[1]);
  for (const kind of ["acceptation", "reaction"]) {
    const report = [...reports].reverse().find(name => name.includes(`-${kind}-`));
    if (report) await add(`${folders.bibleFolder}/Suivi/${report}`);
  }
  for (const [path, baseline] of Object.entries(versions)) {
    if (chapterPath(cwd, folders, path) !== path) continue;
    const file = await readProjectFile(cwd, path);
    if (!file || (file.text === baseline && !file.text.includes("((("))) continue;
    // The current human text is also a voice reference for the next chapter.
    sources.push({ path, content: file.text });
    sources.push({ path: `${path} — comparaison Codex/auteur`, content: correctionReport(path, baseline, file.text) });
  }
  // Small pages prevent large histories from being silently cut in tool output.
  const pages: typeof sources[] = [[]];
  let size = 0;
  for (const source of sources) {
    for (let offset = 0; offset < source.content.length; offset += 8000) {
      const content = source.content.slice(offset, offset + 8000);
      if (size && size + content.length > 8000) { pages.push([]); size = 0; }
      pages[pages.length - 1].push({ path: source.path, content });
      size += content.length;
    }
  }
  return pages.map((sources, page) => JSON.stringify({ page, pages: pages.length, sources }));
}
