import { createHash } from "node:crypto";
import { posix } from "node:path";
import { chapterPath, correctionReport } from "./corrections.ts";
import { comparisonVersions } from "./comparison.ts";
import { recordFeedback } from "./feedback.ts";
import { fingerprint, statePath } from "./narrative-context.ts";
import { readProjectFile, writeProjectFile } from "./project-files.ts";
import { t } from "./i18n.ts";
import type { ProjectFolders } from "./settings.ts";

const PREFIX = "[Orelius : validation du chapitre]\n";
export interface ChapterValidation { chapter: string; hash: string; evidence: string; report: string; message: string }
export const validationPath = (folders: ProjectFolders, chapter: string) => statePath(folders, chapter).replace(/etat\.md$/, "validation.md");
const reportPath = (folders: ProjectFolders, chapter: string) => statePath(folders, chapter).replace(/etat\.md$/, "bilan-validation.md");

export function validationRequest(text: string): ChapterValidation | null {
  if (!text.startsWith(PREFIX)) return null;
  let value: unknown;
  try { value = JSON.parse(text.slice(PREFIX.length).split("\n\n")[0]); } catch { throw new Error(t("chapterValidationInvalid")); }
  if (!value || typeof value !== "object" || Object.keys(value).sort().join() !== "chapter,evidence,hash,message,report"
    || !("chapter" in value) || typeof value.chapter !== "string" || !("hash" in value) || typeof value.hash !== "string" || !/^[a-f0-9]{64}$/.test(value.hash)
    || !("evidence" in value) || typeof value.evidence !== "string" || !("report" in value) || typeof value.report !== "string"
    || !("message" in value) || typeof value.message !== "string") throw new Error(t("chapterValidationInvalid"));
  return {chapter:value.chapter,hash:value.hash,evidence:value.evidence,report:value.report,message:value.message};
}

export async function checkValidation(cwd: string, folders: ProjectFolders, validation: ChapterValidation): Promise<void> {
  if (chapterPath(cwd, folders, validation.chapter) !== validation.chapter || validation.report !== reportPath(folders, validation.chapter)
    || !/^Tracking\/[^/]+-acceptation-[a-f0-9]{64}\.md$/.test(validation.evidence)) throw new Error(t("chapterValidationInvalid"));
  const source = await readProjectFile(cwd, validation.chapter);
  if (!source || fingerprint(source.text) !== validation.hash) throw new Error(t("chapterValidationChanged"));
}

export function validationWriteAllowed(folders: ProjectFolders, validation: ChapterValidation, path: string): boolean {
  if (path.includes("\\") || path.split("/").some(part => !part || part.startsWith("."))) return false;
  path = path.normalize("NFC").toLowerCase();
  return path === validation.report.normalize("NFC").toLowerCase() || ["tracking/connaissances.md", "tracking/provenance.md"].includes(path)
    || path.startsWith(folders.bibleFolder.normalize("NFC").toLowerCase() + "/") && /\.md$/i.test(path);
}

async function saveValidation(cwd: string, folders: ProjectFolders, validation: ChapterValidation, complete: boolean,
  ensureCurrent: () => void, configDir?: string): Promise<void> {
  await checkValidation(cwd, folders, validation);
  const path = validationPath(folders, validation.chapter);
  const content = `# Validation provisoire — ${validation.chapter}\n\nL’auteur a validé la version ${validation.hash}. Le chapitre reste modifiable ; cette validation concerne uniquement cette empreinte et devient historique si le texte change.\n\nAnalyse : ${complete ? "terminée" : "en attente"}.\n\nBilan : [[${validation.report}]]\n\nVersion approuvée et dernières corrections : [[${validation.evidence}]]\n\n\`\`\`json\n${JSON.stringify({...validation,analysis:complete?"complete":"pending"},null,2)}\n\`\`\`\n`;
  await writeProjectFile(cwd, path, content, await readProjectFile(cwd, path), folders.archiveFolder, undefined, ensureCurrent, false, undefined, configDir);
}

