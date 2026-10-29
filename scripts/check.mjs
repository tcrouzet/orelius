import assert from "node:assert/strict";
import { mkdtemp, access, readFile, realpath, readdir, rm, stat, writeFile, mkdir, symlink, link } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { CodexClient, codexVersion, findCodex, object } from "../plugin/src/codex.ts";
import { ChatSession, codexFailure } from "../plugin/src/session.ts";
import { applySettings, associatedFolder, DEFAULT_PROJECT_FOLDERS, loadSettings, projectPaths, visibleFolder } from "../plugin/src/settings.ts";
import { archiveChanges, archiveGenerated, prepareProject } from "../plugin/src/archives.ts";
import { generateAgent, renderAgent } from "../generate-agent.ts";
import { archiveWithCorrections, captureCodexVersions, correctionReport, prepareCorrections, refreshCorrections, revisionPrompt, revisionRequest } from "../plugin/src/corrections.ts";
import { readProjectFile, writeProjectFile } from "../plugin/src/project-files.ts";
import { contextRemaining, modelOptions } from "../plugin/src/models.ts";
import { ChatNavigation } from "../plugin/src/navigation.ts";
import { prepareBible } from "../plugin/src/bible.ts";
import { renderConversation, saveConversation } from "../plugin/src/conversation.ts";
import { CONTEXT_TOOL, FILE_TOOL, ProjectMcp } from "../plugin/src/mcp.ts";
import { readEditorialContext } from "../plugin/src/editorial-context.ts";
import { diffToGroups } from "../plugin/src/diff.ts";
import { checkRevision, planRevision, revisionMarks, revisionPath, revisionFor } from "../plugin/src/revision.ts";
import { Compartment, EditorState, Facet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorLock } from "../plugin/src/editor-lock.ts";
import { recordAcceptance } from "../plugin/src/acceptance.ts";
import { reactionExchanges, reactionKey, recordReaction } from "../plugin/src/reactions.ts";
import { checkRelease } from "./check-release.mjs";
import { checkWeb } from "./web/check.mjs";

const agentTemplate = await readFile(new URL("../prompts/agent.md", import.meta.url), "utf8");
let passed = 0;
const clients = [];
const directory = await mkdtemp(join(tmpdir(), "orelius-check-"));
const client = handlers => {
  const value = new CodexClient({ notification() {}, request() {}, exit() {}, ...handlers });
  clients.push(value);
  return value;
};
const check = async (name, action) => {
  await action();
  passed++;
  console.log(`OK ${name}`);
};

