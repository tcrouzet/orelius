import { revisionRequest } from "./corrections.ts";
import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { checkPath } from "./archives.ts";
import { readProjectFile, writeProjectFile } from "./project-files.ts";
import { type ProjectFolders, validateProjectFolders } from "./settings.ts";
import type { ChatItem, codexFailure } from "./session.ts";

export interface ConversationTurn {
  id: string;
  date: Date | null;
  completed: boolean;
  messages: ChatItem[];
  failure?: ReturnType<typeof codexFailure>;
}

export function finalResponses(turn: ConversationTurn): ChatItem[] {
  if (!turn.completed) return [];
  const answers = turn.messages.filter(message => message.role === "assistant" && message.text.trim());
  const finals = answers.filter(message => message.phase === "final_answer");
  return finals.length ? finals : answers.filter(message => message.phase === undefined).slice(-1);
}

export function authorPrompt(text: string): string {
  const revision = revisionRequest(text);
  return revision ? revision.details || `Réviser ${revision.path}${revision.wholeChapterRequested ? " — chapitre entier" : " — mes annotations"}.` : text;
}

export function visibleMessages(items: ChatItem[], turns: ConversationTurn[]): ChatItem[] {
  const finals = new Set(turns.flatMap(finalResponses).map(item => item.id));
  return items.filter(item => item.role === "user" || item.role === "assistant" && (item.phase === "final_answer" || finals.has(item.id)))
    .map(item => item.role === "user" ? { ...item, text: authorPrompt(item.text) } : item);
}

export function renderConversation(turns: ConversationTurn[]): string {
  const format = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  let content = "";
  let previousDate = "";
  for (const turn of turns) {
    const prompts = turn.messages.filter(message => message.role === "user" && message.text.trim());
    const selected = finalResponses(turn);
    if (!prompts.length && !selected.length) continue;
    const date = turn.date && !Number.isNaN(turn.date.valueOf()) ? format.format(turn.date) : "Date inconnue";
    if (date !== previousDate) {
      content += `# ${date[0].toLocaleUpperCase("fr-FR")}${date.slice(1)}\n\n`;
      previousDate = date;
    }
    for (const prompt of prompts) content += `## Utilisateur\n\n${authorPrompt(prompt.text)}\n\n`;
    if (selected.length) content += `## Codex\n\n${selected.map(message => message.text).join("\n\n")}\n\n`;
  }
  return content.trimEnd();
}

export async function saveConversation(cwd: string, folders: ProjectFolders, threadId: string, turns: ConversationTurn[]): Promise<void> {
  validateProjectFolders(folders);
  if (!threadId) throw new Error("Conversation Codex non identifiée.");
  const transcript = renderConversation(turns);
  if (!transcript) return;
  const root = await realpath(cwd);
  const directory = join(root, folders.bibleFolder, "Suivi");
  await checkPath(root, directory);
  await mkdir(directory, { recursive: true });
  await checkPath(root, directory);
  const path = `${folders.bibleFolder}/Suivi/Conversation.md`;
  const previous = await readProjectFile(root, path);
  const original = previous?.text ?? "";
  const key = createHash("sha256").update(threadId).digest("hex");
  const start = `<!-- orelius:conversation:${key}:start -->`;
  const end = `<!-- orelius:conversation:${key}:end -->`;
  const first = original.indexOf(start);
  const last = original.indexOf(end);
  const block = `${start}\n${transcript}\n${end}`;
  let content: string;
  if (first === -1 && last === -1) content = `${original}${original ? (original.endsWith("\n") ? "\n" : "\n\n") : ""}${block}\n`;
  else {
    if (first === -1 || last < first || first !== original.lastIndexOf(start) || last !== original.lastIndexOf(end)) {
      throw new Error("Les marqueurs du journal de conversation sont incomplets ou dupliqués. Le fichier a été conservé.");
    }
    const remaining = original.slice(0, first) + original.slice(last + end.length);
    content = `${remaining.trimEnd()}${remaining.trim() ? "\n\n" : ""}${block}\n`;
  }
  await writeProjectFile(root, path, content, previous, folders.archiveFolder);
}