export async function prepareValidation(cwd: string, folders: ProjectFolders, chapter: string, baseline: string | undefined,
  message: string, template: string, ensureCurrent: () => void, configDir?: string,
  checkEditor: (path: string, content: string) => void = () => {}): Promise<string> {
  if (chapterPath(cwd, folders, chapter) !== chapter) throw new Error(t("openAManuscriptChapter"));
  const source = await readProjectFile(cwd, chapter);
  if (!source?.text.trim()) throw new Error(t("chapterValidationEmpty"));
  ensureCurrent();
  const versions = await comparisonVersions(cwd, folders, chapter, source.text);
  const quote = (text: string) => text.split("\n").map(line => `    ${line}`).join("\n");
  const hash = fingerprint(source.text), report = reportPath(folders, chapter);
  const id = createHash("sha256").update(JSON.stringify(["validation",chapter,hash,baseline,message])).digest("hex");
  const evidence = await recordFeedback(cwd, folders, {
    kind:"acceptance",id,title:`Chapitre validé provisoirement — ${JSON.stringify(chapter)}`,
    summary:"L’auteur achève provisoirement ce chapitre. La version approuvée inclut ses retouches ; l’analyse doit distinguer les préférences étayées des hypothèses, sans généraliser chaque choix.",
    body:`Chapitre : [${JSON.stringify(chapter)}](<${posix.relative("Tracking",chapter)}>)\n\nAction : Valider. L’auteur considère le travail sur cette version provisoirement achevé. Il peut reprendre le chapitre ; ceci ne transforme pas tous ses choix en règles universelles.\n\n## Retour explicite de l’auteur\n\n${message.trim()?quote(message):"Aucun commentaire supplémentaire."}\n\n## Version approuvée\n\n${quote(source.text)}\n\n## Dernières corrections humaines\n\n${baseline===undefined?"Aucune version Codex de référence connue. Ne pas attribuer les changements à l’auteur ou à Codex sans preuve.":baseline===source.text?"Aucune différence avec la dernière version Codex de référence.":correctionReport(chapter,baseline,source.text)}\n\n## Dernière version Codex de référence\n\n${baseline === undefined ? "Référence inconnue." : quote(baseline)}\n\n## Versions antérieures à examiner\n\n${versions.filter(version=>version.archive).map(version=>`- [[${version.archive}]] — empreinte ${fingerprint(version.text)}`).join("\n")||"Aucune archive disponible."}\n\nLes archives sont des états antérieurs, pas toutes des propositions refusées. Le suffixe -h signale une version humaine archivée ; utiliser les retours et le suivi pour déterminer ce qui était explicitement refusé. Les variantes non retenues ne sont pas nécessairement rejetées.\n\n## Variantes proposées\n\n${versions.filter(version=>version.base!==undefined).map(version=>`### ${version.label}\n\n${quote(version.text)}`).join("\n\n")||"Aucune variante enregistrée."}\n\n## Bilan à établir\n\n[[${report}]]`,
  }, (path, content) => { ensureCurrent(); checkEditor(path, content); });
  const validation = {chapter,hash,evidence,report,message};
  await saveValidation(cwd, folders, validation, false, ensureCurrent, configDir);
  return PREFIX+JSON.stringify(validation)+"\n\n"+template.replace(/\{(chapter|evidence|report|bibleFolder)\}/g,(_,key:string)=>({chapter,evidence,report,bibleFolder:folders.bibleFolder})[key as "chapter"|"evidence"|"report"|"bibleFolder"]);
}

export async function completeValidation(cwd: string, folders: ProjectFolders, validation: ChapterValidation,
  reportWritten: boolean, ensureCurrent: () => void, configDir?: string): Promise<void> {
  if (!reportWritten || !(await readProjectFile(cwd, validation.report))?.text.trim()) throw new Error(t("chapterValidationIncomplete"));
  await saveValidation(cwd, folders, validation, true, ensureCurrent, configDir);
}
