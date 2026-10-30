import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { CodexClient, findCodex } from "../plugin/src/codex.ts";
import { ChatSession, readConversation } from "../plugin/src/session.ts";
import { prepareProject } from "../plugin/src/archives.ts";
import { archiveWithCorrections, captureCodexVersions } from "../plugin/src/corrections.ts";
import { saveConversation } from "../plugin/src/conversation.ts";
import { TASK_PROMPT_NAMES } from "../plugin/src/task-prompts.ts";
import { DEFAULT_PROJECT_FOLDERS } from "../plugin/src/settings.ts";
import { generateAgent, renderAgent } from "../plugin/src/generate-agent.ts";

const taskPrompts = Object.fromEntries(await Promise.all(TASK_PROMPT_NAMES.map(async name => [name, await readFile(new URL(`../prompts/${name}.md`, import.meta.url), "utf8")])));
const project = await mkdtemp(join(tmpdir(), "orelius-session-"));
const folders = DEFAULT_PROJECT_FOLDERS;
const path = "Manuscript/Chapitres/controle.md";
const original = "Version humaine à conserver.\n";
const versions = { [path]: "Ancienne version Codex.\n" };
let savedId = "";
let agentInstructions = "This is a file-tool integration check in a disposable project. Use ecrire_fichier for each requested write. Do not use shell writes. Follow additional user input received during the task. Keep the final answer brief.";
let paused = false;
let release;
const gate = new Promise(resolve => { release = resolve; });
const until = async predicate => {
  const deadline = Date.now() + 180000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Le contrôle Codex dépasse 180 secondes.");
    await wait(50);
  }
};
const session = new ChatSession(() => {}, async id => { savedId = id; },
  async (cwd, changes) => {
    if (!paused) { paused = true; await gate; }
    return archiveWithCorrections(cwd, folders, changes, versions, () => {});
  }, () => ({ ...folders, agentInstructions, taskPrompts }),
  async (cwd, changes) => { Object.assign(versions, await captureCodexVersions(cwd, folders, changes)); },
  (cwd, id, turns) => saveConversation(cwd, folders, id, turns));
const cleaner = new CodexClient({ notification() {}, request: request => cleaner.rejectRequest(request.id), exit() {} });
let executable = "";

