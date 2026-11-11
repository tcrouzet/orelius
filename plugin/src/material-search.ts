import { withoutBrainstorm } from "./brainstorm.ts";
import { t } from "./i18n.ts";
import { projectSources } from "./project-sources.ts";
import { configPath, EMPTY_CONFIG, parseConfig, readData, visibleSections, fingerprint } from "./narrative-context.ts";
import { readProjectFile, writeProjectFile } from "./project-files.ts";
import { contextChoice, contextExcluded, manualRole, withoutContext } from "./request-context.ts";
import { parseStructure, structurePath, linkStatus } from "./story-structure.ts";
import { revisionRequest } from "./corrections.ts";
import { parseSelectionPrompt } from "./selection-actions.ts";
import { POPULATE_BRIEF_MARKER } from "./populate-brief.ts";
import { newModelSources } from "./populate-state.ts";
import type { ProjectFolders } from "./settings.ts";

export interface MaterialMatch { path: string; hash: string; role: string; reasons: string[]; score: number; excerpts: string[] }
export interface MaterialSearch { query: string; chapter?: string; searched: number; matches: MaterialMatch[]; omitted: string[]; unmatched: string[] }
const stop = new Set("avec pour dans cette comme faire plus moins tout tous une des les aux ses ces mes tes nos vos leur elle elles lui nous vous ils est sont etre avoir sur sous par pas que qui quoi dont quand apres avant entre mais donc alors ceci cela texte chapitre projet demande revise reviser recommence refaire passage please write rewrite revise this that with from into about have been were will would could should the and for not your you our its his her she they them then than une un du de la le et en ce se il on je me tu ne au ou si sa son mon ma ta to of in is it as be an at or do so we us".split(" "));
function terms(text: string): string[] {
  return (text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
    .filter(word => !stop.has(word)).map(word => word.length > 4 ? word.replace(/s$/, "") : word);
}
function counts(words: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const word of words) result.set(word, (result.get(word) ?? 0) + 1);
  return result;
}
function queryText(request: string): string {
  const clean = withoutBrainstorm(withoutContext(request));
  const brief = clean.indexOf(POPULATE_BRIEF_MARKER);
  if (brief >= 0) return clean.slice(brief + POPULATE_BRIEF_MARKER.length);
  const selectionMarker = "\n\n<!-- orelius:selection -->\n";
  const marker = clean.indexOf(selectionMarker);
  const end = marker < 0 ? -1 : clean.indexOf("\n", marker + selectionMarker.length);
  const selection = parseSelectionPrompt(end < 0 ? clean : clean.slice(0, end));
  if (selection) return [selection.details, selection.target, selection.text, end < 0 ? "" : clean.slice(end)].join("\n");
  return revisionRequest(clean)?.details ?? clean;
}

