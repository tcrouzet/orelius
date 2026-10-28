import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { prepareCorrections } from "./corrections.ts";
import { readProjectFile, writeProjectFile } from "./project-files.ts";
import { validateProjectFolders, type ProjectFolders } from "./settings.ts";

interface Feedback {
  kind: "acceptance" | "reaction";
  id: string;
  title: string;
  body: string;
  summary: string;
  subject?: string;
}

export async function recordFeedback(cwd: string, folders: ProjectFolders, feedback: Feedback,
  checkEditor: (path: string, content: string) => void = () => {}): Promise<string> {
  validateProjectFolders(folders);
  await prepareCorrections(cwd, folders);
  const marker = `<!-- orelius:${feedback.kind}:${feedback.id} -->`;
  const directory = `${folders.bibleFolder}/Suivi`;
  const suffix = `-${feedback.kind === "acceptance" ? "acceptation" : "reaction"}-${feedback.id}.md`;
  const previousName = (await readdir(join(cwd, directory))).find(name => name.endsWith(suffix));
  const name = previousName ?? `${new Date().toISOString().replace(/[:.]/g, "-")}${suffix}`;
  const stamp = name.slice(0, -suffix.length);
  const reportPath = `${directory}/${name}`;
  if (!await readProjectFile(cwd, reportPath)) {
    await writeProjectFile(cwd, reportPath, `# ${feedback.title}\n\nDate : ${stamp}\n\n${feedback.body}\n\n${marker}\n`, null,
      folders.archiveFolder, undefined, () => checkEditor(reportPath, ""));
  }
  const knowledge = `${directory}/Connaissances.md`;
  for (const [target, initial, entry] of [
    [knowledge, "# Connaissances éditoriales de l’auteur\n",
      `## ${feedback.title} — ${stamp}\n\n${feedback.summary} Consulter le [relevé et le retour explicite de l’auteur](${name}).\n${marker}`],
    [`${folders.bibleFolder}/suivi.md`, "", `- [${stamp} — ${feedback.title}](Suivi/${name})\n${marker}`],
  ]) {
    const previous = await readProjectFile(cwd, target);
    const original = previous?.text ?? initial;
    let content = `${original}\n\n${entry}\n`;
    if (target === knowledge && feedback.subject) {
      const start = `<!-- orelius:reaction:${feedback.subject}:start -->`;
      const end = `<!-- orelius:reaction:${feedback.subject}:end -->`;
      const first = original.indexOf(start), last = original.indexOf(end);
      const hash = (text: string) => createHash("sha256").update(text).digest("hex");
      const block = `${start}\n<!-- orelius:reaction-content:${hash(entry)} -->\n${entry}\n${end}`;
      if (first === -1 && last === -1) content = `${original}\n\n${block}\n`;
      else {
        if (first === -1 || last < first || first !== original.lastIndexOf(start) || last !== original.lastIndexOf(end)) {
          throw new Error("Les repères de réaction sont incomplets ou dupliqués. La base de connaissances a été conservée.");
        }
        const previousEntry = /^\n<!-- orelius:reaction-content:([a-f0-9]{64}) -->\n([\s\S]*)\n$/.exec(original.slice(first + start.length, last));
        if (!previousEntry || hash(previousEntry[2]) !== previousEntry[1]) {
          throw new Error("La section de réaction contient des modifications personnelles. Conservez-les hors de cette section avant de changer la note.");
        }
        content = original.slice(0, first) + block + original.slice(last + end.length);
      }
    } else if (original.includes(marker)) continue;
    await writeProjectFile(cwd, target, content, previous, folders.archiveFolder, undefined, () => checkEditor(target, previous?.text ?? ""));
  }
  return reportPath;
}