try {
  executable = await findCodex("");
  await prepareProject(project, folders);
  await writeFile(join(project, path), original);
  await session.send(`Contrôle technique : remplace ${path} par exactement PREMIER_OK suivi d’un saut de ligne, avec l’outil ecrire_fichier. Confirme brièvement après succès.`, executable, project, "");
  await until(() => paused || !session.busy);
  assert.equal(paused, true, `Codex doit appeler l’outil d’écriture. ${session.status}`);
  assert.equal(session.running, true);
  const threadId = session.threadId;
  assert.equal(threadId, savedId);
  const addition = "ADDITION_CONTROL : après cette écriture, crée consigne.md contenant exactement CONSIGNE_OK suivi d’un saut de ligne, avec ecrire_fichier. Ne réécris pas le premier fichier.";
  await session.send(addition, executable, project, threadId);
  assert.equal(session.threadId, threadId);
  assert.equal(session.running, true);
  console.log("Vérification de la consigne envoyée pendant un appel MCP…");
  release();
  await until(() => !session.busy);
  assert.equal(session.status, "");
  assert.equal(await readFile(join(project, path), "utf8"), "PREMIER_OK\n");
  assert.equal(await readFile(join(project, "consigne.md"), "utf8"), "CONSIGNE_OK\n");
  const archiveDirectory = join(project, "Archives/Manuscript/Chapitres");
  const archives = await readdir(archiveDirectory);
  assert.equal(archives.length, 2);
  const humanArchive = archives.find(name => name.endsWith("-h.md"));
  const generatedArchive = archives.find(name => !name.endsWith("-h.md"));
  assert.ok(humanArchive);
  assert.ok(generatedArchive);
  assert.equal(await readFile(join(archiveDirectory, humanArchive), "utf8"), original);
  assert.equal(await readFile(join(archiveDirectory, generatedArchive), "utf8"), "PREMIER_OK\n");
  const added = (await readdir(join(project, "Archives"))).filter(name => name.startsWith("consigne."));
  assert.equal(added.length, 1);
  assert.equal(await readFile(join(project, "Archives", added[0]), "utf8"), "CONSIGNE_OK\n");
  assert.equal(versions[path], "PREMIER_OK\n");
  console.log("OK consigne appliquée, original humain et textes générés archivés, référence Codex actualisée");
  const turns = await readConversation(session.client, threadId, () => {});
  assert.equal(turns.length, 1);
  assert.ok(turns[0].messages.some(message => message.role === "user" && message.text.includes("ADDITION_CONTROL")));
  const journal = await readFile(join(project, "Bible/Suivi/Conversation.md"), "utf8");
  assert.ok(journal.includes("ADDITION_CONTROL"));
  assert.ok(journal.includes("## Codex"));
  await assert.rejects(session.steer("Consigne sans tâche"), /Aucune tâche active/);
  assert.equal(session.connected, true);
  console.log("OK historique et journal conservés dans un seul échange ; consigne hors tâche refusée");
  const followup = "Réponds uniquement SUIVI_SUIVANT_OK dans le chat. Ne crée et ne modifie aucun fichier.";
  await session.send(followup, executable, project, threadId);
  await until(() => !session.busy);
  assert.equal(session.status, "");
  assert.equal(session.threadId, threadId);
  const updated = await readFile(join(project, "Bible/Suivi/Conversation.md"), "utf8");
  assert.ok(updated.includes(followup));
  assert.ok(updated.includes("SUIVI_SUIVANT_OK"));
  assert.ok(updated.includes("ADDITION_CONTROL"));
  assert.ok(updated.includes("## Codex"));
  const journalArchives = join(project, "Archives/Bible/Suivi");
  const previousJournals = await Promise.all((await readdir(journalArchives)).map(name => readFile(join(journalArchives, name), "utf8")));
  assert.ok(previousJournals.includes(journal));
  const completed = await readConversation(session.client, threadId, () => {});
  assert.equal(completed.length, 2);
  assert.equal(updated.split("## Utilisateur").length - 1, 3);
  assert.equal(updated.split("## Codex").length - 1, 2);
  console.log("OK journal enrichi au deuxième échange sans écriture demandée, avec conservation et archivage du premier");

  await session.disconnect();
  const agentTemplate = await readFile(new URL("../prompts/agent.md", import.meta.url), "utf8");
  agentInstructions = renderAgent(agentTemplate, { ...folders, folder: "." });
  await generateAgent(project, { ...folders, folder: "." }, agentTemplate);
  await session.send("Pour la suite du roman, je préfère des dialogues avec des phrases brèves. C’est une consigne pour tout le projet. Ne rédige pas de passage pour le moment : je précise seulement mes attentes.", executable, project, threadId);
  await until(() => !session.busy);
  assert.equal(session.status, "");
  const knowledgePath = "Bible/Suivi/Connaissances.md";
  assert.ok((await readdir(join(project, "Bible/Suivi"))).includes("Connaissances.md"),
    `Codex doit consigner l’attente éditoriale. Dernière réponse : ${session.items.filter(item => item.role === "assistant").at(-1)?.text}`);
  const knowledge = await readFile(join(project, knowledgePath), "utf8");
  assert.match(knowledge, /dialogue/i);
  assert.match(knowledge, /br[èe]ve/i);
  assert.match(knowledge, /source/i);
  assert.equal(await readFile(join(project, path), "utf8"), "PREMIER_OK\n");
  const personal = "\n## Note personnelle\nMon repère personnel : varier le rythme de la dernière scène.\n";
  await writeFile(join(project, knowledgePath), knowledge + personal);
  await session.disconnect();
  await session.send("Précision sur ma préférence pour les phrases brèves dans les dialogues : elle ne concerne finalement que le personnage de Léa. Pour les autres personnages, conserve la liberté de rythme. Ne rédige pas de passage pour le moment.", executable, project, threadId);
  await until(() => !session.busy);
  assert.equal(session.status, "");
  assert.equal(session.threadId, threadId);
  const enriched = await readFile(join(project, knowledgePath), "utf8");
  assert.match(enriched, /Léa/);
  assert.match(enriched, /br[èe]ve/i);
  assert.ok(enriched.includes(personal.trim()), "La note personnelle de l’auteur doit être conservée après reprise.");
  const knowledgeArchives = (await readdir(journalArchives)).filter(name => name.startsWith("Connaissances."));
  assert.ok(knowledgeArchives.length >= 3, "Création, original et enrichissement doivent être archivés.");
  const savedKnowledge = await Promise.all(knowledgeArchives.map(name => readFile(join(journalArchives, name), "utf8")));
  assert.ok(savedKnowledge.includes(knowledge));
  assert.ok(savedKnowledge.includes(knowledge + personal));
  assert.ok(savedKnowledge.includes(enriched));
  assert.equal(await readFile(join(project, path), "utf8"), "PREMIER_OK\n");
  console.log("OK connaissances construites pendant un échange éditorial, enrichies après reprise, notes personnelles et versions archivées conservées");
} finally {
  release();
  await session.disconnect();
  try {
    if (savedId && executable) {
      await cleaner.connect(executable, project);
      await cleaner.request("thread/delete", { threadId: savedId });
    }
  } finally { await cleaner.stop(); await rm(project, { recursive: true }); }
}
