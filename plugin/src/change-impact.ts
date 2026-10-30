import { structurePath, linkStatus, type StoryStructure } from "./story-structure.ts";
import { posix } from "node:path";
import { configPath, EMPTY_CONFIG, parseConfig, readData, selectReferences, statePath, type NarrativeState } from "./narrative-context.ts";
import { WORKSHOP_FOLDERS, type ProjectFolders } from "./settings.ts";
import type { ProjectSource } from "./workshop.ts";

export interface ImpactEvidence { from: string; to: string; kind: "lien" | "configuration" | "mention" | "regle" | "etat" | "raccord"; source: string; excerpt: string }
export interface ChangeImpact { path: string; certainty: "lien explicite" | "à vérifier"; chain: ImpactEvidence[] }

export function changeImpacts(sources: ProjectSource[], folders: ProjectFolders, changedPaths: string[], states: NarrativeState[] = [], structure?: StoryStructure): Map<string, ChangeImpact[]> {
  const paths = new Set([...sources.map(source => source.path), ...changedPaths, ...(structure?.nodes.map(node => node.path) ?? [])]);
  const chapters = sources.filter(source => source.path.startsWith(`${folders.manuscriptFolder}/Chapitres/`));
  const configNote = sources.find(source => source.path === configPath(folders));
  let config = EMPTY_CONFIG;
  let configError = "";
  if (configNote) try { config = parseConfig(readData(configNote.content), folders); }
  catch (error) { configError = error instanceof Error ? error.message : "Configuration invalide"; }
  const graph = new Map<string, ImpactEvidence[]>();
  const edge = (from: string, to: string, kind: ImpactEvidence["kind"], source: string, excerpt: string) => {
    if (from === to || !paths.has(to)) return;
    const edges = graph.get(from) ?? [];
    if (!edges.some(item => item.to === to && item.kind === kind)) edges.push({ from, to, kind, source, excerpt: excerpt.length > 1000 ? excerpt.slice(0, 1000) + "…" : excerpt });
    graph.set(from, edges);
  };
  if (structure?.outline) for (const scene of structure.outline.scenes) {
    const from = structure.nodes.find(node => node.id === scene.id), to = structure.nodes.find(node => node.id === scene.chapter);
    if (from && to) {
      const evidence = JSON.stringify({ relation: "situe-scene", from: from.id, to: to.id, pov: scene.pov, status: scene.status });
      edge(from.path, to.path, "lien", structurePath(folders), evidence);
      edge(structurePath(folders), from.path, "lien", structurePath(folders), evidence);
    }
  }
  if (structure) for (const link of structure.links) {
    const from = structure.nodes.find(node => node.id === link.from)!;
    const to = structure.nodes.find(node => node.id === link.to)!;
    const evidence = JSON.stringify({ relation: link.relation, from: from.id, to: to.id, decision: from.decision, status: linkStatus(structure, link, sources), quote: link.quote });
    edge(from.path, to.path, "lien", structurePath(folders), evidence);
    edge(structurePath(folders), from.path, "lien", structurePath(folders), evidence);
  }
  const resolveLink = (value: string, owner: string): string | undefined => {
    let target = value.split("|")[0].split("#")[0].trim();
    try { target = decodeURIComponent(target); } catch { return undefined; }
    if (!target || /^(?:[a-z]+:|\/)/i.test(target) || target.includes("\\")) return undefined;
    const candidates = [target, posix.normalize(posix.join(posix.dirname(owner), target))];
    for (const candidate of candidates) {
      if (paths.has(candidate)) return candidate;
      if (paths.has(candidate + ".md")) return candidate + ".md";
    }
    if (target.includes("/")) return undefined;
    const matches = [...paths].filter(path => posix.basename(path).replace(/\.md$/i, "") === target.replace(/\.md$/i, ""));
    return matches.length === 1 ? matches[0] : undefined;
  };
  const escapedPaths = [...paths].sort((a, b) => b.length - a.length).map(path => path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const plainPaths = escapedPaths.length ? new RegExp(`(?<![\\p{L}\\p{N}/_.-])(?:${escapedPaths.join("|")})(?![\\p{L}\\p{N}/_.-])`, "gu") : null;
  const isWorkshop = (path: string) => [...WORKSHOP_FOLDERS, "Plan", "Personnages"].some(folder => path.startsWith(`${folders.manuscriptFolder}/${folder}/`));
  for (const source of sources) {
    if (source.path === structurePath(folders)) continue;
    // Code fences are examples, not narrative dependencies.
    const content = source.content.replace(/^\s*```[^\n]*\n[\s\S]*?^\s*```\s*$/gm, "");
    for (const line of content.split(/\r?\n/)) {
      const links = [...line.matchAll(/\[\[([^\]]+)\]\]|\]\(<?([^)>]+)>?\)/g)].map(match => match[1] ?? match[2]);
      // Existing populated notes also cite project-relative paths in plain text.
      if (plainPaths) for (const match of line.matchAll(plainPaths)) links.push(match[0]);
      for (const link of links) {
        const target = resolveLink(link, source.path);
        if (!target) continue;
        edge(target, source.path, "lien", source.path, line.trim());
        if (isWorkshop(source.path) && !/\/index\.md$/i.test(source.path) && target.startsWith(`${folders.manuscriptFolder}/Chapitres/`)) {
          edge(source.path, target, "lien", source.path, line.trim());
        }
      }
    }
  }
  for (const chapter of chapters) {
    const relative = chapter.path.slice(`${folders.manuscriptFolder}/Chapitres/`.length);
    const link = config.chapters.find(item => item.path === chapter.path);
    if (!configError && link?.previous === undefined) {
      const order = config.chapters.length ? config.chapters.map(item => item.path) : [...paths].filter(path => path.startsWith(`${folders.manuscriptFolder}/Chapitres/`) && posix.dirname(path) === posix.dirname(chapter.path)).sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
      const position = order.indexOf(chapter.path);
      const previous = order.slice(0, Math.max(0, position)).filter(path => config.chapters.find(item => item.path === path)?.include !== false).pop();
      if (previous) edge(previous, chapter.path, "raccord", configNote?.path ?? "ordre des chapitres", "Chapitre précédent utilisé pour le raccord ; vérifier la continuité sans propager automatiquement aux suivants.");
    }
    for (const source of [...(link?.references ?? []), ...(link?.pov ? [link.pov] : []),
      link?.plan ?? `${folders.manuscriptFolder}/Plan/${relative}`, link?.model ?? `${folders.modelFolder}/Chapitres/${relative}`,
      ...(link?.previous ? [link.previous] : [])]) {
      if (paths.has(source)) edge(source, chapter.path, "configuration", configNote?.path ?? "correspondance des noms", link ? JSON.stringify(link) : relative);
    }
    for (const source of paths) if (source.startsWith(`${folders.bibleFolder}/Style/`) || source === `${folders.bibleFolder}/Suivi/Connaissances.md`
      || source === configPath(folders) || source.startsWith(`${folders.manuscriptFolder}/Context/Prompts/`)) {
      edge(source, chapter.path, "regle", source, source === configPath(folders) && configError ? `Configuration illisible : ${configError}. Corriger avant de reconstruire le contexte.` : "Consigne ou configuration partagée : vérifier son application à ce chapitre.");
    }
  }
  for (const state of states) {
    const source = statePath(folders, state.chapter);
    for (const fact of state.facts) edge(fact.entity, state.chapter, "etat", source, `${fact.field} : ${fact.value} ; connu de ${fact.knownBy.join(", ")} ; citation : ${fact.quote}`);
    for (const dependency of Object.keys(state.dependencies ?? {})) edge(dependency, state.chapter, "etat", source, "Ce chapitre a été analysé en utilisant cette source.");
  }
  const characters = [...paths].filter(path => path.startsWith(`${folders.bibleFolder}/Personnages/`) || path.startsWith(`${folders.manuscriptFolder}/Arcs/`));
  for (const path of characters) {
    if (/\/index\.md$/i.test(path)) continue;
    const reference = config.references.find(item => item.path === path) ?? { path, name: posix.basename(path, ".md") };
    for (const chapter of chapters) {
      for (const line of chapter.content.split(/\r?\n/)) if (selectReferences([{ ...reference, mode: "auto", children: [], hiddenSections: [] }], line, []).mentions.length) {
        edge(path, chapter.path, "mention", chapter.path, line.trim());
        break;
      }
    }
  }
  const result = new Map<string, ChangeImpact[]>();
  for (const changed of changedPaths) {
    const found = new Map<string, ChangeImpact>();
    const queue: { path: string; chain: ImpactEvidence[] }[] = [{ path: changed, chain: [] }];
    const visited = new Set([changed]);
    const uncertainPaths: ChangeImpact[] = [];
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      for (const evidence of graph.get(current.path) ?? []) {
        if (visited.has(evidence.to)) continue;
        const chain = [...current.chain, evidence];
        if (evidence.kind === "mention" || evidence.kind === "regle" || evidence.kind === "raccord") {
          uncertainPaths.push({ path: evidence.to, certainty: "à vérifier", chain });
          continue;
        }
        visited.add(evidence.to);
        found.set(evidence.to, { path: evidence.to, certainty: "lien explicite", chain });
        // Aggregate indexes must not spread a local change through the entire book.
        if (!/\/index\.md$/i.test(evidence.to)) queue.push({ path: evidence.to, chain });
      }
    }
    for (const impact of uncertainPaths) if (!found.has(impact.path)) found.set(impact.path, impact);
    result.set(changed, [...found.values()].sort((a, b) => a.path.localeCompare(b.path, "fr", { numeric: true })));
  }
  return result;
}