export async function searchMaterials(cwd: string, folders: ProjectFolders, request: string, chapter?: string, populating = false): Promise<MaterialSearch> {
  chapter ??= revisionRequest(withoutContext(request))?.path;
  const choice = contextChoice(request);
  const query = queryText(request);
  const configuration = await readProjectFile(cwd, configPath(folders));
  const config = configuration ? parseConfig(readData(configuration.text), folders) : EMPTY_CONFIG;
  const registry = await readProjectFile(cwd, structurePath(folders));
  const structure = registry ? parseStructure(readData(registry.text), folders) : null;
  const sources = populating
    ? [...await projectSources(cwd, folders, [folders.bibleFolder, folders.manuscriptFolder]), ...await newModelSources(cwd, folders)]
    : await projectSources(cwd, folders);
  const documents = sources.filter(source => {
    if (contextExcluded(choice, source.path) || source.path.startsWith("Tracking/") && source.path !== "Tracking/Connaissances.md") return false;
    if (config.references.some(reference => reference.path === source.path && (reference.mode === "hidden" || reference.mode === "manual" && !choice?.include.includes(source.path)))) return false;
    if (config.chapters.some(item => item.path === source.path && item.include === false)) return false;
    return !structure?.nodes.some(node => node.path === source.path && node.decision === "abandonne" && !choice?.include.includes(source.path));
  }).map(source => {
    const reference = config.references.find(reference => reference.path === source.path);
    let content = visibleSections(source.content, reference?.hiddenSections ?? []);
    if (source.path === `Tracking/Connaissances.md`) {
      content = /^## Consignes actives[^\n]*\r?\n[\s\S]*?(?=^## |$(?![\s\S]))/m.exec(content)?.[0] ?? "";
    }
    const title = [source.path.replace(/\.md$/i, ""), reference?.name ?? "", ...(reference?.aliases ?? [])].join(" ");
    return { ...source, content, title, words: counts(terms(content)), titleWords: new Set(terms(title)) };
  });
  const frequency = new Map<string, number>();
  for (const document of documents) for (const word of document.words.keys()) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  const requested = new Set(terms(query).slice(0, 96));
  const explicit = new Set(requested);
  const active = documents.find(document => document.path === chapter);
  const annotations = [...(active?.content ?? "").matchAll(/\(\(\(([\s\S]*?)\)\)\)/g)].map(match => match[1]).join("\n");
  for (const word of terms(annotations).slice(0, 96)) explicit.add(word);
  // Rare terms from the active passage support short requests such as “recommence”.
  const contextTerms = [...new Set(terms(active?.content ?? ""))].sort((a, b) => (frequency.get(a) ?? 0) - (frequency.get(b) ?? 0)).slice(0, 24);
  const weighted = new Map(contextTerms.map(word => [word, 0.25]));
  for (const word of explicit) weighted.set(word, 1);
  const average = documents.reduce((sum, document) => sum + [...document.words.values()].reduce((a, b) => a + b, 0), 0) / (documents.length || 1) || 1;
  const chapterConfig = config.chapters.find(item => item.path === chapter);
  const required = new Set([chapter, ...(choice?.include ?? []), ...(chapterConfig?.references ?? []), chapterConfig?.plan, chapterConfig?.model,
    ...config.references.filter(reference => reference.mode === "always").map(reference => reference.path)]);
  const ranked = documents.map(document => {
    const hits: string[] = [];
    let score = 0;
    const length = [...document.words.values()].reduce((a, b) => a + b, 0);
    for (const [word, weight] of weighted) {
      const tf = document.words.get(word) ?? 0;
      if (!tf && !document.titleWords.has(word)) continue;
      hits.push(word);
      const idf = Math.log(1 + (documents.length - (frequency.get(word) ?? 0) + 0.5) / ((frequency.get(word) ?? 0) + 0.5));
      score += weight * idf * (tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * length / average)) + (document.titleWords.has(word) ? 2 : 0));
    }
    const reasons = hits.length ? [`Contenu ou titre correspondant : ${hits.join(", ")}`] : [];
    const directories = terms(document.path.split("/").slice(1, -1).join(" ")).filter(word => requested.has(word));
    if (directories.length) { score += 50; reasons.unshift(`Dossier nommé dans la demande : ${directories.join(", ")}`); }
    if (required.has(document.path)) { score += 100; reasons.unshift(document.path === chapter ? "Passage actif" : "Référence associée à la demande ou au chapitre"); }
    if (document.path.startsWith(`${folders.bibleFolder}/Style/`)) { score += 50; reasons.unshift("Consignes de style du projet"); }
    return { document, score, reasons };
  });
  const direct = new Set(ranked.filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 8).map(item => item.document.path));
  if (structure) for (const link of structure.links) {
    if (linkStatus(structure, link, sources) !== "valide") continue;
    if ([link.from, link.to].some(id => {
      const node = structure.nodes.find(node => node.id === id)!;
      return sources.find(source => source.path === node.path)?.hash !== node.hash;
    })) continue;
    const from = structure.nodes.find(node => node.id === link.from)?.path;
    const to = structure.nodes.find(node => node.id === link.to)?.path;
    for (const [source, target] of [[from, to], [to, from]]) {
      if (!source || !target || !direct.has(source)) continue;
      const item = ranked.find(item => item.document.path === target);
      if (item) { item.score += 10; item.reasons.push(`Relation ${link.relation} avec ${source}`); }
    }
  }
  const candidates = ranked.filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.document.path.localeCompare(b.document.path));
  const matches: MaterialMatch[] = [];
  const omitted: string[] = [];
  let remaining = Math.min(24000, config.maxCharacters ?? 24000, config.referenceBudget ?? 24000);
  for (const item of candidates) {
    if (matches.length >= 12 || remaining < 200) { omitted.push(item.document.path); continue; }
    const blocks = [...item.document.content.matchAll(/[^\n]+(?:\n(?!\n)[^\n]+)*/g)].map(match => match[0]);
    const best = blocks.map((text, index) => ({ text, index, score: [...new Set(terms(text))].reduce((sum, word) => sum + (weighted.get(word) ?? 0), 0) }))
      .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 3).sort((a, b) => a.index - b.index);
    const excerpts: string[] = [];
    let allowance = Math.min(2400, remaining);
    for (const block of best) {
      if (!allowance) break;
      let start = 0;
      if (block.text.length > allowance) {
        const hit = [...block.text.matchAll(/[\p{L}\p{N}]{3,}/gu)].find(match => terms(match[0]).some(word => explicit.has(word)));
        if (hit) start = Math.max(0, hit.index! - 120);
      }
      const text = block.text.slice(start, start + allowance);
      excerpts.push(text); allowance -= text.length; remaining -= text.length;
    }
    matches.push({ path: item.document.path, hash: item.document.hash, role: config.references.find(reference => reference.path === item.document.path)?.role === "example" ? "example-not-canon" : manualRole(item.document.path, folders), reasons: item.reasons, score: item.score, excerpts });
  }
  const matched = new Set(matches.flatMap(match => terms(match.excerpts.join("\n") + " " + match.path)));
  return { query, chapter, searched: documents.length, matches, omitted, unmatched: [...explicit].filter(word => !matched.has(word)) };
}

export async function saveMaterialSearch(cwd: string, folders: ProjectFolders, result: MaterialSearch, ensureCurrent: () => void, configDir?: string): Promise<void> {
  for (const match of result.matches) {
    ensureCurrent();
    const file = await readProjectFile(cwd, match.path);
    if (!file || fingerprint(file.text) !== match.hash) throw new Error(t("sourceModifiedReadConsulterContexteEditorialAgainFromPage", { value1: match.path }));
  }
  const path = `Tracking/Recherche.md`;
  const content = `# Recherche pour la demande\n\n${result.query}\n\nDocuments examinés : ${result.searched}.\n\n${result.matches.map(match => `## ${match.path}\n\nRôle : ${match.role}\n\n${match.reasons.join(" ; ")}\n\n${match.excerpts.join("\n\n[…]\n\n")}`).join("\n\n")}\n\n## Limites\n\nTermes sans résultat retenu : ${result.unmatched.join(", ") || "aucun"}.\nSources écartées par la limite : ${result.omitted.join(", ") || "aucune"}.\n\nLes correspondances sont des pistes de lecture, pas des faits validés. Relire les sources avant toute conclusion.\n`;
  ensureCurrent();
  await writeProjectFile(cwd, path, content, await readProjectFile(cwd, path), folders.archiveFolder, undefined, ensureCurrent, false, undefined, configDir);
}
