import assert from "node:assert/strict";
import { mkdtemp, access, readFile, realpath, readdir, rm, stat, writeFile, mkdir, symlink, link } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { CodexClient, findCodex, object } from "../plugin/src/codex.ts";
import { ChatSession } from "../plugin/src/session.ts";
import { applySettings, associatedFolder, DEFAULT_PROJECT_FOLDERS, loadSettings, projectPaths, visibleFolder } from "../plugin/src/settings.ts";
import { archiveChanges, prepareProject } from "../plugin/src/archives.ts";
import { generateAgent, renderAgent } from "../generate-agent.ts";

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

  await check("Chat masqué hors projet sans changer le dossier de la tâche en arrière-plan", async () => {
    const settings = loadSettings({ folder: "Roman A", sessions: {
      "Roman A": { threadId: "session-A", cwd: "/vault/Roman A" },
      "Roman A/Annexe": { threadId: "session-annexe", cwd: "/vault/Roman A/Annexe" },
      "Roman B": { threadId: "session-B", cwd: "/vault/Roman B" },
    } });
    for (const busy of [false, true]) {
      assert.equal(visibleFolder(settings, "Roman A/Chapitre/note.md", busy), "Roman A");
      assert.equal(visibleFolder(settings, "Roman A", busy), "Roman A");
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

  await check("Structure Manuscript et Bible, miroir dans Archives et préparation sans écrasement", async () => {
    const project = join(directory, "layout");
    await mkdir(join(project, "Manuscript", "Chapitres"), { recursive: true });
    await mkdir(join(project, "_Archives"));
    await writeFile(join(project, "Manuscript", "Chapitres", "existant.md"), "Manuscrit existant");
    await writeFile(join(project, "_Archives", "ancien.md"), "Ancienne archive");
    try {
      await prepareProject(project, DEFAULT_PROJECT_FOLDERS);
      await prepareProject(project, DEFAULT_PROJECT_FOLDERS);
      const expected = ["Archives", "Manuscript", "Bible"];
      for (const child of ["Chapitres", "Personnages", "Plan", "Resume"]) {
        expected.push(`Manuscript/${child}`, `Archives/Manuscript/${child}`);
      }
      expected.push("Archives/Manuscript", "Archives/Bible");
      assert.deepEqual(projectPaths(DEFAULT_PROJECT_FOLDERS).sort(), expected.sort());
      for (const path of expected) assert.equal((await stat(join(project, path))).isDirectory(), true, path);
      assert.equal(await readFile(join(project, "Manuscript", "Chapitres", "existant.md"), "utf8"), "Manuscrit existant");
      assert.equal(await readFile(join(project, "_Archives", "ancien.md"), "utf8"), "Ancienne archive");
      const custom = { archiveFolder: "Versions", manuscriptFolder: "Manuscrit", bibleFolder: "Univers" };
      await prepareProject(project, custom);
      for (const path of ["Manuscrit/Chapitres", "Manuscrit/Personnages", "Manuscrit/Plan", "Manuscrit/Resume",
        "Univers", "Versions/Manuscrit/Chapitres", "Versions/Univers", "Archives/Manuscript/Chapitres"]) {
        assert.equal((await stat(join(project, path))).isDirectory(), true, path);
      }
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
    const folders = { archiveFolder: "Versions é", manuscriptFolder: "Roman", bibleFolder: "Univers" };
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
    for (const text of ["Mon roman", "`Versions/`", "`Texte/`", "`Univers/`", "assistant d’écriture", "Personnages", "Resume"]) {
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
      assert.equal((await readdir(project)).some(path => path.startsWith(".orelius-agent-")), false);
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
      const [firstCopy] = await readdir(join(project, "Archives"));
      assert.match(firstCopy, /^AGENTS\..+\.md$/);
      assert.equal(await readFile(join(project, "Archives", firstCopy), "utf8"), personal);
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
      const [secondCopy] = await readdir(join(project, "Versions"));
      assert.equal(await readFile(join(project, "Versions", secondCopy), "utf8"), first + tail);
      assert.equal(await readFile(join(project, "Archives", firstCopy), "utf8"), personal);
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
      assert.equal((await readdir(project)).some(path => path.startsWith(".orelius-agent-")), false);
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
        await assert.rejects(archiveChanges(project, changes));
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
    assert.match(await rpc.connect(executable, directory), /^0\.163\./);
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