try {
  await check("Site web : catalogue et publication des livres d’exemple", () => checkWeb());
  await check("Publication : contrôles, commits automatiques, versions et tags", () => checkRelease());
  await check("Réactions : réponses finales terminées, contexte complet et ancien historique", async () => {
    const message = (id, role, text, phase) => ({ id, role, text, phase, paths: [] });
    const turn = { id: "tour", date: null, completed: true, messages: [
      message("demande", "user", "Reprends cette scène."), message("activité", "activity", "Commande"),
      message("commentaire", "assistant", "Je regarde.", "commentary"), message("précision", "user", "Garde sa voix."),
      message("finale", "assistant", "La scène est reprise.", "final_answer"),
    ] };
    const exchanges = reactionExchanges([turn, { ...turn, id: "ancien", messages: [
      message("ancien prompt", "user", "Une question."), message("ancien commentaire", "assistant", "Je vérifie."), message("ancienne finale", "assistant", "La réponse.") ] },
      { ...turn, id: "échec", completed: false, messages: [message("refusée", "assistant", "Réponse interrompue.", "final_answer")] }]);
    assert.deepEqual([...exchanges.keys()], ["finale", "ancienne finale"]);
    assert.deepEqual(exchanges.get("finale").prompts, ["Reprends cette scène.", "Garde sa voix."]);
    assert.equal(exchanges.get("finale").turnId, turn.id);
    assert.equal(exchanges.get("finale").answer.text, "La scène est reprise.");
  });

  await check("Réactions : avis et explications exacts, changement de note, historique et manuscrit conservés", async () => {
    const project = join(directory, "reactions");
    const folders = { ...DEFAULT_PROJECT_FOLDERS, bibleFolder: "Univers", archiveFolder: "Versions" };
    const exchange = { turnId: "tour", prompts: ["Donne un exemple concret.", "Conserve cette voix."], answer: { id: "réponse", role: "assistant", text: "Nadia dit : « Assieds-toi. »\n", phase: "final_answer", paths: [] } };
    const comment = "  Enfin, voilà ce que je voulais.\n\nGarde cette façon de parler.  ";
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      await prepareCorrections(project, folders);
      const knowledgePath = "Univers/Suivi/Connaissances.md";
      const personal = "# Connaissances\n\nMa note personnelle.\n";
      await writeFile(join(project, knowledgePath), personal);
      await writeFile(join(project, "Manuscript/Chapitres/1.md"), "Manuscrit à conserver.\n");
      const heart = await recordReaction(project, folders, "session", exchange, "heart", comment);
      const report = await readFile(join(project, heart.report), "utf8");
      assert.ok(report.includes(comment.split("\n").map(line => `    ${line}`).join("\n")));
      for (const text of [...exchange.prompts, exchange.answer.text.trim(), "J’adore"]) assert.ok(report.includes(text), text);
      assert.ok((await readFile(join(project, knowledgePath), "utf8")).startsWith(personal));
      assert.deepEqual(await recordReaction(project, folders, "session", exchange, "heart", comment, heart), heart);
      const down = await recordReaction(project, folders, "session", exchange, "down", "Trop abstrait : donne les mots exacts.", heart);
      const negative = await readFile(join(project, knowledgePath), "utf8");
      assert.ok(negative.includes("À améliorer"));
      assert.ok(negative.includes(down.report.split("/").pop()));
      assert.equal(negative.includes(heart.report.split("/").pop()), false);
      assert.equal(await readFile(join(project, heart.report), "utf8"), report);
      const back = await recordReaction(project, folders, "session", exchange, "heart", comment, down);
      assert.notEqual(back.report, heart.report);
      const current = await readFile(join(project, knowledgePath), "utf8");
      assert.ok(current.includes(back.report.split("/").pop()));
      assert.equal(current.includes(down.report.split("/").pop()), false);
      const index = await readFile(join(project, "Univers/suivi.md"), "utf8");
      for (const value of [heart, down, back]) assert.ok(index.includes(value.report.split("/").pop()));
      assert.equal((await readdir(join(project, "Univers/Suivi"))).filter(name => name.includes("-reaction-")).length, 3);
      assert.equal(await readFile(join(project, "Manuscript/Chapitres/1.md"), "utf8"), "Manuscrit à conserver.\n");
      const key = reactionKey(project, "session", exchange.answer.id);
      const snapshot = { before: "Avant", after: "Après" };
      const settings = applySettings(loadSettings({ revisionHighlights: { "Roman/1.md": snapshot } }), { reactions: { [key]: back } });
      const restored = loadSettings(JSON.parse(JSON.stringify(settings)));
      assert.deepEqual(restored.reactions[key], back);
      assert.deepEqual(restored.revisionHighlights["Roman/1.md"], snapshot);
      assert.equal(restored.reactions[reactionKey(project, "autre session", exchange.answer.id)], undefined);
      assert.equal(restored.reactions[reactionKey("/autre projet", "session", exchange.answer.id)], undefined);
      assert.deepEqual(applySettings(restored, { folder: "Autre" }).reactions, restored.reactions);
      const agent = renderAgent(agentTemplate, loadSettings(folders));
      for (const text of ["reproduire ou éviter", "ne devine pas la cause", "sans réentraîner"]) assert.ok(agent.includes(text), text);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Réactions : choix et données persistées invalides refusés", async () => {
    const exchange = { turnId: "tour", prompts: ["Question"], answer: { id: "réponse", role: "assistant", text: "Réponse", paths: [] } };
    for (const [thread, value, answer] of [["", "up", exchange.answer], ["session", "inconnue", exchange.answer],
      ["session", "up", { ...exchange.answer, role: "activity" }], ["session", "down", { ...exchange.answer, text: " " }]]) {
      await assert.rejects(recordReaction(directory, DEFAULT_PROJECT_FOLDERS, thread, { ...exchange, answer }, value, ""), /réponse finale/);
    }
    assert.deepEqual(loadSettings(undefined).reactions, {});
    for (const reactions of [[], null, { x: { value: "inconnue", message: "", report: "r.md" } },
      { x: { value: "heart", message: 42, report: "r.md" } }, { x: { value: "up", message: "" } }]) {
      assert.throws(() => loadSettings({ reactions }), /réaction/);
    }
  });

  await check("Réactions : échec d’archive, reprise sans doublon et notes aux repères incomplets préservées", async () => {
    const project = join(directory, "failed-reaction");
    const folders = DEFAULT_PROJECT_FOLDERS;
    const exchange = { turnId: "tour", prompts: ["Question"], answer: { id: "réponse", role: "assistant", text: "Réponse", paths: [] } };
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      await prepareCorrections(project, folders);
      const path = "Bible/Suivi/Connaissances.md";
      await writeFile(join(project, path), "Mes notes.\n");
      await writeFile(join(project, "Archives/Bible/Suivi"), "Obstacle.");
      await assert.rejects(recordReaction(project, folders, "session", exchange, "up", "Utile."));
      assert.equal(await readFile(join(project, path), "utf8"), "Mes notes.\n");
      await rm(join(project, "Archives/Bible/Suivi"));
      const rating = await recordReaction(project, folders, "session", exchange, "up", "Utile.");
      assert.equal((await readdir(join(project, "Bible/Suivi"))).filter(name => name.includes("-reaction-")).length, 1);
      const original = await readFile(join(project, path), "utf8");
      const edited = original.replace("## Réaction de l’auteur", "Ma précision personnelle.\n\n## Réaction de l’auteur");
      await writeFile(join(project, path), edited);
      await assert.rejects(recordReaction(project, folders, "session", exchange, "down", "Autre avis.", rating), /modifications personnelles/);
      assert.equal(await readFile(join(project, path), "utf8"), edited);
      const broken = original.replace(/<!-- orelius:reaction:[a-f0-9]+:end -->/, "");
      await writeFile(join(project, path), broken);
      await assert.rejects(recordReaction(project, folders, "session", exchange, "down", "Autre avis.", rating), /repères de réaction/);
      assert.equal(await readFile(join(project, path), "utf8"), broken);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Acceptation : retour exact, exemple positif figé, notes préservées et absence de doublon", async () => {
    const project = join(directory, "acceptance");
    const folders = { ...DEFAULT_PROJECT_FOLDERS, manuscriptFolder: "Roman", bibleFolder: "Univers", archiveFolder: "Versions" };
    const path = "Roman/Chapitres/Été.md";
    const snapshot = { before: "Il parle.\n", after: "« Djo, viens ici ! »\n" };
    const message = "  Enfin, voilà ce que je voulais.\n\nGarde cette voix, surtout le rythme.  ";
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      await prepareCorrections(project, folders);
      await writeFile(join(project, path), snapshot.after);
      const knowledgePath = "Univers/Suivi/Connaissances.md";
      const personal = "# Connaissances\n\nMes notes personnelles, à conserver.\n";
      await writeFile(join(project, knowledgePath), personal);
      const before = await stat(join(project, path));
      const report = await recordAcceptance(project, folders, path, snapshot, message);
      assert.match(report, /^Univers\/Suivi\/\d{4}-\d{2}-\d{2}T.+-acceptation-[a-f0-9]{64}\.md$/);
      const accepted = await readFile(join(project, report), "utf8");
      const quoted = value => value.split("\n").map(line => `    ${line}`).join("\n");
      assert.ok(accepted.includes(quoted(message)));
      assert.ok(accepted.includes(`## Version approuvée\n\n${quoted(snapshot.after)}`));
      assert.ok(accepted.includes("exemple positif"));
      assert.ok(accepted.includes("version produite par Codex"));
      const knowledge = await readFile(join(project, knowledgePath), "utf8");
      assert.ok(knowledge.startsWith(personal));
      assert.ok(knowledge.includes(report.split("/").pop()));
      assert.ok((await readFile(join(project, "Univers/suivi.md"), "utf8")).includes(report.split("/").pop()));
      const copies = await readdir(join(project, "Versions/Univers/Suivi"));
      assert.equal(copies.length, 1);
      assert.equal(await readFile(join(project, "Versions/Univers/Suivi", copies[0]), "utf8"), personal);
      const again = await recordAcceptance(project, folders, path, snapshot, message);
      assert.equal(again, report);
      assert.equal(await readFile(join(project, knowledgePath), "utf8"), knowledge);
      assert.equal((await readdir(join(project, "Univers/Suivi"))).filter(name => name.includes("-acceptation-")).length, 1);
      const after = await stat(join(project, path));
      assert.equal(after.ino, before.ino);
      assert.equal(after.mtimeMs, before.mtimeMs);
      assert.equal(await readFile(join(project, path), "utf8"), snapshot.after);
      const agent = renderAgent(agentTemplate, loadSettings(folders));
      for (const text of ["exemples positifs", "Enfin, voilà ce que je voulais", "retouches humaines", "Univers/suivi.md"]) assert.ok(agent.includes(text), text);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Acceptation : la version relue avec retouches humaines est celle approuvée", async () => {
    const project = join(directory, "human-acceptance");
    const folders = DEFAULT_PROJECT_FOLDERS;
    const path = "Manuscript/Chapitres/1.md";
    const snapshot = { before: "Original.\n", after: "Révision Codex.\n" };
    const human = "Ma retouche de la révision.\n";
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      await writeFile(join(project, path), human);
      const report = await recordAcceptance(project, folders, path, snapshot, "");
      const text = await readFile(join(project, report), "utf8");
      assert.ok(text.includes("retouches de l’auteur"));
      assert.ok(text.includes("    Ma retouche de la révision."));
      assert.ok(text.includes("Aucun message supplémentaire."));
      assert.equal(await readFile(join(project, path), "utf8"), human);
      await writeFile(join(project, path), "Version suivante.\n");
      assert.equal(await readFile(join(project, report), "utf8"), text);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Acceptation : échec d’archive ou éditeur modifié, données préservées et reprise sans doublon", async () => {
    const project = join(directory, "failed-acceptance");
    const folders = DEFAULT_PROJECT_FOLDERS;
    const path = "Manuscript/Chapitres/1.md";
    const snapshot = { before: "Original.\n", after: "Version à accepter.\n" };
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      await prepareCorrections(project, folders);
      await writeFile(join(project, path), snapshot.after);
      const knowledge = "Bible/Suivi/Connaissances.md";
      await writeFile(join(project, knowledge), "Notes personnelles.\n");
      await writeFile(join(project, "Archives/Bible/Suivi"), "Obstacle à l’archive.");
      await assert.rejects(recordAcceptance(project, folders, path, snapshot, "Enfin !"));
      assert.equal(await readFile(join(project, knowledge), "utf8"), "Notes personnelles.\n");
      assert.equal(await readFile(join(project, path), "utf8"), snapshot.after);
      assert.equal((await readFile(join(project, "Bible/suivi.md"), "utf8")).includes("orelius:acceptance:"), false);
      await rm(join(project, "Archives/Bible/Suivi"));
      const report = await recordAcceptance(project, folders, path, snapshot, "Enfin !");
      assert.ok((await readFile(join(project, knowledge), "utf8")).includes(report.split("/").pop()));
      assert.equal((await readdir(join(project, "Bible/Suivi"))).filter(name => name.includes("-acceptation-")).length, 1);
      await assert.rejects(recordAcceptance(project, folders, path, snapshot, "Autre retour", () => { throw new Error("Corrections non enregistrées."); }), /Corrections non enregistrées/);
      assert.equal((await readdir(join(project, "Bible/Suivi"))).filter(name => name.includes("-acceptation-")).length, 1);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Acceptation : notes hors chapitre, révision vide et liens refusés", async () => {
    const project = join(directory, "invalid-acceptance");
    const folders = DEFAULT_PROJECT_FOLDERS;
    const snapshot = { before: "Avant", after: "Après" };
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      for (const path of ["Bible/Style/Narration.md", "../1.md", "Model/Chapitres/1.md"]) {
        await assert.rejects(recordAcceptance(project, folders, path, snapshot, ""), /Ouvrez un chapitre/);
      }
      const path = "Manuscript/Chapitres/1.md";
      await assert.rejects(recordAcceptance(project, folders, path, { before: "Identique", after: "Identique" }, ""), /Aucune modification/);
      await assert.rejects(recordAcceptance(project, folders, path, snapshot, ""), /Chapitre introuvable/);
      await writeFile(join(project, "source.md"), snapshot.after);
      await symlink(join(project, "source.md"), join(project, path));
      await assert.rejects(recordAcceptance(project, folders, path, snapshot, ""), /symboliques/);
      assert.equal(await readFile(join(project, "source.md"), "utf8"), snapshot.after);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Saturation : message explicite et relance réservée aux erreurs de capacité", async () => {
    for (const code of ["serverOverloaded", "server_overloaded", "server_is_overloaded"]) {
      const failure = codexFailure("Service indisponible", code);
      assert.equal(failure.retryable, true);
      assert.match(failure.message, /temporairement saturé côté OpenAI/);
      assert.match(failure.message, /quota.*n’est pas épuisé/);
    }
    assert.equal(codexFailure("Selected model is at capacity. Please try a different model.").retryable, true);
    for (const message of ["Quota épuisé", "Connexion interrompue", "Écriture refusée"]) {
      assert.deepEqual(codexFailure(message), { message, retryable: false });
    }
  });

  await check("Relance : même dossier, même conversation, corrections récentes préservées", async () => {
    const project = join(directory, "retry");
    const path = "chapitre.md";
    const original = "Original.\n";
    const plan = planRevision(path, original, original, "Recommence.");
    const session = new ChatSession(() => {}, async () => {});
    await mkdir(project);
    try {
      await writeFile(join(project, path), original);
      session.threadId = "conversation";
      session.lastRequest = { text: "Recommence.", cwd: project, threadId: session.threadId, revision: plan, protections: [] };
      session.fail(new Error("Selected model is at capacity. Please try a different model."));
      assert.equal(session.canRetry, true);
      session.busy = true;
      assert.equal(session.canRetry, false);
      await assert.rejects(session.retry("", project, session.threadId), /Aucune demande.*relancer/);
      session.busy = false;
      await assert.rejects(session.retry("", join(project, "autre"), session.threadId), /dossier.*conversation/);
      await assert.rejects(session.retry("", project, "autre"), /dossier.*conversation/);
      await writeFile(join(project, path), "Correction après l’échec.\n");
      await assert.rejects(session.retry("", project, session.threadId), /a changé.*Réviser/);
      assert.equal(await readFile(join(project, path), "utf8"), "Correction après l’échec.\n");
      assert.equal(session.canRetry, true);
      assert.equal(session.lastRequest.revision, plan);
      assert.equal(plan.expected, original);
      await session.newConversation();
      assert.equal(session.canRetry, false);
      assert.equal(session.failure, null);
    } finally { await session.disconnect(); await rm(project, { recursive: true }); }
  });

  await check("Contexte éditorial : corrections du chapitre précédent, avis exacts et sources intégrales paginées", async () => {
    const project = join(directory, "editorial-sources");
    const elsewhere = join(directory, "other-editorial-project");
    const folders = { ...DEFAULT_PROJECT_FOLDERS, manuscriptFolder: "Roman", bibleFolder: "Univers" };
    const path = "Roman/Chapitres/001.md";
    const baseline = "Une voix sans intention.\n";
    const human = "Une voix. (((Que dit-elle ? Garde la voix du narrateur au chapitre suivant.)))\n";
    const knowledge = "# Connaissances\n\n" + "Exemple de l’auteur 🖋.\n".repeat(3000) + "Dernière remarque à conserver.\n";
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      await prepareCorrections(project, folders);
      await writeFile(join(project, path), human);
      await writeFile(join(project, "Univers/Style/Narration.md"), "Première personne, présent, rythme nouchi.\n");
      await writeFile(join(project, "Univers/Suivi/Connaissances.md"), knowledge);
      const approved = "Enfin, voilà ce que je voulais.";
      const accepted = await recordAcceptance(project, folders, path, { before: baseline, after: human }, approved);
      const feedback = await recordReaction(project, folders, "session", { turnId: "tour", prompts: ["Écris 002."],
        answer: { id: "réponse", role: "assistant", text: "Voici 002.", paths: [] } }, "down", "La transition ne signifie rien.");
      const pages = (await readEditorialContext(project, folders, { [path]: baseline, "../externe.md": "Interdit" })).map(JSON.parse);
      const files = new Map();
      for (const page of pages) {
        assert.equal(page.pages, pages.length);
        assert.ok(page.sources.reduce((size, source) => size + source.content.length, 0) <= 8000);
        for (const source of page.sources) files.set(source.path, (files.get(source.path) ?? "") + source.content);
      }
      assert.ok(pages.length > 1);
      assert.equal(files.get(path), human);
      assert.ok(files.get(`${path} — comparaison Codex/auteur`).includes(baseline.trim()));
      assert.ok(files.get(`${path} — comparaison Codex/auteur`).includes("Que dit-elle ?"));
      assert.equal(files.get("Univers/Suivi/Connaissances.md"), await readFile(join(project, "Univers/Suivi/Connaissances.md"), "utf8"));
      assert.ok(files.get(accepted).includes(approved));
      assert.ok(files.get(feedback.report).includes("La transition ne signifie rien."));
      assert.ok(!files.has("../externe.md"));
      assert.equal(await readFile(join(project, path), "utf8"), human);
      await mkdir(elsewhere);
      assert.deepEqual(JSON.parse((await readEditorialContext(elsewhere, folders, {}))[0]).sources, []);
    } finally {
      await rm(project, { recursive: true });
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  await check("Relance après réouverture : erreur retrouvée, demande et zones protégées récupérées", async () => {
    const project = join(directory, "restored-retry");
    const path = "Manuscript/Chapitres/Été.md";
    const baseline = "Début intact.\n\nUne voix.\n\nFin intacte.\n";
    const human = baseline.replace("Une voix.", "Une voix. (((Sa réplique.)))");
    const versions = { [path]: baseline };
    const folders = DEFAULT_PROJECT_FOLDERS;
    const session = new ChatSession(() => {}, async () => {}, undefined, () => ({ ...folders, codexVersions: { [project]: versions } }));
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      await writeFile(join(project, path), human);
      const details = "Donne-lui une voix.\n\n## Précisions supplémentaires de l’auteur\n\nGarde cette précision aussi.";
      const text = await revisionPrompt(project, folders, path, versions, details);
      assert.deepEqual(revisionRequest(text), { path, details });
      assert.equal(revisionRequest("Parlons du chapitre, sans le modifier."), null);
      session.threadId = "conversation";
      const failed = { id: "échec", completed: false, date: null, failure: codexFailure("Selected model is at capacity. Please try a different model."),
        messages: [{ id: "prompt", role: "user", text, paths: [] }, { id: "consigne", role: "user", text: "Conserve la dernière phrase.", paths: [] }] };
      session.restoreFailure(project, session.threadId, [failed]);
      assert.equal(session.canRetry, true);
      session.status = "";
      assert.match(session.failure.message, /temporairement saturé/);
      const request = await session.prepareRetry(project, session.threadId);
      assert.equal(request.text, `${text}\n\nConserve la dernière phrase.`);
      assert.equal(request.revision.path, path);
      assert.equal(request.revision.wholeChapter, false);
      request.revision.intentRecorded = true;
      assert.throws(() => checkRevision(request.revision, human, human.replace("Fin intacte", "Fin changée")), /hors des paragraphes/);
      assert.equal(await readFile(join(project, path), "utf8"), human);
      assert.deepEqual((await readdir(join(project, "Archives"), { recursive: true })).filter(path => path.endsWith(".md")), []);
      session.restoreFailure(project, session.threadId, [{ ...failed, id: "échec suivant" }]);
      await writeFile(join(project, path), baseline);
      await assert.rejects(session.prepareRetry(project, session.threadId), /Le chapitre ou les consignes ont changé depuis l’échec\. Utilisez Réviser/);
      session.restoreFailure(project, session.threadId, [{ ...failed, id: "ancien format", messages: [{ id: "prompt", role: "user", text: 'Révise le chapitre "Manuscript/Chapitres/Été.md" avec un ancien format.', paths: [] }] }]);
      await assert.rejects(session.prepareRetry(project, session.threadId), /ancienne demande de révision.*Réviser/);
      session.restoreFailure(project, session.threadId, [{ ...failed, completed: true, failure: undefined }]);
      assert.equal(session.failure, null);
      assert.equal(session.canRetry, false);
    } finally { await session.disconnect(); await rm(project, { recursive: true }); }
  });

  await check("Verrou éditeur : saisie, collage et annulation bloqués ; mises à jour Codex et sélection conservées", async () => {
    const locks = new Set(["chapitre.md"]);
    const extension = editorLock(() => "chapitre.md", path => locks.has(path));
    let state = EditorState.create({ doc: "Original", extensions: [extension] });
    assert.equal(state.readOnly, true);
    assert.equal(state.facet(EditorView.editable), false);
    for (const userEvent of ["input.type", "input.paste", "input.drop", "input.finition-correction", "delete.backward", "move.drop", "undo", "redo"]) {
      const attempted = state.update({ changes: { from: 0, to: state.doc.length, insert: "Écriture humaine" }, userEvent });
      assert.equal(attempted.newDoc.toString(), "Original", userEvent);
    }
    state = state.update({ selection: { anchor: 3 } }).state;
    assert.equal(state.selection.main.head, 3);
    state = state.update({ changes: { from: 0, to: state.doc.length, insert: "Version Codex" } }).state;
    assert.equal(state.doc.toString(), "Version Codex");
    assert.equal(state.readOnly, true);
    locks.clear();
    state = state.update({}).state;
    assert.equal(state.readOnly, false);
    assert.equal(state.facet(EditorView.editable), true);
    state = state.update({ changes: { from: state.doc.length, insert: " corrigée" }, userEvent: "input.type" }).state;
    assert.equal(state.doc.toString(), "Version Codex corrigée");
  });

  await check("Verrou éditeur : note ciblée uniquement, navigation, état antérieur et retrait du plugin", async () => {
    const path = Facet.define({ combine: values => values[0] });
    const note = new Compartment();
    const lock = new Compartment();
    const locks = new Set(["A.md"]);
    const extension = editorLock(state => state.facet(path), value => locks.has(value));
    let state = EditorState.create({ doc: "Texte", extensions: [note.of(path.of("A.md")), lock.of(extension)] });
    assert.equal(state.readOnly, true);
    const other = EditorState.create({ doc: "Autre note", extensions: [path.of("B.md"), extension] });
    assert.equal(other.readOnly, false);
    state = state.update({ effects: note.reconfigure(path.of("B.md")) }).state;
    assert.equal(state.readOnly, false);
    state = state.update({ effects: note.reconfigure(path.of("A.md")) }).state;
    assert.equal(state.readOnly, true);
    state = state.update({ effects: lock.reconfigure([]) }).state;
    assert.equal(state.readOnly, false);
    assert.equal(state.facet(EditorView.editable), true);
    locks.clear();
    const alreadyReadOnly = EditorState.create({ extensions: [path.of("A.md"), EditorState.readOnly.of(true), EditorView.editable.of(false), extension] });
    assert.equal(alreadyReadOnly.readOnly, true);
    assert.equal(alreadyReadOnly.facet(EditorView.editable), false);
    let currentPath = "B.md";
    locks.add("A.md");
    const beforeNavigation = EditorState.create({ doc: "Intact", extensions: [editorLock(() => currentPath, value => locks.has(value))] });
    currentPath = "A.md";
    const firstInput = beforeNavigation.update({ changes: { from: 0, insert: "À bloquer" }, userEvent: "input.type" });
    assert.equal(firstInput.newDoc.toString(), "Intact");
    assert.equal(firstInput.state.readOnly, true);
  });

  await check("Diff : reconstruction exacte, Unicode, passages séparés et grands textes", async () => {
    let seed = 727;
    const alphabet = ["a", "b", "é", "e\u0301", "🖋", "\n", "\r\n", " ", "(((", ")))", "==", "’"];
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    const sample = () => Array.from({ length: random() % 35 }, () => alphabet[random() % alphabet.length]).join("");
    const cases = Array.from({ length: 150 }, () => [sample(), sample()]);
    const large = Array.from({ length: 2500 }, (_, i) => `Paragraphe ${i}.\n`).join("");
    cases.push([large, large.replace("Paragraphe 0.", "Début révisé.").replace("Paragraphe 2499.", "Fin révisée.")]);
    for (const [before, after] of cases) for (const lines of [false, true]) {
      let result = "", cursor = 0;
      for (const change of diffToGroups(before, after, lines)) {
        assert.ok(change.delFrom >= cursor);
        assert.equal(before.slice(change.delFrom, change.delTo), change.delText);
        result += before.slice(cursor, change.delFrom) + (change.insText ?? "");
        cursor = change.delTo;
      }
      assert.equal(result + before.slice(cursor), after);
    }
    const separate = correctionReport("1.md", "Avant.\n\nIntact au milieu.\n\nAprès.", "Repris.\n\nIntact au milieu.\n\nModifié.");
    assert.equal(separate.includes("Intact au milieu."), false);
    assert.ok(separate.includes("Modification 2"));
    assert.throws(() => diffToGroups(Array.from({ length: 2100 }, (_, i) => `ancien-${i}\n`).join(""),
      Array.from({ length: 2100 }, (_, i) => `nouveau-${i}\n`).join(""), true), /Diff trop étendu/);
  });

  await check("Révision ciblée : seuls les paragraphes humains sont autorisés, après consignation de l’intention", async () => {
    const baseline = "# Chapitre\n\nUn homme parle.\n\nIntact,  vraiment.\n\nUne notification.\n\nFin intacte.\n";
    const human = baseline.replace("Un homme parle.", "Un homme parle. (((Sa réplique exacte.)))")
      .replace("Une notification.", "Une notification. (((Le commentaire précis.)))");
    const plan = planRevision("Manuscript/Chapitres/1.md", human, baseline);
    assert.equal(plan.ranges.length, 2);
    assert.equal(revisionFor([plan], "/projet", "MANUSCRIPT/Chapitres/1.md"), plan);
    assert.equal(revisionFor([plan], "/projet", "Manuscript/Chapitres/autre.md"), undefined);
    assert.equal(revisionFor([plan], "/projet", "../Manuscript/Chapitres/1.md"), undefined);
    assert.equal(revisionPath(plan, "/projet", "Univers", "MANUSCRIPT/Chapitres/1.md"), plan.path);
    assert.equal(revisionPath(plan, "/projet", "Univers", "/projet/Univers/Suivi/Connaissances.md"), "Univers/Suivi/Connaissances.md");
    for (const path of ["Manuscript/Chapitres/2.md", "Univers/Style/Narration.md", "Univers/Suivi/Conversation.md", "../Manuscript/Chapitres/1.md", "AGENTS.md"])
      assert.throws(() => revisionPath(plan, "/projet", "Univers", path), /seulement le chapitre ciblé/);
    const proposed = human.replace("Un homme parle. (((Sa réplique exacte.)))", "Un homme crie : « Djo, viens. »")
      .replace("Une notification. (((Le commentaire précis.)))", "Pseudo77 écrit : « Arrête. »");
    assert.throws(() => checkRevision(plan, human, proposed), /consignez d’abord l’intention/);
    plan.intentRecorded = true;
    assert.doesNotThrow(() => checkRevision(plan, human, proposed));
    for (const modified of [proposed.replace("Intact,  vraiment.", "Intact, vraiment."), proposed.replace("Fin intacte.", "Fin modifiée."),
      proposed.replace("# Chapitre", "# Chapitre revu"), proposed.replace("Intact,", "Intact ;")])
      assert.throws(() => checkRevision(plan, human, modified), /hors des paragraphes/);
    assert.throws(() => checkRevision(plan, `${human}\nRetouche récente.`, proposed), /a changé depuis/);
    assert.throws(() => checkRevision(plan, human, proposed.replace("Pseudo77", "==Pseudo77==")), /sans balise/);
    plan.expected = proposed;
    assert.doesNotThrow(() => checkRevision(plan, proposed, proposed.replace("Djo, viens.", "Djo, viens ici.")));
  });

  await check("Révision ciblée : annotations sans référence, coupes seules et paragraphes répétés", async () => {
    assert.throws(() => planRevision("1.md", "Texte intact", "Texte intact"), /intacts sont protégés/);
    assert.throws(() => planRevision("1.md", "Texte sans référence"), /Aucune référence/);
    const annotated = "Intact.\n\nPassage (((Préciser.)))\n\nIntact.";
    assert.equal(planRevision("1.md", annotated).ranges.length, 1);
    const baseline = "Même passage.\n\nÀ couper.\n\nMême passage.\n";
    const human = "Même passage.\n\nMême passage.\n";
    const plan = planRevision("1.md", human, baseline);
    assert.deepEqual(plan.ranges, []);
    plan.intentRecorded = true;
    assert.doesNotThrow(() => checkRevision(plan, human, human));
    assert.throws(() => checkRevision(plan, human, baseline), /hors des paragraphes/);
  });

  await check("Réviser par le chat : texte intact, consigne seule et archivage de la reprise", async () => {
    const project = join(directory, "revision-chat");
    const folders = DEFAULT_PROJECT_FOLDERS;
    const path = "Manuscript/Chapitres/1.md";
    const text = "# Chapitre\n\nUn homme parle.\n\nUne notification.\n";
    const details = "Ça ne va pas du tout. Recommence avec des répliques concrètes et les sonorités nouchi.";
    const proposed = "# Nouveau chapitre\n\n« Djo, viens ici ! »\n\nPseudo77 écrit : « Y’a pas drap. »\n";
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      await writeFile(join(project, path), text);
      for (const baseline of [text, undefined]) {
        const plan = planRevision(path, text, baseline, details);
        assert.equal(plan.wholeChapter, true);
        assert.deepEqual(plan.ranges, [{ from: 0, to: text.length }]);
        assert.throws(() => checkRevision(plan, text, proposed), /consignez d’abord l’intention/);
        plan.intentRecorded = true;
        assert.doesNotThrow(() => checkRevision(plan, text, proposed));
        assert.throws(() => checkRevision(plan, `${text}Retouche.`, proposed), /a changé depuis/);
        assert.throws(() => checkRevision(plan, text, `==${proposed}==`), /sans balise/);
        assert.throws(() => revisionPath(plan, project, folders.bibleFolder, "Manuscript/Chapitres/2.md"), /seulement le chapitre ciblé/);
        const prompt = await revisionPrompt(project, folders, path, baseline === undefined ? {} : { [path]: baseline }, details);
        assert.equal(await revisionPrompt(project, folders, path, baseline === undefined ? {} : { [path]: baseline }, details, plan), prompt);
        assert.ok(prompt.includes("Le chapitre entier est autorisé à la révision"));
        assert.ok(prompt.includes("sans inventer de corrections humaines"));
        assert.ok(prompt.endsWith(details));
        assert.equal(await readFile(join(project, path), "utf8"), text);
        assert.throws(() => planRevision(path, text, baseline, " \n "), /Aucune référence|intacts sont protégés/);
      }
      const annotated = text.replace("Un homme parle.", "Un homme parle. (((Sa réplique.)))");
      const targeted = planRevision(path, annotated, text, details);
      assert.equal(targeted.wholeChapter, false);
      targeted.intentRecorded = true;
      assert.throws(() => checkRevision(targeted, annotated, proposed), /hors des paragraphes/);
      const cut = planRevision(path, text.replace("Un homme parle.\n\n", ""), text, details);
      assert.equal(cut.wholeChapter, false);
      assert.deepEqual(cut.ranges, []);
      const plan = planRevision(path, text, text, details);
      plan.intentRecorded = true;
      const copies = await writeProjectFile(project, path, proposed, await readProjectFile(project, path), folders.archiveFolder, undefined, undefined, true, plan);
      assert.equal(copies.length, 2);
      assert.equal(await readFile(join(project, copies[0]), "utf8"), text);
      assert.equal(await readFile(join(project, copies[1]), "utf8"), proposed);
      assert.equal(await readFile(join(project, path), "utf8"), proposed);
      assert.ok(revisionMarks({ before: text, after: proposed }, proposed).length > 0);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Surlignage : mots modifiés, suppressions et déplacements après édition, sans balise", async () => {
    const snapshot = { before: "Il parle à Abidjan.\r\n\r\nIntact.\r\n", after: "Il crie à Yopougon.\r\n\r\nIntact.\r\n" };
    const text = snapshot.after.replace(/\r\n/g, "\n");
    const marks = revisionMarks(snapshot, text);
    assert.deepEqual(marks.map(mark => text.slice(mark.from, mark.to)), ["crie", "Yopougon"]);
    const shifted = `🖋 Note.\n${text}`;
    assert.deepEqual(revisionMarks(snapshot, shifted).map(mark => shifted.slice(mark.from, mark.to)), ["crie", "Yopougon"]);
    const edited = text.replace("crie", "murmure");
    assert.deepEqual(revisionMarks(snapshot, edited).map(mark => edited.slice(mark.from, mark.to)), ["Yopougon"]);
    const removed = revisionMarks({ before: "Il parle doucement.", after: "Il parle." }, "Il parle.");
    assert.ok(removed.some(mark => mark.from === mark.to && mark.removed.includes("doucement")));
    assert.deepEqual(revisionMarks({ before: "é🖋\r\n", after: "é🖋\n" }, "é🖋\n"), []);
    const settings = loadSettings({ revisionHighlights: { "Roman/1.md": snapshot } });
    assert.deepEqual(loadSettings(JSON.parse(JSON.stringify(settings))).revisionHighlights, settings.revisionHighlights);
    assert.deepEqual(loadSettings(undefined).revisionHighlights, {});
    for (const value of [[], null, { "1.md": { before: 42, after: "texte" } }]) assert.throws(() => loadSettings({ revisionHighlights: value }), /surlignage/);
    assert.equal(snapshot.after.includes("=="), false);
  });

  await check("Écriture ciblée : débordement refusé avant archivage, texte humain préservé et résultat exact archivé", async () => {
    const project = join(directory, "targeted-write");
    await mkdir(project);
    try {
      const folders = DEFAULT_PROJECT_FOLDERS;
      await prepareProject(project, folders);
      const path = "Manuscript/Chapitres/1.md";
      const baseline = "Début intact.\n\nUn homme parle.\n\nFin intacte.\n";
      const human = baseline.replace("Un homme parle.", "Un homme parle. (((Quoi ?)))");
      await writeFile(join(project, path), human);
      const plan = planRevision(path, human, baseline);
      const proposed = human.replace("Un homme parle. (((Quoi ?)))", "Un homme dit : « Y’a pas drap. »");
      const previous = await readProjectFile(project, path);
      await assert.rejects(writeProjectFile(project, path, proposed, previous, "Archives", undefined, undefined, true, plan), /consignez d’abord l’intention/);
      plan.intentRecorded = true;
      await assert.rejects(writeProjectFile(project, path, proposed.replace("Fin intacte", "Fin changée"), previous, "Archives", undefined, undefined, true, plan), /hors des paragraphes/);
      assert.equal(await readFile(join(project, path), "utf8"), human);
      assert.deepEqual((await readdir(join(project, "Archives"), { recursive: true })).filter(path => path.endsWith(".md")), []);
      const copies = await writeProjectFile(project, path, proposed, previous, "Archives", undefined, undefined, true, plan);
      assert.equal(copies.length, 2);
      assert.equal(await readFile(join(project, copies[0]), "utf8"), human);
      assert.equal(await readFile(join(project, copies[1]), "utf8"), proposed);
      assert.equal(await readFile(join(project, path), "utf8"), proposed);
      assert.equal(proposed.includes("=="), false);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Activités : masquées par défaut, réglage conservé entre les dossiers et après relecture", async () => {
    const defaults = loadSettings(undefined);
    assert.equal(defaults.showActivity, false);
    assert.equal(loadSettings({ folder: "Roman" }).showActivity, false);
    const enabled = applySettings(defaults, { showActivity: true });
    const restored = loadSettings(JSON.parse(JSON.stringify(enabled)));
    assert.equal(restored.showActivity, true);
    assert.equal(applySettings(restored, { folder: "Autre roman" }).showActivity, true);
    assert.equal(loadSettings(JSON.parse(JSON.stringify(applySettings(restored, { showActivity: false })))).showActivity, false);
    for (const value of ["true", "false", 1, null]) assert.equal(loadSettings({ showActivity: value }).showActivity, false);
  });

  await check("Connaissances : création et enrichissement archivés, autres fichiers du suivi protégés", async () => {
    const project = join(directory, "knowledge");
    const folders = { ...DEFAULT_PROJECT_FOLDERS, bibleFolder: "Univers", archiveFolder: "Versions" };
    const path = "Univers/Suivi/Connaissances.md";
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      await prepareCorrections(project, folders);
      await assert.rejects(access(join(project, path)), { code: "ENOENT" });
      const archive = (...args) => archiveWithCorrections(args[0], folders, args[1], {}, () => {});
      const first = "# Connaissances de l’auteur\n\n## Consignes explicites\n- Phrases brèves dans les dialogues ; source : chapitre 1, commentaire de l’auteur.\n";
      const created = await writeProjectFile(project, path, first, null, folders.archiveFolder, archive, undefined, true);
      assert.equal(created.length, 1);
      assert.equal(await readFile(join(project, created[0]), "utf8"), first);
      const personal = `${first}\nNote personnelle : garder des variations de rythme.\n`;
      await writeFile(join(project, path), personal);
      await prepareCorrections(project, folders);
      assert.equal(await readFile(join(project, path), "utf8"), personal);
      const enriched = `${personal}\n## Hypothèses\n- Des descriptions plus courtes semblent préférées ; portée : chapitre 2 ; source : Suivi/2026-10-26.md ; à confirmer.\n`;
      const copies = await writeProjectFile(project, path, enriched, await readProjectFile(project, path), folders.archiveFolder, archive, undefined, true);
      assert.equal(copies.length, 2);
      assert.equal(await readFile(join(project, copies[0]), "utf8"), personal);
      assert.equal(await readFile(join(project, copies[1]), "utf8"), enriched);
      assert.equal(await readFile(join(project, path), "utf8"), enriched);
      assert.ok(copies.every(copy => copy.startsWith("Versions/Univers/Suivi/Connaissances.")));
      for (const blocked of ["Univers/suivi.md", "UNIVERS/SUIVI.MD", "Univers/Suivi/Conversation.md", "Univers/Suivi/2026-10-26.md", "Univers/Suivi/Connaissances.md/autre.md"])
        await assert.rejects(archiveWithCorrections(project, folders, [{ path: blocked, kind: { type: "add" } }], {}, () => {}), /relevés/);
      const denied = (...args) => archiveWithCorrections(args[0], folders, args[1], {}, () => { throw new Error("Éditeur modifié"); });
      await assert.rejects(writeProjectFile(project, path, "À refuser", await readProjectFile(project, path), folders.archiveFolder, denied, undefined, true), /Éditeur modifié/);
      assert.equal(await readFile(join(project, path), "utf8"), enriched);
      const instructions = renderAgent(agentTemplate, loadSettings(folders));
      for (const text of [path, "Consignes explicites", "Hypothèses", "Contradictions", "source", "portée", "demande actuelle"])
        assert.ok(instructions.includes(text), text);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Réviser : chapitre ciblé, diff humain, consignes et précisions facultatives", async () => {
    const project = join(directory, "revision");
    const folders = { ...DEFAULT_PROJECT_FOLDERS, manuscriptFolder: "Roman", bibleFolder: "Univers", archiveFolder: "Versions" };
    const path = "Roman/Chapitres/Été.md";
    const codex = "# Été\nContexte avant.\nUne longue description.\nUn passage coupé.\nContexte après.\n";
    const human = "# Été\nContexte avant.\nMa réécriture. ~~À retirer.~~ (((Resserre la tension.\nGarde mon point de vue.)))\nContexte après.\n";
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      await writeFile(join(project, path), human);
      const archiveBefore = await readdir(join(project, folders.archiveFolder), { recursive: true });
      const versions = { [path]: codex };
      const prompt = await revisionPrompt(project, folders, path, versions, "");
      for (const text of [JSON.stringify(path), "Une longue description.", "Un passage coupé.", "Ma réécriture.",
        "Resserre la tension.", "Garde mon point de vue.", "À retirer.", "chapitre complet", "passages voisins", "plan",
        "Univers/Style/Narration.md", "Univers/suivi.md", "Univers/Suivi/Connaissances.md", "Univers/Suivi/", "ecrire_fichier", "ne réintroduis pas les passages supprimés"])
        assert.ok(prompt.includes(text), text);
      assert.equal(prompt.includes("## Précisions supplémentaires"), false);
      const detailed = await revisionPrompt(project, folders, path, versions, "  Garde le présent.\nConserve la dernière phrase.  ");
      assert.ok(detailed.endsWith("## Précisions supplémentaires de l’auteur\n\nGarde le présent.\nConserve la dernière phrase."));
      assert.equal(await readFile(join(project, path), "utf8"), human);
      assert.equal(versions[path], codex);
      assert.deepEqual(await readdir(join(project, folders.archiveFolder), { recursive: true }), archiveBefore);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Réviser : référence absente ou texte inchangé sans faux diff", async () => {
    const project = join(directory, "revision-reference");
    const folders = DEFAULT_PROJECT_FOLDERS;
    const path = "Manuscript/Chapitres/1.md";
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      const text = "Texte (((À approfondir.)))";
      await writeFile(join(project, path), text);
      const unknown = await revisionPrompt(project, folders, path, {}, "");
      assert.ok(unknown.includes("Aucune version Codex de référence connue"));
      assert.equal(unknown.includes("## Version Codex"), false);
      assert.ok(unknown.includes("commentaires (((...)))"));
      const unchanged = await revisionPrompt(project, folders, path, { [path]: text }, "");
      assert.ok(unchanged.includes("identique à la dernière version Codex connue"));
      assert.equal(unchanged.includes("corrections précédentes de cette version sont abandonnées"), false);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Réviser : refus des autres notes, chapitres absents et liens symboliques", async () => {
    const project = join(directory, "revision-invalid");
    await mkdir(project);
    try {
      await prepareProject(project, DEFAULT_PROJECT_FOLDERS);
      for (const path of ["../autre.md", "Bible/Style/Narration.md", "Model/Chapitres/1.md", "Manuscript/Chapitres", "Manuscript/Chapitres/../../Bible/note.md"])
        await assert.rejects(revisionPrompt(project, DEFAULT_PROJECT_FOLDERS, path, {}, ""), /Ouvrez un chapitre/);
      const path = "Manuscript/Chapitres/absent.md";
      await assert.rejects(revisionPrompt(project, DEFAULT_PROJECT_FOLDERS, path, {}, ""), /Chapitre introuvable/);
      await writeFile(join(project, "note.md"), "Conserver");
      await symlink(join(project, "note.md"), join(project, path));
      await assert.rejects(revisionPrompt(project, DEFAULT_PROJECT_FOLDERS, path, {}, ""), /symboliques/);
      assert.equal(await readFile(join(project, "note.md"), "utf8"), "Conserver");
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Conversation : dates françaises, prompts et réponses finales sans traces techniques", async () => {
    const message = (role, text, phase) => ({ id: text, role, text, phase, paths: [] });
    const turns = [
      { id: "a", date: new Date(2026, 9, 26, 12), completed: true, messages: [
        message("user", "Écris un passage.\nÀ la première personne."),
        message("assistant", "Je consulte les documents.", "commentary"),
        message("activity", "Commande : lire les fichiers"),
        message("assistant", "Un brouillon intermédiaire.", "partial_answer"),
        message("assistant", "Le passage final.", "final_answer"),
      ] },
      { id: "b", date: new Date(2026, 9, 26, 18), completed: true, messages: [
        message("user", "Raccourcis."), message("assistant", "Ancien commentaire sans phase."), message("assistant", "Le texte raccourci."),
      ] },
      { id: "c", date: new Date(2026, 9, 27, 10), completed: false, messages: [
        message("user", "Autre tentative."), message("assistant", "Texte interrompu.", "final_answer"),
      ] },
      { id: "d", date: null, completed: true, messages: [message("user", "Ancien prompt."), message("assistant", "Ancienne réponse.", "final_answer")] },
    ];
    const content = renderConversation(turns);
    assert.equal(content.split("# Lundi 26 octobre 2026\n").length, 2);
    assert.ok(content.includes("# Mardi 27 octobre 2026\n"));
    assert.ok(content.includes("# Date inconnue\n"));
    for (const text of ["## Utilisateur", "## Codex", "Écris un passage.\nÀ la première personne.", "Le passage final.", "Le texte raccourci.", "Autre tentative.", "Ancienne réponse."]) assert.ok(content.includes(text), text);
    for (const text of ["Je consulte", "Commande", "brouillon intermédiaire", "Ancien commentaire", "Texte interrompu"]) assert.equal(content.includes(text), false, text);
  });

  await check("Conversation : reprise sans doublon, plusieurs sessions, notes et originaux conservés", async () => {
    const project = join(directory, "conversation");
    const folders = { ...DEFAULT_PROJECT_FOLDERS, bibleFolder: "Univers", archiveFolder: "Versions" };
    const first = { id: "a", date: new Date(2026, 9, 26, 12), completed: true, messages: [
      { id: "user-a", role: "user", text: "Mon prompt", paths: [] }, { id: "answer-a", role: "assistant", text: "Ma réponse", phase: "final_answer", paths: [] },
    ] };
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      await saveConversation(project, folders, "session-a", []);
      const path = join(project, "Univers", "Suivi", "Conversation.md");
      await assert.rejects(access(path), { code: "ENOENT" });
      await saveConversation(project, folders, "session-a", [first]);
      const original = await readFile(path, "utf8");
      const time = (await stat(path)).mtimeMs;
      await saveConversation(project, folders, "session-a", [first]);
      assert.equal((await stat(path)).mtimeMs, time);
      const personal = "# Notes personnelles\nÀ conserver.\n";
      await writeFile(path, personal + original);
      const second = { ...first, id: "b", messages: [{ id: "user-b", role: "user", text: "La suite", paths: [] }] };
      await saveConversation(project, folders, "session-a", [first, second]);
      await saveConversation(project, folders, "session-b", [{ ...first, messages: [{ id: "user-c", role: "user", text: "Une autre session", paths: [] }] }]);
      const content = await readFile(path, "utf8");
      assert.ok(content.startsWith(personal));
      assert.equal(content.split("Mon prompt").length, 2);
      assert.ok(content.includes("La suite"));
      assert.ok(content.includes("Une autre session"));
      const archives = await readdir(join(project, "Versions", "Univers", "Suivi"));
      const copies = await Promise.all(archives.map(name => readFile(join(project, "Versions", "Univers", "Suivi", name), "utf8")));
      assert.ok(copies.includes(personal + original));
      await assert.rejects(archiveWithCorrections(project, folders, [{ path: "Univers/Suivi/Conversation.md", kind: { type: "update" } }], {}, () => {}), /relevés/);
      const damaged = original.replace(/<!-- orelius:conversation:[a-f0-9]+:end -->/, "");
      await writeFile(path, damaged);
      await assert.rejects(saveConversation(project, folders, "session-a", [first]), /marqueurs/);
      assert.equal(await readFile(path, "utf8"), damaged);
      await rm(path);
      await symlink(join(project, "Univers", "Style", "Narration.md"), path);
      await assert.rejects(saveConversation(project, folders, "session-a", [first]), /liens symboliques/);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Versions Codex : versions suivantes, majeures, préversions et format non reconnu", async () => {
    for (const version of ["0.163.0", "0.164.0", "0.200.1", "1.0.0", "2.1.3-beta.2+build.42"]) {
      assert.equal(codexVersion(`codex_cli_rs/${version} (macOS) orelius/0.1.0`), version);
    }
    for (const value of [undefined, null, 42, "Codex personnalisé"]) assert.equal(codexVersion(value), "non communiquée");
  });

  await check("Modèles : identifiants natifs, libellés et catalogue invalide", async () => {
    assert.deepEqual(modelOptions([{ model: "modele-a", displayName: "Modèle A", isDefault: true },
      { model: "modele-b", displayName: "Modèle B", isDefault: false }]), [
      { model: "modele-a", name: "Modèle A", isDefault: true }, { model: "modele-b", name: "Modèle B", isDefault: false },
    ]);
    for (const value of [null, {}, [null], [{ model: "", displayName: "A" }], [{ model: "a", displayName: 42 }]]) {
      assert.throws(() => modelOptions(value), /invalide/);
    }
  });

  await check("Contexte restant : dernier usage, bornes, compaction et mesure inconnue", async () => {
    const usage = { modelContextWindow: 100000, last: { totalTokens: 25000 }, total: { totalTokens: 9000000 } };
    assert.equal(contextRemaining(usage), 75);
    assert.equal(contextRemaining({ ...usage, last: { totalTokens: 100000 } }), 0);
    assert.equal(contextRemaining({ ...usage, last: { totalTokens: 200000 } }), 0);
    assert.equal(contextRemaining({ ...usage, last: { totalTokens: 0 } }), 100);
    assert.equal(contextRemaining({ ...usage, last: { totalTokens: 5000 } }), 95);
    assert.equal(contextRemaining({ modelContextWindow: 3, last: { totalTokens: 1 } }), 66);
    for (let used = 0; used <= 100; used++) assert.equal(contextRemaining({ modelContextWindow: 100, last: { totalTokens: used } }), 100 - used);
    for (const capacity of [null, undefined, "100", 0, -1, NaN, Infinity, 1.5, Number.MAX_VALUE]) {
      assert.equal(contextRemaining({ ...usage, modelContextWindow: capacity }), null);
    }
    for (const used of [null, undefined, "25", -1, NaN, Infinity, 1.5, Number.MAX_VALUE]) {
      assert.equal(contextRemaining({ ...usage, last: { totalTokens: used } }), null);
    }
    for (const value of [null, [], {}, { modelContextWindow: 1000, total: { totalTokens: 50 } }]) assert.equal(contextRemaining(value), null);
  });

  await check("Model : migration des réglages, structure, personnalisation et sources conservées", async () => {
    const legacy = loadSettings({ folder: "Roman", threadId: "session-A", threadCwd: "/vault/Roman" });
    assert.equal(legacy.modelFolder, "Model");
    assert.equal(legacy.threadId, "session-A");
    const customized = applySettings(legacy, { modelFolder: "Sources" });
    assert.equal(loadSettings(JSON.parse(JSON.stringify(customized))).modelFolder, "Sources");
    for (const name of ["archives", "Manuscript", "Bible", "_Archives", "AGENTS.md", "../Source", ""]) {
      assert.throws(() => applySettings(legacy, { modelFolder: name }));
    }
    const project = join(directory, "model-layout");
    await mkdir(join(project, "Model", "Chapitres"), { recursive: true });
    const source = join(project, "Model", "Chapitres", "original.md");
    await writeFile(source, "Version antérieure à adapter.");
    try {
      await prepareProject(project, legacy);
      await prepareProject(project, legacy);
      for (const child of ["Chapitres", "Personnages", "Plan", "Resume"]) {
        for (const prefix of ["Manuscript", "Model", "Archives/Model"]) {
          assert.equal((await stat(join(project, prefix, child))).isDirectory(), true);
        }
      }
      assert.equal(await readFile(source, "utf8"), "Version antérieure à adapter.");
      await prepareProject(project, customized);
      assert.equal((await stat(join(project, "Sources", "Chapitres"))).isDirectory(), true);
      assert.equal((await stat(join(project, "Archives", "Sources", "Resume"))).isDirectory(), true);
      assert.equal(await readFile(source, "utf8"), "Version antérieure à adapter.");
      const instructions = renderAgent(agentTemplate, customized);
      assert.ok(instructions.includes("`Sources/`"));
      assert.ok(instructions.includes("version antérieure"));
      assert.equal(instructions.includes("{modelFolder}"), false);
      await writeFile(join(project, "Source occupée"), "Source à préserver");
      await assert.rejects(prepareProject(project, applySettings(legacy, { modelFolder: "Source occupée" })), /Un fichier occupe/);
      assert.equal(await readFile(join(project, "Source occupée"), "utf8"), "Source à préserver");
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Conservation de la conversation enregistrée avec l’ancien format", async () => {
    const settings = loadSettings({ codexPath: "/bin/codex", folder: "Roman A",
      threadId: "session-A", threadCwd: "/vault/Roman A" });
    assert.deepEqual(settings.sessions["Roman A"], { threadId: "session-A", cwd: "/vault/Roman A" });
    assert.equal(settings.codexPath, "/bin/codex");
    assert.equal(loadSettings(JSON.parse(JSON.stringify(settings))).threadId, "session-A");
  });

  await check("Sessions distinctes pour A et B, retour dans A après relecture du fichier", async () => {
    const a = applySettings(loadSettings({ folder: "Roman A" }), { threadId: "session-A", threadCwd: "/vault/Roman A" });
    const b = applySettings(a, { folder: "Roman B" });
    assert.equal(b.threadId, "");
    assert.equal(b.threadCwd, "");
    const saved = applySettings(b, { threadId: "session-B", threadCwd: "/vault/Roman B" });
    const file = join(directory, "settings.json");
    try {
      await writeFile(file, JSON.stringify(saved));
      const restored = loadSettings(JSON.parse(await readFile(file, "utf8")));
      assert.equal(restored.threadId, "session-B");
      const returned = applySettings(restored, { folder: "Roman A" });
      assert.equal(returned.threadId, "session-A");
      assert.equal(returned.threadCwd, "/vault/Roman A");
      assert.equal(applySettings(returned, { folder: "Roman B" }).threadId, "session-B");
      assert.equal(a.folder, "Roman A");
      assert.equal(a.threadId, "session-A");
      assert.equal(Object.hasOwn(a.sessions, "Roman B"), false);
    } finally { await rm(file); }
  });

  await check("Nouvelle conversation limitée au dossier actif, y compris la racine", async () => {
    let settings = applySettings(loadSettings({ folder: "Roman A" }), { threadId: "session-A", threadCwd: "/vault/Roman A" });
    settings = applySettings(settings, { folder: "" });
    settings = applySettings(settings, { threadId: "session-racine", threadCwd: "/vault" });
    settings = applySettings(settings, { threadId: "", threadCwd: "" });
    settings = loadSettings(JSON.parse(JSON.stringify(settings)));
    assert.equal(settings.threadId, "");
    settings = applySettings(settings, { folder: "Roman A" });
    assert.equal(settings.threadId, "session-A");
    assert.equal(applySettings(settings, { folder: "" }).threadId, "");
  });

  await check("Validation des associations et noms de dossiers réservés en JavaScript", async () => {
    assert.throws(() => loadSettings({ sessions: [] }), /invalides/);
    assert.throws(() => loadSettings({ sessions: { Roman: { threadId: 42, cwd: "/vault" } } }), /invalide/);
    let settings = loadSettings(undefined);
    for (const folder of ["__proto__", "constructor"]) {
      settings = applySettings(settings, { folder });
      assert.equal(settings.threadId, "");
      settings = applySettings(settings, { threadId: `session-${folder}`, threadCwd: `/vault/${folder}` });
    }
    settings = loadSettings(JSON.parse(JSON.stringify(settings)));
    assert.equal(applySettings(settings, { folder: "__proto__" }).threadId, "session-__proto__");
    assert.equal(settings.threadId, "session-constructor");
    assert.equal(Object.getPrototypeOf(settings.sessions), Object.prototype);
  });

  await check("Clics sur dossier, sous-dossier et note : association la plus précise", async () => {
    let settings = loadSettings({ folder: "Roman A" });
    for (const path of ["Roman A", "Roman A/Chapitre", "Roman A/Chapitre/note.md"]) {
      assert.equal(associatedFolder(settings, path), "Roman A");
    }
    for (const path of ["Roman A2", "Roman A2/note.md", "Autre/note.md", ""]) {
      assert.equal(associatedFolder(settings, path), undefined);
    }
    settings = applySettings(settings, { threadId: "session-A", threadCwd: "/vault/Roman A" });
    settings = applySettings(settings, { folder: "Roman A/Partie" });
    settings = applySettings(settings, { threadId: "session-partie", threadCwd: "/vault/Roman A/Partie" });
    settings = applySettings(settings, { folder: "Roman B" });
    settings = loadSettings(JSON.parse(JSON.stringify(settings)));
    assert.equal(associatedFolder(settings, "Roman A/Partie/note.md"), "Roman A/Partie");
    assert.equal(associatedFolder(settings, "Roman A/Partie2/note.md"), "Roman A");
    const folder = associatedFolder(settings, "Roman A/Partie/note.md");
    assert.equal(applySettings(settings, { folder }).threadId, "session-partie");
    settings = applySettings(settings, { folder: "" });
    assert.equal(associatedFolder(settings, "Autre/note.md"), "");
    assert.equal(associatedFolder(settings, ""), "");
    assert.equal(associatedFolder(settings, "Roman A/note.md"), "Roman A");
    settings = applySettings(settings, { threadId: "session-racine", threadCwd: "/vault" });
    settings = applySettings(settings, { folder: "Roman B" });
    assert.equal(associatedFolder(settings, "Autre/note.md"), "");
  });

  await check("Navigation : dernier chemin prioritaire, ouverture périmée annulée et retour dans la même note", async () => {
    const navigation = new ChatNavigation("Autre/note.md");
    const visited = [];
    let release;
    let started;
    const waiting = new Promise(resolve => { release = resolve; });
    const entered = new Promise(resolve => { started = resolve; });
    const opening = navigation.run("Roman A", async current => {
      started();
      await waiting;
      if (current()) visited.push("Roman A");
    });
    await entered;
    const stale = navigation.run("Roman B", async () => { visited.push("Roman B"); });
    const leaving = navigation.run("Autre/note.md", async () => { visited.push("hors projet"); });
    assert.equal(navigation.path, "Autre/note.md");
    release();
    await Promise.all([opening, stale, leaving]);
    assert.deepEqual(visited, ["hors projet"]);
    await navigation.run("Roman A", async () => {});
    assert.notEqual(navigation.path, "Autre/note.md");
    await navigation.run("Autre/note.md", async () => { visited.push("même note hors projet"); });
    await assert.rejects(navigation.run("Roman A", async () => { throw new Error("Préparation impossible"); }), /Préparation impossible/);
    await navigation.run(null, async () => { visited.push("onglet vide"); });
    assert.equal(navigation.path, null);
    assert.deepEqual(visited, ["hors projet", "même note hors projet", "onglet vide"]);
  });

  await check("Barre droite : état initial conservé, restauré une fois et réappliqué après une ouverture annulée", async () => {
    const navigation = new ChatNavigation();
    assert.equal(navigation.restoreSidebar(), null);
    const collapsed = navigation.rememberSidebar(true);
    assert.equal(collapsed, true);
    assert.equal(navigation.rememberSidebar(false), true);
    assert.equal(navigation.restoreSidebar(), true);
    assert.equal(navigation.restoreSidebar(), null);
    assert.equal(navigation.restoreSidebar(collapsed), true);
    assert.equal(navigation.rememberSidebar(false), false);
    assert.equal(navigation.rememberSidebar(true), false);
    assert.equal(navigation.restoreSidebar(), false);
    assert.equal(navigation.restoreSidebar(), null);
  });

  await check("Chat masqué hors projet sans changer le dossier de la tâche en arrière-plan", async () => {
    const settings = loadSettings({ folder: "Roman A", sessions: {
      "Roman A": { threadId: "session-A", cwd: "/vault/Roman A" },
      "Roman A/Annexe": { threadId: "session-annexe", cwd: "/vault/Roman A/Annexe" },
      "Roman B": { threadId: "session-B", cwd: "/vault/Roman B" },
    } });
    for (const busy of [false, true]) {
      assert.equal(visibleFolder(settings, "Roman A/Chapitre/note.md", busy), "Roman A");
      assert.equal(visibleFolder(settings, "Roman A", busy), "Roman A");
      assert.equal(visibleFolder(settings, null, busy), undefined);
      for (const path of ["Autre/note.md", "Roman A2/note.md", ""]) {
        assert.equal(visibleFolder(settings, path, busy), undefined);
      }
    }
    assert.equal(visibleFolder(settings, "Roman B/note.md", true), undefined);
    assert.equal(visibleFolder(settings, "Roman A/Annexe/note.md", true), undefined);
    assert.equal(visibleFolder(settings, "Roman B/note.md", false), "Roman B");
    assert.equal(visibleFolder(settings, "Roman A/Annexe/note.md", false), "Roman A/Annexe");
    assert.equal(settings.folder, "Roman A");
    assert.equal(settings.threadId, "session-A");
    assert.equal(visibleFolder(loadSettings(undefined), "Note.md", true), "");
    assert.equal(visibleFolder(loadSettings(undefined), null, false), undefined);
  });

  await check("Noms de dossiers par défaut, personnalisation persistée et session conservée", async () => {
    const defaults = loadSettings({ folder: "Roman A", threadId: "session-A", threadCwd: "/vault/Roman A" });
    assert.equal(defaults.archiveFolder, "Archives");
    assert.equal(defaults.manuscriptFolder, "Manuscript");
    assert.equal(defaults.bibleFolder, "Bible");
    const settings = applySettings(defaults, { archiveFolder: "Versions", manuscriptFolder: "Mon manuscrit", bibleFolder: "Univers" });
    const path = join(directory, "folder-settings.json");
    try {
      await writeFile(path, JSON.stringify(settings));
      const restored = loadSettings(JSON.parse(await readFile(path, "utf8")));
      assert.equal(restored.archiveFolder, "Versions");
      assert.equal(restored.manuscriptFolder, "Mon manuscrit");
      assert.equal(restored.bibleFolder, "Univers");
      assert.equal(restored.threadId, "session-A");
      assert.equal(restored.threadCwd, "/vault/Roman A");
      assert.equal(defaults.archiveFolder, "Archives");
    } finally { await rm(path); }
  });

  await check("Noms invalides, chemins et collisions entre dossiers refusés", async () => {
    for (const name of ["", "..", "../Archives", "a/b", "a\\b", "/tmp", " Archives", "Archives ",
      ".obsidian", ".git", "a\u0000b", "a\nb", "a:b", "a."]) {
      assert.throws(() => applySettings(loadSettings(undefined), { archiveFolder: name }));
    }
    for (const changes of [{ manuscriptFolder: "archives" }, { archiveFolder: "bible" },
      { archiveFolder: "AGENTS.md" }, { bibleFolder: "agents.override.md" },
      { manuscriptFolder: "_Archives" }, { bibleFolder: "_ARCHIVES" },
      { manuscriptFolder: "Écrit", bibleFolder: "E\u0301crit" }]) {
      assert.throws(() => applySettings(loadSettings(undefined), changes));
    }
    assert.throws(() => loadSettings({ archiveFolder: 42 }));
    assert.equal(applySettings(loadSettings(undefined), { archiveFolder: "_Archives" }).archiveFolder, "_Archives");
  });

  await check("Structure Manuscript, Model et Bible, miroir dans Archives et préparation sans écrasement", async () => {
    const project = join(directory, "layout");
    await mkdir(join(project, "Manuscript", "Chapitres"), { recursive: true });
    await mkdir(join(project, "_Archives"));
    await writeFile(join(project, "Manuscript", "Chapitres", "existant.md"), "Manuscrit existant");
    await writeFile(join(project, "_Archives", "ancien.md"), "Ancienne archive");
    try {
      await prepareProject(project, DEFAULT_PROJECT_FOLDERS);
      await prepareProject(project, DEFAULT_PROJECT_FOLDERS);
      const expected = ["Archives", "Manuscript", "Model", "Bible"];
      for (const child of ["Chapitres", "Personnages", "Plan", "Resume"]) {
        expected.push(`Manuscript/${child}`, `Archives/Manuscript/${child}`);
        expected.push(`Model/${child}`, `Archives/Model/${child}`);
      }
      expected.push("Bible/Style", "Bible/Personnages", "Archives/Manuscript", "Archives/Model", "Archives/Bible", "Archives/Bible/Style", "Archives/Bible/Personnages");
      assert.deepEqual(projectPaths(DEFAULT_PROJECT_FOLDERS).sort(), expected.sort());
      for (const path of expected) assert.equal((await stat(join(project, path))).isDirectory(), true, path);
      assert.equal(await readFile(join(project, "Manuscript", "Chapitres", "existant.md"), "utf8"), "Manuscrit existant");
      assert.equal(await readFile(join(project, "_Archives", "ancien.md"), "utf8"), "Ancienne archive");
      const custom = { archiveFolder: "Versions", manuscriptFolder: "Manuscrit", modelFolder: "Sources", bibleFolder: "Univers" };
      await prepareProject(project, custom);
      for (const path of ["Manuscrit/Chapitres", "Manuscrit/Personnages", "Manuscrit/Plan", "Manuscrit/Resume",
        "Univers", "Univers/Style", "Univers/Personnages", "Versions/Manuscrit/Chapitres", "Versions/Univers", "Versions/Univers/Style", "Versions/Univers/Personnages", "Archives/Manuscript/Chapitres"]) {
        assert.equal((await stat(join(project, path))).isDirectory(), true, path);
      }
      for (const name of ["consignes.md", "exemple.md"]) {
        await writeFile(join(project, "Univers", "Style", name), `Texte personnel : ${name}`);
      }
      await prepareProject(project, custom);
      for (const name of ["consignes.md", "exemple.md"]) {
        assert.equal(await readFile(join(project, "Univers", "Style", name), "utf8"), `Texte personnel : ${name}`);
      }
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Bible : narration initialisée une fois, personnages et consignes personnelles conservés", async () => {
    const project = join(directory, "bible");
    const folders = { ...DEFAULT_PROJECT_FOLDERS, bibleFolder: "Univers", archiveFolder: "Versions" };
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      await prepareBible(project, folders);
      const path = join(project, "Univers", "Style", "Narration.md");
      const template = await readFile(path, "utf8");
      await assert.rejects(access(join(project, "Univers", "Narration.md")), { code: "ENOENT" });
      for (const text of ["Mode narratif", "Personne", "Point de vue", "Temps du récit", "Style narratif"]) assert.ok(template.includes(text), text);
      const time = (await stat(path)).mtimeMs;
      await prepareBible(project, folders);
      assert.equal((await stat(path)).mtimeMs, time);
      const personal = "\ufeff# Narration\r\n\r\nNarration à la première personne, au présent.\r\n";
      const character = "# Léa\nMédecin, tempérament réservé.\n";
      await writeFile(path, personal);
      await writeFile(join(project, "Univers", "Personnages", "Lea.md"), character);
      await prepareProject(project, folders);
      await prepareBible(project, folders);
      assert.equal(await readFile(path, "utf8"), personal);
      assert.equal(await readFile(join(project, "Univers", "Personnages", "Lea.md"), "utf8"), character);
      assert.deepEqual((await readdir(join(project, "Versions", "Univers"))).sort(), ["Personnages", "Style"]);
      const instructions = renderAgent(agentTemplate, loadSettings(folders));
      for (const text of ["`Univers/Style/Narration.md`", "`Univers/Personnages/`", "mode narratif", "fiches des personnages"]) assert.ok(instructions.includes(text), text);
      assert.equal(instructions.includes("`Univers/Narration.md`"), false);
      await rm(path);
      await symlink(join(project, "Univers", "Personnages", "Lea.md"), path);
      await assert.rejects(prepareBible(project, folders), /liens symboliques/);
      assert.equal(await readFile(join(project, "Univers", "Personnages", "Lea.md"), "utf8"), character);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Narration : ancien texte repris dans Style et version existante prioritaire", async () => {
    const project = join(directory, "narration-migration");
    const folders = { ...DEFAULT_PROJECT_FOLDERS, bibleFolder: "Univers" };
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      const previous = join(project, "Univers/Narration.md");
      const target = join(project, "Univers/Style/Narration.md");
      const original = "\ufeff# Narration personnelle\r\nAu présent, narration externe.\r\n";
      await writeFile(previous, original);
      await prepareBible(project, folders);
      assert.equal(await readFile(target, "utf8"), original);
      assert.equal(await readFile(previous, "utf8"), original);
      await writeFile(target, "Version de Style à conserver.");
      await prepareBible(project, folders);
      assert.equal(await readFile(target, "utf8"), "Version de Style à conserver.");
      assert.equal(await readFile(previous, "utf8"), original);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Préparation refusée si un fichier ou un lien occupe un dossier du projet", async () => {
    const project = join(directory, "layout-conflict");
    const outside = join(directory, "layout-outside");
    await mkdir(project);
    await mkdir(outside);
    try {
      await writeFile(join(project, "Manuscript"), "Fichier à préserver");
      await assert.rejects(prepareProject(project, DEFAULT_PROJECT_FOLDERS), /Un fichier occupe/);
      assert.equal(await readFile(join(project, "Manuscript"), "utf8"), "Fichier à préserver");
      await rm(join(project, "Manuscript"));
      await symlink(outside, join(project, "Manuscript"));
      await assert.rejects(prepareProject(project, DEFAULT_PROJECT_FOLDERS), /liens symboliques/);
      assert.deepEqual(await readdir(outside), []);
    } finally { await rm(project, { recursive: true }); await rm(outside, { recursive: true }); }
  });

  await check("Archive personnalisée : originaux du manuscrit et de la bible dans leurs chemins respectifs", async () => {
    const project = join(directory, "custom-archives");
    const folders = { archiveFolder: "Versions é", manuscriptFolder: "Roman", modelFolder: "Sources", bibleFolder: "Univers" };
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      await writeFile(join(project, "Roman", "Chapitres", "un.md"), "Chapitre original");
      await writeFile(join(project, "Univers", "monde.md"), "Bible originale");
      const changes = ["Roman/Chapitres/un.md", "Univers/monde.md"].map(path => ({ path, kind: { type: "update" } }));
      const copies = await archiveChanges(project, changes, undefined, folders.archiveFolder);
      assert.equal(copies.length, 2);
      assert.match(copies[0], /^Versions é\/Roman\/Chapitres\/un\..+\.md$/);
      assert.match(copies[1], /^Versions é\/Univers\/monde\..+\.md$/);
      assert.equal(await readFile(join(project, copies[0]), "utf8"), "Chapitre original");
      assert.equal(await readFile(join(project, copies[1]), "utf8"), "Bible originale");
      await assert.rejects(access(join(project, "Archives")), { code: "ENOENT" });
      await assert.rejects(archiveChanges(project, [{ path: copies[0], kind: { type: "update" } }], undefined, folders.archiveFolder), /Écriture refusée/);
      await assert.rejects(archiveChanges(project, [{ path: copies[0].replace("é", "e\u0301"), kind: { type: "update" } }], undefined, folders.archiveFolder), /Écriture refusée/);
      assert.equal(await readFile(join(project, copies[0]), "utf8"), "Chapitre original");
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Modèle d’agent : dossiers des réglages, rôle et variables contrôlées", async () => {
    const settings = loadSettings({ folder: "Mon roman", archiveFolder: "Versions", manuscriptFolder: "Texte", bibleFolder: "Univers" });
    const instructions = renderAgent(agentTemplate, settings);
    for (const text of ["Mon roman", "`Versions/`", "`Texte/`", "`Univers/`", "`Univers/Style/`", "textes exemples", "Avant d’écrire ou de réviser", "assistant d’écriture", "Personnages", "Resume"]) {
      assert.ok(instructions.includes(text), text);
    }
    assert.equal(instructions.includes("{archiveFolder}"), false);
    assert.equal(renderAgent("Projet {folder}", loadSettings(undefined)), "Projet .");
    assert.equal(renderAgent("{manuscriptFolder}", { ...settings, manuscriptFolder: "Texte $& {bibleFolder}" }), "Texte $& {bibleFolder}");
    for (const variable of ["inconnue", "constructor", "__proto__"]) {
      assert.throws(() => renderAgent(`{${variable}}`, settings), /Variable d’agent inconnue/);
    }
    assert.throws(() => renderAgent("", settings), /Modèle d’agent vide/);
    assert.throws(() => renderAgent("<!-- orelius:agent:end -->", settings), /marqueurs réservés/);
  });

  await check("AGENTS.md généré à la racine, complet et stable sans archive superflue", async () => {
    const project = join(directory, "agent-new");
    const settings = loadSettings({ folder: "Roman" });
    await mkdir(project);
    try {
      await prepareProject(project, settings);
      await generateAgent(project, settings, agentTemplate);
      const path = join(project, "AGENTS.md");
      const original = await readFile(path, "utf8");
      assert.ok(original.includes(renderAgent(agentTemplate, settings)));
      assert.equal(original.split("<!-- orelius:agent:start -->").length, 2);
      const before = await stat(path);
      await generateAgent(project, settings, agentTemplate);
      assert.equal(await readFile(path, "utf8"), original);
      assert.equal((await stat(path)).mtimeMs, before.mtimeMs);
      assert.equal((await stat(path)).nlink, 1);
      assert.deepEqual((await readdir(join(project, "Archives"), { recursive: true })).filter(path => path.endsWith(".md")), []);
      assert.equal((await readdir(project)).some(path => path.startsWith(".orelius-")), false);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("AGENTS.md personnel préservé et archivé ; seule la section Orelius est actualisée", async () => {
    const project = join(directory, "agent-existing");
    await mkdir(project);
    const path = join(project, "AGENTS.md");
    const personal = "\ufeff# Mes consignes\r\n\r\nRespecter la voix de l’auteur.";
    const tail = "\n# Autres consignes personnelles\r\nConserver cette partie.\r\n";
    const settings = loadSettings({ folder: "Roman" });
    try {
      await writeFile(path, personal, { mode: 0o640 });
      const mode = (await stat(path)).mode & 0o777;
      await generateAgent(project, settings, agentTemplate);
      const first = await readFile(path, "utf8");
      assert.ok(first.startsWith(personal));
      const [firstCopy] = await readdir(join(project, "Archives", "Agents"));
      assert.match(firstCopy, /^AGENTS\..+\.md$/);
      assert.equal(await readFile(join(project, "Archives", "Agents", firstCopy), "utf8"), personal);
      assert.deepEqual(await readdir(join(project, "Archives")), ["Agents"]);
      await writeFile(path, first + tail);
      const changed = applySettings(settings, { archiveFolder: "Versions", manuscriptFolder: "Texte", bibleFolder: "Univers" });
      await generateAgent(project, changed, agentTemplate);
      const updated = await readFile(path, "utf8");
      assert.ok(updated.startsWith(personal));
      assert.ok(updated.endsWith(tail));
      assert.ok(updated.includes("`Texte/`"));
      assert.ok(updated.includes("`Univers/`"));
      assert.ok(updated.includes("`Versions/`"));
      assert.equal(updated.includes("`Manuscript/`"), false);
      assert.equal(updated.split("<!-- orelius:agent:start -->").length, 2);
      assert.equal((await stat(path)).mode & 0o777, mode);
      const [secondCopy] = await readdir(join(project, "Versions", "Agents"));
      assert.equal(await readFile(join(project, "Versions", "Agents", secondCopy), "utf8"), first + tail);
      assert.equal(await readFile(join(project, "Archives", "Agents", firstCopy), "utf8"), personal);
      assert.deepEqual(await readdir(join(project, "Versions")), ["Agents"]);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Agent incomplet, lien, encodage invalide ou archive impossible : fichier préservé", async () => {
    const project = join(directory, "agent-invalid");
    await mkdir(project);
    const path = join(project, "AGENTS.md");
    const settings = loadSettings(undefined);
    try {
      for (const original of ["<!-- orelius:agent:start -->\nConsignes personnelles", "<!-- orelius:agent:end -->",
        "<!-- orelius:agent:end --><!-- orelius:agent:start -->",
        "<!-- orelius:agent:start --><!-- orelius:agent:start --><!-- orelius:agent:end -->"]) {
        await writeFile(path, original);
        await assert.rejects(generateAgent(project, settings, agentTemplate), /marqueurs Orelius/);
        assert.equal(await readFile(path, "utf8"), original);
      }
      const invalid = Buffer.from([0xff, 0xfe, 0x00]);
      await writeFile(path, invalid);
      await assert.rejects(generateAgent(project, settings, agentTemplate));
      assert.deepEqual(await readFile(path), invalid);
      await rm(path);
      const outside = join(directory, "agent-outside.md");
      await writeFile(outside, "Consignes extérieures");
      try {
        await symlink(outside, path);
        await assert.rejects(generateAgent(project, settings, agentTemplate));
        assert.equal(await readFile(outside, "utf8"), "Consignes extérieures");
        await rm(path);
        await link(outside, path);
        await assert.rejects(generateAgent(project, settings, agentTemplate), /sans lien/);
        assert.equal(await readFile(outside, "utf8"), "Consignes extérieures");
        await rm(path);
      } finally { await rm(outside); }
      await writeFile(path, "Consignes personnelles");
      await writeFile(join(project, "Archives"), "Un fichier occupe le dossier d’archives");
      await assert.rejects(generateAgent(project, settings, agentTemplate));
      assert.equal(await readFile(path, "utf8"), "Consignes personnelles");
      await rm(join(project, "Archives"));
      await mkdir(join(project, "Archives"));
      await writeFile(join(project, "Archives", "Agents"), "Un fichier occupe le dossier Agents");
      await assert.rejects(generateAgent(project, settings, agentTemplate));
      assert.equal(await readFile(path, "utf8"), "Consignes personnelles");
      assert.equal((await readdir(project)).some(path => path.startsWith(".orelius-")), false);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Corrections : coupes, réécritures, barrés et commentaires multilignes conservés", async () => {
    const report = correctionReport("Manuscript/Chapitres/Été.md", "Titre\nLa longue description.\nÀ supprimer.\nFin",
      "Titre\nUne phrase. ~~À supprimer.~~ (((Plus court.\nGarder la voix.)))\nFin");
    for (const text of ["La longue description.", "À supprimer.", "Une phrase.", "Plus court.", "Garder la voix.", "## Passages barrés"]) assert.ok(report.includes(text), text);
    assert.ok(report.split("## Commentaires destinés à Codex")[1].split("## Passages barrés")[0].includes("    Plus court.\n    Garder la voix."));
    assert.ok(report.split("## Passages barrés")[1].includes("    À supprimer."));
    assert.equal(report.includes("    Titre"), false);
    assert.equal(report.includes("    Fin"), false);
    assert.ok(correctionReport("vide.md", "Texte supprimé", "").includes("    (vide)"));
    assert.ok(correctionReport("ajout.md", "", "Nouveau texte").includes("    Nouveau texte"));
    assert.ok(correctionReport("note.md", "Texte", "Texte (((incomplet").includes("Aucun commentaire explicite."));
    const malicious = "```\n<!-- orelius:correction:injection -->\n((())) (((éè日本語)))";
    assert.ok(correctionReport("note.md", "", malicious).includes("    <!-- orelius:correction:injection -->"));
    for (const text of ["", "\0", "\r\n", "é".repeat(2048), "(((".repeat(2048), "~~".repeat(2048)]) {
      assert.equal(typeof correctionReport("note.md", "Avant", text), "string");
    }
  });

  await check("Suivi à la demande, références persistantes, relevés horodatés et archivage humain avant patch", async () => {
    const project = join(directory, "corrections");
    const path = "Manuscript/Chapitres/Été.md";
    const settings = loadSettings(undefined);
    await mkdir(project);
    try {
      await prepareProject(project, settings);
      await prepareCorrections(project, settings);
      await writeFile(join(project, path), "Titre\nUn long détour.\nUne fin.");
      const changes = [{ path, kind: { type: "update" } }];
      const captured = await captureCodexVersions(project, settings, changes);
      const restored = loadSettings(JSON.parse(JSON.stringify({ ...settings, codexVersions: { [project]: captured } })));
      const versions = restored.codexVersions[project];
      assert.equal(versions[path], "Titre\nUn long détour.\nUne fin.");
      await refreshCorrections(project, settings, versions);
      assert.deepEqual(await readdir(join(project, "Bible", "Suivi")), []);
      const human = "Titre\nUne phrase brève.\n~~Une fin.~~ (((Éviter les détours.)))";
      await writeFile(join(project, path), human);
      assert.deepEqual(await readdir(join(project, "Bible", "Suivi")), []);
      await refreshCorrections(project, settings, versions);
      const [reportName] = await readdir(join(project, "Bible", "Suivi"));
      assert.match(reportName, /^\d{4}-\d{2}-\d{2}T.+-[a-f0-9-]{36}\.md$/);
      const report = await readFile(join(project, "Bible", "Suivi", reportName), "utf8");
      assert.ok(report.includes("Un long détour."));
      assert.ok(report.includes("Une phrase brève."));
      assert.ok(report.includes("Éviter les détours."));
      assert.equal(await readFile(join(project, path), "utf8"), human);
      assert.deepEqual(await readdir(join(project, "Archives", "Manuscript", "Chapitres")), []);
      const index = await readFile(join(project, "Bible", "suivi.md"), "utf8");
      const indexTime = (await stat(join(project, "Bible", "suivi.md"))).mtimeMs;
      await refreshCorrections(project, settings, versions);
      assert.equal(await readFile(join(project, "Bible", "suivi.md"), "utf8"), index);
      assert.equal((await stat(join(project, "Bible", "suivi.md"))).mtimeMs, indexTime);
      assert.deepEqual(await readdir(join(project, "Bible", "Suivi")), [reportName]);
      const archives = await archiveWithCorrections(project, settings, changes, versions, () => {});
      assert.equal(archives.length, 1);
      assert.ok(archives[0].endsWith("-h.md"));
      assert.equal(await readFile(join(project, archives[0]), "utf8"), human);
      await writeFile(join(project, path), "Une nouvelle proposition Codex.");
      const next = await captureCodexVersions(project, settings, changes);
      const codexArchive = await archiveWithCorrections(project, settings, changes, next, () => {});
      assert.equal(codexArchive[0].endsWith("-h.md"), false);
      await writeFile(join(project, path), "Une autre correction. (((Continuer ainsi.)))");
      await refreshCorrections(project, settings, next);
      assert.equal((await readdir(join(project, "Bible", "Suivi"))).length, 2);
      assert.equal(await readFile(join(project, "Bible", "Suivi", reportName), "utf8"), report);
      await writeFile(join(project, path), "Correction intermédiaire.");
      await refreshCorrections(project, settings, next);
      await writeFile(join(project, path), "Une autre correction. (((Continuer ainsi.)))");
      await refreshCorrections(project, settings, next);
      assert.equal((await readdir(join(project, "Bible", "Suivi"))).length, 4);
      await writeFile(join(project, path), next[path]);
      await refreshCorrections(project, settings, next);
      const reports = await readdir(join(project, "Bible", "Suivi"));
      assert.equal(reports.length, 5);
      const contents = await Promise.all(reports.map(name => readFile(join(project, "Bible", "Suivi", name), "utf8")));
      assert.equal(contents.filter(text => text.includes("Retour à la version Codex")).length, 1);
      await refreshCorrections(project, settings, next);
      assert.equal((await readdir(join(project, "Bible", "Suivi"))).length, 5);
      assert.throws(() => loadSettings({ codexVersions: [] }), /références/);
      assert.throws(() => loadSettings({ codexVersions: { projet: { chapitre: 42 } } }), /références/);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Suivi : noms personnalisés, notes personnelles, projets isolés et absence de référence", async () => {
    const project = join(directory, "corrections-custom");
    const folders = { manuscriptFolder: "Texte", modelFolder: "Sources", bibleFolder: "Univers", archiveFolder: "Versions" };
    const path = "Texte/Chapitres/1.md";
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      await writeFile(join(project, "Univers", "suivi.md"), "# Notes personnelles\nÀ conserver.");
      await prepareCorrections(project, folders);
      await writeFile(join(project, path), "Texte corrigé (((Plus direct.)))");
      await refreshCorrections(project, folders, {});
      assert.deepEqual(await readdir(join(project, "Univers", "Suivi")), []);
      await refreshCorrections(project, folders, { "Ancien manuscrit/Chapitres/1.md": "Ancienne référence" });
      assert.deepEqual(await readdir(join(project, "Univers", "Suivi")), []);
      await refreshCorrections(project, folders, { [path]: "Texte Codex" });
      assert.ok((await readFile(join(project, "Univers", "suivi.md"), "utf8")).startsWith("# Notes personnelles\nÀ conserver."));
      assert.equal((await readdir(join(project, "Univers", "Suivi"))).length, 1);
      await assert.rejects(access(join(project, "Bible")), { code: "ENOENT" });
      await writeFile(join(project, path), "");
      await refreshCorrections(project, folders, { [path]: "Texte Codex" });
      assert.equal((await readdir(join(project, "Univers", "Suivi"))).length, 2);
      const restored = loadSettings(JSON.parse(JSON.stringify({ codexVersions: { A: { [path]: "A" }, B: { [path]: "B" } } })));
      assert.equal(restored.codexVersions.A[path], "A");
      assert.equal(restored.codexVersions.B[path], "B");
      const instructions = renderAgent(agentTemplate, loadSettings(folders));
      assert.ok(instructions.includes("Univers/suivi.md"));
      assert.ok(instructions.includes("Univers/Suivi/"));
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Suivi : liens, chemins sortants, index concurrent et échec d’archive préservent les textes", async () => {
    const project = join(directory, "corrections-invalid");
    const path = "Manuscript/Chapitres/1.md";
    const folders = DEFAULT_PROJECT_FOLDERS;
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      await writeFile(join(project, path), "Texte humain");
      await assert.rejects(refreshCorrections(project, folders, { "../externe.md": "Codex" }), /Chemin/);
      await assert.rejects(readProjectFile(project, "../externe.md"), /rester/);
      await assert.rejects(archiveWithCorrections(project, folders,
        [{ path: "Bible/suivi.md", kind: { type: "update" } }], {}, () => {}), /relevés/);
      await assert.rejects(archiveWithCorrections(project, folders,
        [{ path: "bible/SUIVI.MD", kind: { type: "update" } }], {}, () => {}), /relevés/);
      const indexPath = "Bible/suivi.md";
      const previous = await readProjectFile(project, indexPath);
      await writeFile(join(project, indexPath), "Note de l’auteur arrivée entre-temps.");
      await assert.rejects(writeProjectFile(project, indexPath, "À refuser", previous, "Archives"), /a changé/);
      assert.equal(await readFile(join(project, indexPath), "utf8"), "Note de l’auteur arrivée entre-temps.");
      await rm(join(project, "Bible", "Suivi"), { recursive: true });
      await symlink(join(project, "Archives"), join(project, "Bible", "Suivi"));
      await assert.rejects(refreshCorrections(project, folders, { [path]: "Codex" }), /symboliques/);
      await rm(join(project, "Bible", "Suivi"));
      await rm(join(project, "Archives"), { recursive: true });
      await writeFile(join(project, "Archives"), "Archive impossible");
      await assert.rejects(archiveWithCorrections(project, folders, [{ path, kind: { type: "update" } }], { [path]: "Codex" }, () => {}));
      assert.equal(await readFile(join(project, path), "utf8"), "Texte humain");
      assert.equal((await readdir(project, { recursive: true })).some(file => file.startsWith(".orelius-") || file.includes("/.orelius-")), false);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Archives exactes, arborescence et versions successives sans écrasement", async () => {
    const project = join(directory, "versions");
    await mkdir(join(project, "Chapitres"), { recursive: true });
    const path = join(project, "Chapitres", "Été.md");
    const original = Buffer.from("Texte original é\r\n\u0000", "utf8");
    const changes = [{ path, kind: { type: "update", move_path: null } }];
    try {
      await writeFile(path, original);
      const [first] = await archiveChanges(project, changes);
      assert.match(first, /^Archives\/Chapitres\/Été\..+\.md$/);
      assert.deepEqual(await readFile(join(project, first)), original);
      assert.deepEqual(await readFile(path), original);
      await writeFile(path, "Version suivante");
      const [second] = await archiveChanges(project, changes);
      assert.notEqual(first, second);
      assert.deepEqual(await readFile(join(project, first)), original);
      assert.equal(await readFile(join(project, second), "utf8"), "Version suivante");
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Création sans original, ajout sur fichier existant et fichier manquant", async () => {
    const project = join(directory, "creation");
    await mkdir(project);
    try {
      const path = join(project, "nouveau.md");
      const changes = [{ path, kind: { type: "add" } }];
      assert.deepEqual(await archiveChanges(project, changes), []);
      assert.deepEqual(await readdir(project), []);
      await writeFile(path, "Original à conserver même pour un ajout");
      const [archive] = await archiveChanges(project, changes);
      assert.equal(await readFile(join(project, archive), "utf8"), "Original à conserver même pour un ajout");
      await assert.rejects(archiveChanges(project, [{ path: "absent.md", kind: { type: "update" } }]), { code: "ENOENT" });
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Archivage refusé hors projet, dans les archives et sur les liens", async () => {
    const fixture = join(directory, "limits");
    const project = join(fixture, "Project");
    await mkdir(project, { recursive: true });
    await writeFile(join(fixture, "externe.md"), "Extérieur");
    await writeFile(join(project, "note.md"), "Intérieur");
    await mkdir(join(fixture, "Project2"));
    await writeFile(join(fixture, "Project2", "note.md"), "Projet voisin");
    for (const folder of ["Archives", "_Archives", ".git", ".obsidian"]) await mkdir(join(project, folder));
    await writeFile(join(project, "Archives", "note.md"), "Archive protégée");
    await writeFile(join(project, "_Archives", "note.md"), "Ancienne version protégée");
    await writeFile(join(project, ".git", "config"), "Configuration protégée");
    await writeFile(join(project, ".obsidian", "app.json"), "Réglages protégés");
    const update = path => [{ path, kind: { type: "update" } }];
    try {
      for (const changes of [undefined, [], [{ path: 42 }],
        ...["../externe.md", "../Project2/note.md", "Archives/note.md", "archives/note.md", "_Archives/note.md", "_archives/note.md", ".git/config", ".obsidian/app.json"].map(update),
        [{ path: "note.md", kind: { type: "delete" } }],
        [{ path: "note.md", kind: { type: "update", move_path: "autre.md" } }]]) {
        await assert.rejects(archiveChanges(project, changes, undefined, undefined, "", join(project, ".obsidian")));
      }
      await symlink(join(fixture, "externe.md"), join(project, "lien.md"));
      await assert.rejects(archiveChanges(project, update("lien.md")), /liens symboliques/);
      await symlink(fixture, join(project, "dossier-lien"));
      await assert.rejects(archiveChanges(project, update("dossier-lien/externe.md")), /liens symboliques/);
      await link(join(fixture, "externe.md"), join(project, "lien-dur.md"));
      await assert.rejects(archiveChanges(project, update("lien-dur.md")), /sans lien/);
      assert.equal(await readFile(join(project, "_Archives", "note.md"), "utf8"), "Ancienne version protégée");
      await rm(join(project, "Archives"), { recursive: true });
      await symlink(fixture, join(project, "Archives"));
      await assert.rejects(archiveChanges(project, update("note.md")), /liens symboliques/);
      assert.equal(await readFile(join(fixture, "externe.md"), "utf8"), "Extérieur");
      assert.equal(await readFile(join(project, "note.md"), "utf8"), "Intérieur");
    } finally { await rm(fixture, { recursive: true }); }
  });

  await check("Configuration Obsidian : dossier personnalisé protégé avant archivage, génération et écriture", async () => {
    for (const name of [".obsidian", "Réglages", "Config/Obsidian"]) {
      const project = await mkdtemp(join(directory, "configuration-"));
      try {
        const configDir = join(project, name);
        await mkdir(configDir, { recursive: true });
        const path = `${name}/settings.json`;
        await writeFile(join(project, path), "Réglages personnels");
        const previous = await readProjectFile(project, path);
        const update = [{ path, kind: { type: "update" } }];
        await assert.rejects(archiveChanges(project, update, undefined, "Archives", "", configDir), /configuration Obsidian/);
        await assert.rejects(archiveGenerated(project, path, "Interdit", "Archives", undefined, configDir), /configuration Obsidian/);
        await assert.rejects(writeProjectFile(project, path, "Interdit", previous, "Archives", undefined, undefined, true, undefined, configDir), /configuration Obsidian/);
        await assert.rejects(archiveChanges(project, [{ path: `${name.toUpperCase()}/nouveau.md`, kind: { type: "add" } }], undefined, "Archives", "", configDir), /configuration Obsidian/);
        assert.equal(await readFile(join(project, path), "utf8"), "Réglages personnels");
        await assert.rejects(access(join(project, "Archives")), { code: "ENOENT" });
        const allowed = `${name}-exemples/texte.md`;
        await writeProjectFile(project, allowed, "Autorisé", null, "Archives", undefined, undefined, true, undefined, configDir);
        assert.equal(await readFile(join(project, allowed), "utf8"), "Autorisé");
        const nested = join(project, "Roman");
        await mkdir(nested);
        await writeProjectFile(nested, "texte.md", "Roman", null, "Archives", undefined, undefined, true, undefined, configDir);
        assert.equal(await readFile(join(nested, "texte.md"), "utf8"), "Roman");
        await assert.rejects(prepareProject(project, DEFAULT_PROJECT_FOLDERS, join(project, "Archives")), /configuration Obsidian/);
        await assert.rejects(writeProjectFile(project, "nouveau.md", "Interdit", null, "Versions", undefined, undefined, true, undefined, join(project, "Versions")), /configuration Obsidian/);
        await assert.rejects(access(join(project, "nouveau.md")), { code: "ENOENT" });
      } finally { await rm(project, { recursive: true }); }
    }
  });

  await check("Échec d’archivage : original conservé", async () => {
    const project = join(directory, "archive-failure");
    await mkdir(project);
    try {
      const path = join(project, "note.md");
      await writeFile(path, "À préserver");
      await writeFile(join(project, "Archives"), "Un fichier occupe ce chemin");
      await assert.rejects(archiveChanges(project, [{ path, kind: { type: "update" } }]));
      assert.equal(await readFile(path, "utf8"), "À préserver");
      assert.equal(await readFile(join(project, "Archives"), "utf8"), "Un fichier occupe ce chemin");
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Modification dans l’éditeur ou pendant l’archivage : écriture refusée", async () => {
    const project = join(directory, "editor");
    await mkdir(project);
    try {
      const path = join(project, "note.md");
      const changes = [{ path, kind: { type: "update" } }];
      await writeFile(path, "Original");
      await assert.rejects(archiveChanges(project, changes, () => { throw new Error("Note modifiée dans l’éditeur"); }), /éditeur/);
      assert.equal(await readFile(path, "utf8"), "Original");
      assert.deepEqual(await readdir(project), ["note.md"]);
      await assert.rejects(archiveChanges(project, changes, () => { writeFileSync(path, "Modification par l’auteur"); }), /changé pendant l’archivage/);
      assert.equal(await readFile(path, "utf8"), "Modification par l’auteur");
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Écriture Orelius : archive exacte, version humaine, création, refus et interruption", async () => {
    const project = join(directory, "writer");
    const folders = DEFAULT_PROJECT_FOLDERS;
    const path = "Manuscript/Chapitres/texte.md";
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      await writeFile(join(project, path), "Version Codex.");
      const versions = await captureCodexVersions(project, folders, [{ path }]);
      await writeFile(join(project, path), "Version humaine.\n(((À raccourcir.)))\n");
      const original = await readProjectFile(project, path);
      const archive = (cwd, changes) => archiveWithCorrections(cwd, folders, changes, versions, () => {}, join(project, ".obsidian"));
      const copies = await writeProjectFile(project, path, "Version révisée.\n", original, folders.archiveFolder, archive);
      assert.equal(copies.length, 1);
      assert.match(copies[0], /^Archives\/Manuscript\/Chapitres\/texte\..+-h\.md$/);
      assert.equal(await readFile(join(project, copies[0]), "utf8"), original.text);
      assert.equal(await readFile(join(project, path), "utf8"), "Version révisée.\n");
      const current = await readProjectFile(project, path);
      assert.deepEqual(await writeProjectFile(project, path, current.text, current, folders.archiveFolder, archive), []);
      const created = "Manuscript/Chapitres/Partie/Été.md";
      assert.deepEqual(await writeProjectFile(project, created, "Été 🖋\n", null, folders.archiveFolder, archive), []);
      assert.equal(await readFile(join(project, created), "utf8"), "Été 🖋\n");
      for (const blocked of ["../outside.md", "Archives/no.md", "_Archives/no.md", ".obsidian/no.md", ".git/no.md", "Bible/suivi.md", "Bible/Suivi/Conversation.md"]) {
        await assert.rejects(writeProjectFile(project, blocked, "Interdit", null, folders.archiveFolder, archive));
        await assert.rejects(access(join(project, blocked)), { code: "ENOENT" });
      }
      await symlink(join(project, path), join(project, "lien.md"));
      await assert.rejects(writeProjectFile(project, "lien.md", "Interdit", current, folders.archiveFolder, archive), /symboliques/);
      await mkdir(join(project, "Manuscript/Chapitres/Bloqué"));
      await writeFile(join(project, "Manuscript/Chapitres/Bloqué/a.md"), "À conserver");
      await writeFile(join(project, "Archives/Manuscript/Chapitres/Bloqué"), "Obstacle");
      await assert.rejects(writeProjectFile(project, "Manuscript/Chapitres/Bloqué/a.md", "Interdit",
        await readProjectFile(project, "Manuscript/Chapitres/Bloqué/a.md"), folders.archiveFolder, archive));
      assert.equal(await readFile(join(project, "Manuscript/Chapitres/Bloqué/a.md"), "utf8"), "À conserver");
      let active = true;
      await assert.rejects(writeProjectFile(project, path, "Interdit", current, folders.archiveFolder,
        async (...args) => { const result = await archive(...args); active = false; return result; },
        () => { if (!active) throw new Error("Tâche interrompue"); }), /interrompue/);
      assert.equal(await readFile(join(project, path), "utf8"), current.text);
      await assert.rejects(writeProjectFile(project, path, "Interdit", current, folders.archiveFolder,
        async (...args) => { const result = await archive(...args); await writeFile(join(project, path), "Changement concurrent"); return result; }), /a changé/);
      assert.equal(await readFile(join(project, path), "utf8"), "Changement concurrent");
      assert.equal((await readdir(join(project, "Manuscript/Chapitres"))).some(name => name.endsWith(".tmp")), false);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Version générée : copie figée dès la création, diff humain et réécriture conservés", async () => {
    const project = join(directory, "generated-versions");
    const folders = { ...DEFAULT_PROJECT_FOLDERS, manuscriptFolder: "Texte", archiveFolder: "Versions" };
    const path = "Texte/Chapitres/Été.md";
    const generated = "\ufeff# Été\r\nTexte généré 🖋.\r\n";
    const human = "\ufeff# Été\r\nTexte réécrit. (((Plus direct.)))\r\n";
    const revised = "# Été\nVersion reprise.\n";
    const versions = {};
    const archive = (cwd, changes) => archiveWithCorrections(cwd, folders, changes, versions, () => {});
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      const [baseline] = await writeProjectFile(project, path, generated, null, folders.archiveFolder, archive, () => {}, true);
      assert.equal(typeof baseline, "string");
      assert.ok(baseline.startsWith("Versions/Texte/Chapitres/Été."));
      assert.equal(baseline.endsWith("-h.md"), false);
      assert.equal(await readFile(join(project, baseline), "utf8"), generated);
      Object.assign(versions, await captureCodexVersions(project, folders, [{ path }]));
      await writeFile(join(project, path), human);
      await refreshCorrections(project, folders, versions);
      const reports = await readdir(join(project, "Bible/Suivi"));
      assert.equal(reports.length, 1);
      const report = await readFile(join(project, "Bible/Suivi", reports[0]), "utf8");
      assert.ok(report.includes("Texte généré 🖋."));
      assert.ok(report.includes("Texte réécrit."));
      assert.equal(await readFile(join(project, baseline), "utf8"), generated);
      const copies = await writeProjectFile(project, path, revised, await readProjectFile(project, path), folders.archiveFolder, archive, () => {}, true);
      assert.equal(copies.length, 2);
      assert.ok(copies[0].endsWith("-h.md"));
      assert.equal(await readFile(join(project, copies[0]), "utf8"), human);
      assert.equal(copies[1].endsWith("-h.md"), false);
      assert.equal(await readFile(join(project, copies[1]), "utf8"), revised);
      assert.equal(await readFile(join(project, path), "utf8"), revised);
      assert.equal(await readFile(join(project, baseline), "utf8"), generated);
      const current = await readProjectFile(project, path);
      const [unchanged] = await writeProjectFile(project, path, revised, current, folders.archiveFolder, archive, () => {}, true);
      assert.equal(await readFile(join(project, unchanged), "utf8"), revised);
      assert.equal((await stat(join(project, path))).mtimeMs, current.stat.mtimeMs);
      let active = true;
      const interrupted = writeProjectFile(project, path, revised, current, folders.archiveFolder, archive,
        () => { if (!active) throw new Error("Tâche interrompue"); }, true);
      queueMicrotask(() => { active = false; });
      await assert.rejects(interrupted, /interrompue/);
      assert.equal(await readFile(join(project, path), "utf8"), revised);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("Version générée : une archive impossible empêche la publication du nouveau fichier", async () => {
    const project = join(directory, "generated-blocked");
    await mkdir(project);
    try {
      await writeFile(join(project, "Archives"), "Obstacle");
      await assert.rejects(writeProjectFile(project, "nouveau.md", "Version générée", null, "Archives", archiveChanges, () => {}, true));
      await assert.rejects(access(join(project, "nouveau.md")), { code: "ENOENT" });
      assert.equal(await readFile(join(project, "Archives"), "utf8"), "Obstacle");
      assert.equal((await readdir(project)).some(name => name.startsWith(".orelius-")), false);
    } finally { await rm(project, { recursive: true }); }
  });

  await check("MCP local : négociation, authentification, requêtes HTTP et arguments contrôlés", async () => {
    const writes = [];
    const server = new ProjectMcp(async (...args) => { writes.push(args); return "Écrit"; });
    const url = await server.start();
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${server.token}`, Accept: "application/json, text/event-stream" };
    const post = (body, extra = {}) => fetch(url, { method: "POST", headers: { ...headers, ...extra }, body: typeof body === "string" ? body : JSON.stringify({ jsonrpc: "2.0", ...body }) });
    try {
      assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
      assert.equal((await post({ id: 1, method: "initialize" }, { Authorization: "Bearer faux" })).status, 403);
      assert.equal((await post({ id: 1, method: "initialize" }, { Origin: "https://exemple.fr" })).status, 403);
      for (const version of ["2025-03-26", "2025-06-18", "2025-11-25"]) {
        const { result } = await (await post({ id: 1, method: "initialize", params: { protocolVersion: version } })).json();
        assert.equal(result.protocolVersion, version);
        assert.deepEqual(result.capabilities, { tools: {} });
      }
      const notification = await post({ method: "notifications/initialized" });
      assert.equal(notification.status, 202);
      assert.equal(await notification.text(), "");
      const listing = await (await post({ id: 2, method: "tools/list" })).json();
      assert.deepEqual(listing.result.tools.map(tool => tool.name), [FILE_TOOL]);
      for (const args of [{ chemin: "a.md" }, { chemin: "a.md", contenu: 4 }, { chemin: "a.md", contenu: "Texte", autre: true }]) {
        const { result } = await (await post({ id: 3, method: "tools/call", params: { name: FILE_TOOL, arguments: args } })).json();
        assert.equal(result.isError, true);
      }
      assert.equal(writes.length, 0);
      const { result } = await (await post({ id: 4, method: "tools/call", params: { name: FILE_TOOL, arguments: { chemin: "Été.md", contenu: "Texte 🖋" } } })).json();
      assert.equal(result.isError, false);
      assert.deepEqual(writes, [["Été.md", "Texte 🖋"]]);
      assert.equal((await (await post("{invalide")).json()).error.code, -32700);
      assert.equal((await (await post({ id: 5, method: "inconnue" })).json()).error.code, -32601);
      assert.equal((await fetch(url, { headers })).status, 405);
    } finally { await server.stop(); }
    await assert.rejects(fetch(url, { headers }));
  });

  await check("Événements fragmentés, Unicode et requêtes entrantes", async () => {
    const events = [];
    const requests = [];
    const rpc = client({ notification: (...event) => events.push(event), request: request => requests.push(request) });
    const input = `${JSON.stringify({ method: "orelius/check", params: { text: "Écrire 🖋" } })}\n`
      + `${JSON.stringify({ id: "question", method: "orelius/question", params: { text: "Continuer ?" } })}\n`;
    let position = 0;
    while (position < input.length) {
      const length = 1 + position % 7;
      rpc.receive(input.slice(position, position + length));
      position += length;
    }
    assert.deepEqual(events, [["orelius/check", { text: "Écrire 🖋" }]]);
    assert.deepEqual(requests, [{ id: "question", method: "orelius/question", params: { text: "Continuer ?" } }]);
  });

  await check("Réponses malformées et volumineuses refusées", async () => {
    for (const input of ["{invalide}\n", "x".repeat(16 * 1024 * 1024 + 1)]) {
      const errors = [];
      const rpc = client({ exit: message => errors.push(message) });
      rpc.receive(input);
      assert.equal(errors.length, 1);
      assert.match(errors[0], /invalide|volumineuse/);
    }
  });

  await check("Exécutable absent et chemin relatif signalés", async () => {
    await assert.rejects(findCodex("codex"), /absolu/);
    await assert.rejects(findCodex(join(directory, "absent")), /introuvable/);
    await assert.rejects(findCodex(directory), /introuvable/);
    await assert.rejects(client().connect(join(directory, "absent"), directory), /ENOENT/);
    await assert.rejects(client().request("orelius/check", {}), /pas connecté/);
  });

  await check("Recherche étendue d’un exécutable Codex", async () => {
    const executable = await findCodex("", true);
    assert.equal((await stat(executable)).isFile(), true);
    await access(executable);
  });

  const executable = await findCodex("");
  const rpc = client();
  await check("Connexion et authentification Codex local", async () => {
    const cliVersion = execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] });
    const expected = cliVersion.match(/^codex-cli (\S+)\s*$/)?.[1];
    assert.ok(expected, "La CLI doit annoncer sa version.");
    assert.equal(await rpc.connect(executable, directory), expected);
    await assert.rejects(rpc.request("orelius/unsupported", {}), error => {
      assert.ok(error.message.includes(`Codex ${expected}`));
      assert.ok(error.message.includes("orelius/unsupported"));
      assert.ok(error.message.includes("Mettez à jour"));
      return true;
    });
  });

  await check("Contexte éditorial : écriture bloquée avant consultation complète, actualisée dans la même session", async () => {
    const project = join(directory, "editorial-session");
    const folders = DEFAULT_PROJECT_FOLDERS;
    const path = "Manuscript/Chapitres/001.md";
    const next = "Manuscript/Chapitres/002.md";
    const baseline = "La voix de référence.\n";
    const versions = { [path]: baseline };
    const session = new ChatSession(() => {}, async () => {}, undefined, () => ({ ...folders, codexVersions: { [project]: versions } }));
    await mkdir(project);
    try {
      await prepareProject(project, folders);
      await prepareCorrections(project, folders);
      await writeFile(join(project, path), baseline + "(((Même voix au chapitre suivant.)))\n");
      await writeFile(join(project, "Bible/Style/Narration.md"), "Rythme nouchi.\n");
      await writeFile(join(project, "Bible/Suivi/Connaissances.md"), "Leçons issues de 001.\n".repeat(600));
      await session.connect(executable, project, "");
      const native = session.client.request.bind(session.client);
      const { thread } = await native("thread/start", { cwd: project, ephemeral: true,
        sandbox: "read-only", approvalPolicy: "never", approvalsReviewer: "user" });
      const threadId = thread.id;
      session.threadId = threadId;
      const prompts = [];
      // Only turn/start is simulated: MCP discovery/calls use the installed Codex, without model usage.
      session.client.request = (method, params) => {
        if (method !== "turn/start") return native(method, params);
        prompts.push(params.input);
        return Promise.resolve({ turn: { id: `tour-${prompts.length}` } });
      };
      const call = async (tool, args) => native("mcpServer/tool/call", { threadId, server: "orelius", tool, arguments: args });
      const write = () => call(FILE_TOOL, { chemin: next, contenu: "Chapitre suivant.\n" });
      await session.send("Écris le chapitre 002.", executable, project, threadId);
      for (const target of [next, "manuscript/chapitres/002.MD"]) {
        const denied = await call(FILE_TOOL, { chemin: target, contenu: "Interdit.\n" });
        assert.equal(denied.isError, true);
        assert.match(denied.content[0].text, /consulter_contexte_editorial/);
      }
      await assert.rejects(access(join(project, next)), { code: "ENOENT" });
      for (const page of [-1, 0.5, null, "0"]) assert.equal((await call(CONTEXT_TOOL, { page })).isError, true);
      let result = await call(CONTEXT_TOOL, {});
      assert.equal(result.isError, false);
      const first = JSON.parse(result.content[0].text);
      assert.ok(first.pages > 1);
      await call(CONTEXT_TOOL, { page: 0 });
      assert.equal((await write()).isError, true, "Relire une page ne remplace pas les pages manquantes.");
      assert.equal((await call(CONTEXT_TOOL, { page: first.pages })).isError, true);
      const read = [result.content[0].text];
      for (const response of await Promise.all(Array.from({ length: first.pages - 1 }, (_, index) => call(CONTEXT_TOOL, { page: index + 1 })))) {
        assert.equal(response.isError, false);
        read.push(response.content[0].text);
      }
      assert.ok(read.join("").includes("Même voix au chapitre suivant."));
      assert.ok(read.join("").includes("Leçons issues de 001."));
      assert.equal((await write()).isError, false);
      assert.equal(await readFile(join(project, next), "utf8"), "Chapitre suivant.\n");
      const copies = await readdir(join(project, "Archives/Manuscript/Chapitres"));
      assert.ok(copies.length > 0, "La consultation ne contourne pas l’archivage du texte généré.");
      // Simulate the end of the external turn, keeping this same connection open.
      session.busy = false;
      session.turnId = "";
      await writeFile(join(project, "Bible/Style/Narration.md"), "Nouvelle consigne narrative.\n");
      await writeFile(join(project, path), baseline + "(((Cette transition est absurde.)))\n");
      await session.send("Reprends avec mes nouvelles remarques.", executable, project, threadId);
      assert.equal(session.threadId, threadId);
      assert.equal((await write()).isError, true, "La consultation du tour précédent ne suffit pas.");
      const updated = [];
      for (let page = 0, pages = 1; page < pages; page++) {
        const response = await call(CONTEXT_TOOL, { page });
        assert.equal(response.isError, false);
        const content = JSON.parse(response.content[0].text);
        pages = content.pages;
        updated.push(...content.sources);
      }
      assert.ok(updated.some(source => source.content.includes("Nouvelle consigne narrative.")));
      assert.ok(updated.some(source => source.content.includes("Cette transition est absurde.")));
      assert.equal(updated.some(source => source.content.includes("Même voix au chapitre suivant.")), false);
      assert.equal((await write()).isError, false);
      assert.deepEqual(prompts, ["Écris le chapitre 002.", "Reprends avec mes nouvelles remarques."].map(text => [{ type: "text", text, text_elements: [] }]));
      assert.equal(await readFile(join(project, path), "utf8"), baseline + "(((Cette transition est absurde.)))\n");
    } finally { await session.disconnect(); await rm(project, { recursive: true }); }
  });

  await check("Catalogue Codex réel et changement de modèle sur la même session temporaire", async () => {
    const options = [];
    let cursor = null;
    do {
      const page = await rpc.request("model/list", { limit: 2, includeHidden: false, cursor });
      options.push(...modelOptions(page.data));
      cursor = page.nextCursor ?? null;
    } while (cursor);
    assert.ok(options.length > 0);
    const first = options[0].model;
    const selected = options.find(option => option.model !== first)?.model ?? first;
    const creator = client();
    let resumedId;
    const resumer = new ChatSession(() => {}, async id => { resumedId = id; });
    await creator.connect(executable, directory);
    const original = await creator.request("thread/start", { cwd: directory, ephemeral: false, model: first,
      sandbox: "read-only", approvalPolicy: "on-request", approvalsReviewer: "user" });
    try {
      await creator.request("thread/inject_items", { threadId: original.thread.id,
        items: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Orelius model selection self-check." }] }] });
      await creator.stop();
      await resumer.connect(executable, directory, original.thread.id);
      const inventory = await resumer.client.request("mcpServerStatus/list", { threadId: original.thread.id, limit: 100 });
      const orelius = inventory.data.find(server => server.name === "orelius");
      assert.ok(orelius, "L’outil Orelius doit être chargé à la reprise d’une ancienne session.");
      assert.ok(Object.values(orelius.tools).some(tool => tool.name === FILE_TOOL));
      const history = [...resumer.items];
      assert.equal(resumer.model, first);
      await resumer.connect(executable, directory, original.thread.id, selected);
      assert.equal(original.model, first);
      assert.equal(resumer.model, selected);
      assert.equal(resumer.threadId, original.thread.id);
      assert.equal(resumedId, original.thread.id);
      assert.deepEqual(resumer.items, history);
      const { thread } = await rpc.request("thread/read", { threadId: original.thread.id });
      assert.equal(thread.ephemeral, false);
      assert.ok((await readFile(thread.path, "utf8")).includes("Orelius model selection self-check."));
      const denied = await resumer.client.request("mcpServer/tool/call", { threadId: original.thread.id,
        server: "orelius", tool: FILE_TOOL, arguments: { chemin: "hors-tache.md", contenu: "Interdit" } });
      assert.equal(denied.isError, true);
      await assert.rejects(access(join(directory, "hors-tache.md")), { code: "ENOENT" });
      assert.equal((await readFile(thread.path, "utf8")).includes(resumer.files.token), false);
    } finally {
      await creator.stop();
      await resumer.disconnect();
      await rpc.request("thread/delete", { threadId: original.thread.id });
    }
  });

  await check("Outils externes et délégation désactivés pour préserver le passage par l’archivage", async () => {
    const { config } = await rpc.request("config/read", { cwd: directory, includeLayers: false });
    const features = object(object(config).features);
    for (const feature of ["apps", "plugins", "multi_agent", "multi_agent_v2"]) assert.equal(features[feature], false);
    const { thread } = await rpc.request("thread/start", { cwd: directory, ephemeral: true,
      sandbox: "read-only", approvalPolicy: "on-request", approvalsReviewer: "user" });
    const inventory = await rpc.request("mcpServerStatus/list", { threadId: thread.id, limit: 100 });
    assert.equal(Array.isArray(inventory.data), true);
    for (const server of inventory.data) {
      assert.equal(server.runtimeStatus, "disabled", `Serveur ${server.name} : ${server.runtimeStatus}`);
      assert.equal(Object.keys(server.tools).length, 0);
    }
    assert.equal(inventory.nextCursor ?? null, null);
  });

  await check("Codex réel : appel MCP, archivage puis écriture sans requête au modèle", async () => {
    const project = join(directory, "native-mcp");
    await mkdir(project);
    const server = new ProjectMcp(async (path, content) => {
      const previous = await readProjectFile(project, path);
      const archives = await writeProjectFile(project, path, content, previous, "Archives");
      return JSON.stringify({ fichier: path, archives });
    });
    const native = client();
    try {
      await writeFile(join(project, "texte.md"), "Original 🖋\n");
      const url = await server.start();
      await native.connect(executable, project, { url, token: server.token });
      const { thread } = await native.request("thread/start", { cwd: project, ephemeral: true, sandbox: "read-only", approvalPolicy: "never" });
      const result = await native.request("mcpServer/tool/call", { threadId: thread.id, server: "orelius", tool: FILE_TOOL,
        arguments: { chemin: "texte.md", contenu: "Révision.\n" } });
      assert.equal(result.isError, false);
      const written = JSON.parse(result.content.find(item => item.type === "text").text);
      assert.equal(written.archives.length, 1);
      assert.equal(await readFile(join(project, written.archives[0]), "utf8"), "Original 🖋\n");
      assert.equal(await readFile(join(project, "texte.md"), "utf8"), "Révision.\n");
      const inventory = await native.request("mcpServerStatus/list", { threadId: thread.id, limit: 100 });
      for (const external of inventory.data.filter(item => item.name !== "orelius")) assert.equal(external.runtimeStatus, "disabled");
    } finally { await native.stop(); await server.stop(); await rm(project, { recursive: true }); }
  });

  await check("Répertoire effectif et refus des écritures", async () => {
    const cwd = await realpath(directory);
    const sandboxPolicy = { type: "readOnly", networkAccess: false };
    const result = await rpc.request("command/exec", { command: ["/bin/pwd"], cwd, sandboxPolicy });
    assert.equal(result.exitCode, 0);
    assert.equal(String(result.stdout).trim(), cwd);
    const target = join(cwd, "must-not-exist");
    const write = await rpc.request("command/exec", { command: ["/usr/bin/touch", target], cwd, sandboxPolicy });
    assert.notEqual(write.exitCode, 0);
    await assert.rejects(access(target), { code: "ENOENT" });
  });

  let remembered;
  const session = new ChatSession(() => {}, async (threadId, cwd) => { remembered = { threadId, cwd }; });
  try {
    await check("Connexion sans enregistrer de conversation vide", async () => {
      await session.connect(executable, directory, "");
      assert.equal(session.connected, true);
      assert.equal(session.busy, false);
      assert.equal(remembered, undefined);
      assert.equal(session.threadId, "");
      assert.deepEqual(session.items, []);
      assert.ok(session.models.length > 0);
      assert.ok(session.model);
      assert.equal(session.contextRemaining, null);
      await assert.rejects(session.steer("Consigne sans tâche active"), /Aucune tâche active/);
      assert.equal(session.connected, true);
    });
    await check("Choix du modèle avant le premier message, sans conversation vide", async () => {
      const selected = session.models.find(option => option.model !== session.model)?.model ?? session.models[0].model;
      await session.connect(executable, directory, "", selected);
      assert.equal(session.model, selected);
      assert.equal(session.connected, true);
      assert.equal(session.threadId, "");
      assert.equal(remembered, undefined);
      assert.equal(session.contextRemaining, null);
      await assert.rejects(session.connect(executable, directory, "", "modele-non-propose"), /proposé/);
      assert.equal(session.connected, true);
      assert.equal(session.model, selected);
    });
    await check("Nouvelle conversation et annulation pendant la connexion", async () => {
      await session.newConversation();
      assert.deepEqual(remembered, { threadId: "", cwd: "" });
      assert.equal(session.connected, false);
      const connecting = session.connect(executable, directory, "");
      session.disconnect();
      await assert.rejects(connecting, /interrompue/);
      assert.equal(session.connected, false);
      assert.equal(session.busy, false);
    });
  } finally { session.disconnect(); }

  await check("Arrêt du processus appartenant au plugin", async () => {
    const pid = rpc.child.pid;
    rpc.stop();
    const deadline = Date.now() + 4000;
    let running = true;
    while (running && Date.now() < deadline) {
      try { process.kill(pid, 0); await wait(50); }
      catch (error) {
        if (error.code !== "ESRCH") throw error;
        running = false;
      }
    }
    assert.equal(running, false);
  });
  assert.deepEqual(await readdir(directory), []);
  console.log(`${passed} contrôles réussis.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const rpc of clients) rpc.stop();
  await rm(directory, { recursive: true });
}
