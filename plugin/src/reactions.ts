import { rateEditorialObjectives, type EditorialObjective } from "./editorial-priorities.ts";
import { t } from "./i18n.ts";
import { createHash } from "node:crypto";
import { finalResponses, type ConversationTurn } from "./conversation.ts";
import { recordFeedback } from "./feedback.ts";
import { readProjectFile } from "./project-files.ts";
import type { ChatItem } from "./session.ts";
import type { ProjectFolders } from "./settings.ts";

export const REACTIONS = [
  { value: "heart", icon: "heart", get label() { return t("loveIt"); }, get summary() { return t("theAuthorParticularlyAppreciatesThisExchangeLookForExamples"); } },
  { value: "up", icon: "thumbs-up", get label() { return t("useful"); }, get summary() { return t("theAuthorFindsThisExchangeUsefulIdentifyWhatWorks"); } },
  { value: "down", icon: "thumbs-down", get label() { return t("needsImprovement"); }, get summary() { return t("theAuthorIsNotSatisfiedWithThisExchangeIdentify"); } },
] as const;
export type Reaction = typeof REACTIONS[number]["value"];
export interface ReactionRating { value: Reaction; message: string; report: string }
export interface ReactionExchange { turnId: string; prompts: string[]; answer: ChatItem; versions?: { path: string; content: string }[]; objectives?: EditorialObjective[] }

export function reactionKey(cwd: string, threadId: string, itemId: string): string { return JSON.stringify([cwd, threadId, itemId]); }

export function reactionExchanges(turns: ConversationTurn[]): Map<string, ReactionExchange> {
  const exchanges = new Map<string, ReactionExchange>();
  for (const turn of turns) for (const answer of finalResponses(turn)) {
    const objectives = new Map<string, EditorialObjective>();
    const versions = new Map<string, { path: string; content: string }>();
    for (const item of turn.messages) {
      for (const version of item.writtenVersions ?? []) versions.set(version.path, version);
      for (const goal of item.writtenObjectives ?? []) objectives.set(JSON.stringify([goal.path, goal.goal]), goal);
      if (item.id === answer.id) break;
    }
    exchanges.set(answer.id, { objectives: [...objectives.values()], versions: [...versions.values()], turnId: turn.id, prompts: turn.messages.filter(item => item.role === "user").map(item => item.text), answer });
  }
  return exchanges;
}

export async function recordReaction(cwd: string, folders: ProjectFolders, threadId: string, exchange: ReactionExchange,
  value: Reaction, message: string, previous?: ReactionRating, checkEditor: (path: string, content: string) => void = () => {}): Promise<ReactionRating> {
  const choice = REACTIONS.find(choice => choice.value === value);
  if (!choice || !threadId || !exchange.turnId || !exchange.answer.id || exchange.answer.role !== "assistant" || !exchange.answer.text.trim()) {
    throw new Error(t("chooseAReactionToAFinalCodexAnswer"));
  }
  if (previous?.value === value && previous.message === message) {
    const saved = implementedReaction((await readProjectFile(cwd, previous.report))?.text ?? "");
    if (saved && JSON.stringify(saved.versions) === JSON.stringify(exchange.versions ?? [])) {
      await rateEditorialObjectives(cwd, folders, exchange.objectives ?? [], { subject: createHash("sha256").update(JSON.stringify([threadId, exchange.answer.id])).digest("hex"), value, report: previous.report, message }, checkEditor);
      return previous;
    }
  }
  const subject = createHash("sha256").update(JSON.stringify([threadId, exchange.answer.id])).digest("hex");
  const id = createHash("sha256").update(JSON.stringify([subject, exchange.prompts, exchange.answer.text, exchange.versions, exchange.objectives, value, message, previous?.report])).digest("hex");
  const quote = (text: string) => text.split("\n").map(line => `    ${line}`).join("\n");
  const report = await recordFeedback(cwd, folders, {
    kind: "reaction", id, subject, title: t("authorReaction", { value1: choice.label }),
    summary: t("thisIsTheCurrentReactionToThisAnswerAnd", { value1: choice.summary }),
    body: `Réaction : ${choice.label}\n\nConversation : ${JSON.stringify(threadId)}\n\nÉchange : ${JSON.stringify(exchange.turnId)}\n\nRéponse : ${JSON.stringify(exchange.answer.id)}\n\n${choice.summary}\n\nMise en œuvre : ${JSON.stringify({ value, versions: exchange.versions ?? [], objectifs: exchange.objectives ?? [] })}\n\nLes versions ci-dessous sont celles effectivement écrites pendant cet échange, pas les fichiers actuels. Le pouce positif les valide ; le cœur en fait des références fortement approuvées ; le pouce négatif les invalide comme références. Les réserves explicites de l’auteur limitent cette appréciation. Aucun fichier n’est restauré ou réécrit par la réaction. Sans version disponible, seul l’échange est évalué ; ne présume pas l’acceptation d’un fichier.\n\n## Demandes de l’auteur\n\n${quote(exchange.prompts.join("\n\n"))}\n\n## Réponse finale de Codex\n\n${quote(exchange.answer.text)}\n\n## Précisions de l’auteur\n\n${message.trim() ? quote(message) : t("noAdditionalExplanationTheReasonForTheReactionRemains")}`,
  }, checkEditor);
  await rateEditorialObjectives(cwd, folders, exchange.objectives ?? [], { subject, value, report, message }, checkEditor);
  return { value, message, report };
}

export function implementedReaction(text: string): { value: Reaction; versions: { path: string; content: string }[] } | null {
  const line = /^Mise en œuvre : (.+)$/m.exec(text)?.[1];
  if (!line) return null;
  try {
    const data: unknown = JSON.parse(line);
    if (!data || typeof data !== "object" || !("value" in data) || !REACTIONS.some(choice => choice.value === data.value)
      || !("versions" in data) || !Array.isArray(data.versions)) return null;
    const versions: { path: string; content: string }[] = [];
    for (const item of data.versions as unknown[]) {
      if (!item || typeof item !== "object" || !("path" in item) || typeof item.path !== "string"
        || !("content" in item) || typeof item.content !== "string" || !item.path.endsWith(".md")
        || item.path.includes("\\") || item.path.split("/").some(part => !part || part === "." || part === "..")) return null;
      versions.push({ path: item.path, content: item.content });
    }
    return { value: data.value as Reaction, versions };
  } catch { return null; }
}
