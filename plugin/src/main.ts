import { ContextModal, type ContextNote } from "./context-modal";
import { withContext, validateContextChoice, SOURCE_REASONS, type ContextChoice } from "./request-context";
import { buildSceneContext } from "./scene-context";
import { readEditorialContext } from "./editorial-context";
import { projectSources } from "./project-sources";
import { configPath, parseConfig, readData } from "./narrative-context";
import { NovelView, NOVEL_VIEW } from "./novel-view";
import { structurePath, type StructureEdit } from "./story-structure";
import { randomUUID } from "node:crypto";
import { recordFeedback } from "./feedback";
import { diffToGroups } from "./diff";
import { ComparisonModal } from "./comparison-modal";
import { comparisonVersions, applyComparison } from "./comparison";
import { SELECTION_ACTIONS, selectionRequest, selectionPlan, selectionPrompt, type SelectionAction, type SelectionRequest } from "./selection-actions";
import { SelectionModal } from "./selection-modal";
import { syncStructure, type StoryStructure, type Decision } from "./story-structure";
import { POPULATE_PREFIX, collectChanges } from "./workshop";
import populateTemplate from "../../prompts/peupler.md";
import { maintenancePrompt, pendingStates } from "./editorial-workflow";
import { addIcon, type Editor, editorInfoField, FileSystemAdapter, FileView, MarkdownView, Notice, Plugin, TFile, TFolder } from "obsidian";
import oreliusIcon from "../icon.svg";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { CodexClient, errorText, findCodex } from "./codex";
import { ChatSession } from "./session";
import { prepareProject } from "./archives";
import { prepareBible } from "./bible";
import { saveConversation } from "./conversation";
import { archiveWithCorrections, captureCodexVersions, chapterPath, prepareCorrections, refreshCorrections, revisionPrompt, revisionProtections } from "./corrections";
import { applySettings, loadSettings, PROJECT_FOLDER_KEYS, visibleFolder, type ProjectFolders, type SettingsChanges } from "./settings";
import { OreliusSettingTab } from "./settings-tab";
import { OreliusView, VIEW_TYPE } from "./chat-view";
import { ChatNavigation } from "./navigation";
import { generateAgent, renderAgent } from "./generate-agent.ts";
import agentTemplate from "../../prompts/agent.md";
import prepareScenePrompt from "../../prompts/preparer-scene.md";
import writePrompt from "../../prompts/rediger.md";
import revisePrompt from "../../prompts/reviser.md";
import publicationPrompt from "../../prompts/controler-publication.md";
import continuityPrompt from "../../prompts/controler-continuite.md";
import followupPrompt from "../../prompts/actualiser-suivi.md";
import task0 from "../../prompts/idees.md";
import task1 from "../../prompts/synopsis.md";
import task2 from "../../prompts/planifier.md";
import task3 from "../../prompts/decomposer-scene.md";
import task4 from "../../prompts/resumer.md";
import task5 from "../../prompts/developper.md";
import task6 from "../../prompts/reformuler.md";
import task7 from "../../prompts/condenser.md";
import task8 from "../../prompts/critiquer.md";
import task9 from "../../prompts/extraire-style.md";
import task10 from "../../prompts/adapter.md";
import task11 from "../../prompts/actualiser-bible.md";
import task12 from "../../prompts/decrire.md";
import task13 from "../../prompts/continuer.md";

import { readProjectFile } from "./project-files.ts";
import { fullRewriteRequested, planRevision } from "./revision.ts";
import { revisionHighlights } from "./revision-highlights";
import { editorLock } from "./editor-lock";
import { recordAcceptance } from "./acceptance";
import { reactionExchanges, reactionKey, recordReaction, type Reaction } from "./reactions";

const taskPrompts = { "preparer-scene": prepareScenePrompt, rediger: writePrompt, reviser: revisePrompt,
  "controler-continuite": continuityPrompt, "controler-publication": publicationPrompt, "actualiser-suivi": followupPrompt, "idees": task0, "synopsis": task1, "planifier": task2, "decomposer-scene": task3, "resumer": task4, "developper": task5, "reformuler": task6, "condenser": task7, "critiquer": task8, "extraire-style": task9, "adapter": task10, "actualiser-bible": task11, "decrire": task12, "continuer": task13 };

export default class OreliusPlugin extends Plugin {
  settings = loadSettings(undefined);
  private structure: StoryStructure | null = null;
  session!: ChatSession;
  draft = "";
  private requestContext: { folder: string; choice: ContextChoice } | null = null;
  private views = new Set<OreliusView>();
  private settingsWrite = Promise.resolve();
  private projectWrite = Promise.resolve();
  private correctionWrite = Promise.resolve();
  private navigation = new ChatNavigation();
  private connecting: Promise<void> | null = null;
  private sending = false;
  private hidingChat = false;
  private unloaded = false;
  private codexTest: CodexClient | null = null;
  private highlights = revisionHighlights(() => this.settings.revisionHighlights);
  private lockedNotes = new Set<string>();

  async onload(): Promise<void> {
    addIcon("orelius", oreliusIcon);
    this.settings = loadSettings(await this.loadData());
    this.registerEditorExtension(this.highlights.extension);
    this.registerEditorExtension(editorLock(state => state.field(editorInfoField, false)?.file?.path,
      path => this.lockedNotes.has(path.normalize("NFC").toLowerCase())));
    this.session = new ChatSession(() => {
      this.releaseNoteLocks();
      for (const view of this.views) view.update();
    }, (threadId, cwd) => this.saveSettings({ threadId, threadCwd: cwd }),
    (cwd, changes) => archiveWithCorrections(cwd, this.settings, changes, this.settings.codexVersions[cwd] ?? {},
      (path, content) => this.checkEditor(path, content), this.configurationDirectory()),
    () => ({ ...this.settings, agentInstructions: renderAgent(agentTemplate, this.settings),
      activeChapter: this.revisionChapter, taskPrompts,
      configDir: this.configurationDirectory(),
      checkEditor: (path, content) => this.checkEditor(path, content), lockNote: path => this.lockNote(path) }),
    async (cwd, changes, highlight) => {
      const folders = this.settings;
      const versions = await captureCodexVersions(cwd, folders, changes);
      if (Object.keys(versions).length) {
        const revisionHighlights = { ...this.settings.revisionHighlights };
        for (const path of Object.keys(versions)) {
          const key = `${folders.folder ? `${folders.folder}/` : ""}${path}`;
          delete revisionHighlights[key];
          if (highlight) revisionHighlights[key] = highlight;
        }
        await this.saveSettings({ codexVersions: { ...this.settings.codexVersions,
          [cwd]: { ...this.settings.codexVersions[cwd], ...versions } }, revisionHighlights });
      }
    }, (cwd, threadId, turns) => {
      const folders = this.settings;
      return this.correctionTask(async () => {
        const path = `${folders.folder ? `${folders.folder}/` : ""}${folders.bibleFolder}/Suivi/Conversation.md`;
        this.app.workspace.iterateAllLeaves(leaf => {
          const view = leaf.view;
          if (view instanceof MarkdownView && view.file?.path === path && view.getViewData() !== view.data) {
            throw new Error("Le journal de conversation a des modifications dans l’éditeur. Attendez leur enregistrement avant de reprendre la conversation.");
          }
        });
        await saveConversation(cwd, folders, threadId, turns);
      });
    });
    this.registerView(NOVEL_VIEW, leaf => new NovelView(leaf, this));
    this.addCommand({ id: "novel-outline", name: "Vue d’ensemble du roman", callback: () => { void this.openNovel().catch(error => new Notice(errorText(error))); } });
    this.registerView(VIEW_TYPE, leaf => new OreliusView(leaf, this));
    this.addSettingTab(new OreliusSettingTab(this));
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, info) => {
      const prefix = this.settings.folder ? `${this.settings.folder}/` : "";
      const chapter = info.file?.path.startsWith(prefix) ? chapterPath("/", this.settings, info.file.path.slice(prefix.length)) : null;
      if (chapter) menu.addItem(item => item.setSection("orelius").setTitle("Orelius : Comparer les versions").setIcon("columns-2")
        .onClick(() => { void this.compareVersions(chapter).catch(error => new Notice(errorText(error))); }));
      const selection = this.captureSelection(editor, info.file?.path);
      if (!selection) return;
      for (const action of SELECTION_ACTIONS) menu.addItem(item => item.setSection("orelius").setTitle(`Orelius : ${action.label}`).setIcon("pencil")
        .setDisabled(this.session.busy || this.sending || Boolean(this.connecting)).onClick(() => this.openSelectionAction(action.id, selection)));
    }));
    for (const action of SELECTION_ACTIONS) this.addCommand({ id: `selection-${action.id}`, name: `${action.label} — sélection`,
      editorCheckCallback: (checking, editor, info) => {
        const selection = this.captureSelection(editor, info.file?.path);
        if (!selection || this.session.busy || this.sending || this.connecting) return false;
        if (!checking) this.openSelectionAction(action.id, selection);
        return true;
      } });
    this.addCommand({ id: "compare-versions", name: "Comparer les versions", checkCallback: checking => {
      const chapter = this.revisionChapter;
      if (!chapter) return false;
      if (!checking) void this.compareVersions(chapter).catch(error => new Notice(errorText(error)));
      return true;
    } });
    this.addCommand({ id: "refresh-narrative-state", name: "Actualiser les états narratifs", callback: () => {
      void this.refreshNarrativeState().catch(error => new Notice(errorText(error)));
    } });
    this.addCommand({ id: "populate-workshop", name: "Peupler", callback: () => { void this.populateWorkshop().catch(error => new Notice(errorText(error))); } });
    this.addCommand({ id: "open-chat", name: "Ouvrir le chat", callback: () => { void this.openChat(); } });
    this.addRibbonIcon("orelius", "Ouvrir Orelius", () => { void this.openChat(); });
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      const folders = { ...this.settings };
      const prefix = folders.folder ? `${folders.folder}/` : "";
      if (!oldPath.startsWith(prefix) || !file.path.startsWith(prefix)) return;
      const from = oldPath.slice(prefix.length), to = file.path.slice(prefix.length);
      void this.correctionTask(async () => {
        const cwd = await this.workingDirectory();
        if (folders.folder !== this.settings.folder) return;
        this.structure = await syncStructure(cwd, folders, { rename: { from, to } }, this.configurationDirectory());
        for (const view of this.views) view.update();
      }).catch(error => new Notice(errorText(error)));
    }));
    this.navigation = new ChatNavigation(this.app.workspace.getActiveFile()?.path ?? null);
    this.registerEvent(this.app.workspace.on("file-open", file => {
      if (this.lockedNotes.size) this.highlights.refresh();
      const activeFile = this.app.workspace.getActiveViewOfType(FileView)?.file;
      if (!this.hidingChat && file && activeFile?.path === file.path && file.path !== this.navigation.path) {
        this.navigate(file.path);
      }
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", leaf => {
      if (this.hidingChat) return;
      if (leaf?.getRoot() === this.app.workspace.rootSplit) {
        const path = leaf.view instanceof NovelView ? leaf.view.projectFolder : leaf.view instanceof FileView ? leaf.view.file?.path ?? null : null;
        if (path !== this.navigation.path) this.navigate(path);
      }
      if (leaf?.view instanceof OreliusView && !this.session.busy && !this.connecting && !this.sending) {
        void this.refreshCorrections().catch(error => new Notice(errorText(error)));
      }
    }));
    this.registerDomEvent(this.app.workspace.containerEl, "click", event => {
      if (!(event.target instanceof Element)) return;
      const title = event.target.closest(".nav-folder-title, .nav-file-title");
      if (!title?.closest('.workspace-leaf-content[data-type="file-explorer"]')) return;
      const path = title.getAttribute("data-path");
      if (path === null) return;
      this.navigate(path === "/" ? "" : path);
    }, { capture: true });
  }

  private navigate(path: string | null): void {
    for (const view of this.views) view.update();
    const task = this.navigation.run(path, async current => {
      await this.settingsWrite;
      if (this.unloaded || !current()) return;
      const folder = visibleFolder(this.settings, path, Boolean(this.session.busy || this.connecting || this.sending));
      if (folder === undefined) {
        this.hideChat();
        return;
      }
      if (folder !== this.settings.folder) await this.saveSettings({ folder });
      if (this.unloaded || !current()) return;
      await this.openChat(false);
    });
    if (visibleFolder(this.settings, path, Boolean(this.session.busy || this.connecting || this.sending)) === undefined) this.hideChat();
    void task.catch(error => { if (!this.unloaded) new Notice(errorText(error)); });
  }

  private hideChat(fallbackCollapsed: boolean | null = null): void {
    this.hidingChat = true;
    try {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) leaf.detach();
      const collapsed = this.navigation.restoreSidebar(fallbackCollapsed);
      if (collapsed === true) this.app.workspace.rightSplit.collapse();
      else if (collapsed === false) this.app.workspace.rightSplit.expand();
    }
    finally { this.hidingChat = false; }
  }

  onunload(): void {
    this.unloaded = true;
    this.app.workspace.containerEl.removeClass("orelius-chat-open");
    void this.codexTest?.stop();
    this.codexTest = null;
    void this.session.disconnect();
  }

  async openChat(focus = true): Promise<void> {
    const current = this.navigation.current();
    let previousCollapsed: boolean | null = null;
    try {
      await this.settingsWrite;
      if (this.unloaded || !current()) return;
      await this.refreshCorrections();
      if (this.unloaded || !current()) return;
      previousCollapsed = this.navigation.rememberSidebar(this.app.workspace.rightSplit.collapsed);
      const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0] ?? this.app.workspace.getRightLeaf(false);
      if (!leaf) throw new Error("Impossible d’ouvrir un panneau latéral.");
      await leaf.setViewState({ type: VIEW_TYPE, active: focus });
      if (this.unloaded || !current()) { this.hideChat(previousCollapsed); return; }
      await this.app.workspace.revealLeaf(leaf);
      if (this.unloaded || !current()) { this.hideChat(previousCollapsed); return; }
      if (!this.unloaded && !this.session.connected && !this.session.busy && !this.connecting && !this.sending) {
        void this.connect().catch(error => { if (!this.unloaded) new Notice(errorText(error)); });
      }
    } catch (error) {
      if (previousCollapsed !== null) this.hideChat(previousCollapsed);
      new Notice(errorText(error));
    }
  }

  attach(view: OreliusView): void {
    this.views.add(view);
    this.app.workspace.containerEl.addClass("orelius-chat-open");
  }

  detach(view: OreliusView): void {
    this.views.delete(view);
    this.app.workspace.containerEl.toggleClass("orelius-chat-open", this.views.size > 0);
  }

  saveSettings(changes: SettingsChanges): Promise<void> {
    const write = this.settingsWrite.then(async () => {
      const previous = this.settings;
      const changedFolder = changes.folder !== undefined && changes.folder !== previous.folder;
      const changedLayout = PROJECT_FOLDER_KEYS.some(key => changes[key] !== undefined && changes[key] !== previous[key]);
      const changedConnection = changedFolder || changedLayout || (changes.codexPath !== undefined && changes.codexPath !== previous.codexPath);
      if (changedConnection && (this.session.busy || this.connecting || this.sending)) {
        throw new Error("Arrêtez la tâche Codex avant de changer de dossier ou de connexion.");
      }
      const next = applySettings(previous, changes);
      if (changedFolder) await this.prepareProject(next.folder, next);
      await this.saveData(next);
      this.settings = next;
      if (changedFolder || changedLayout) { this.structure = null; this.requestContext = null; }
      if (previous.revisionHighlights !== next.revisionHighlights) this.highlights.refresh();
      if (previous.showActivity !== next.showActivity) for (const view of this.views) view.update();
      if (changedConnection) {
        if (changedFolder) {
          this.session.items = [];
          this.session.turns = [];
          this.session.threadId = "";
        }
        await this.session.disconnect();
      }
    });
    this.settingsWrite = write.catch(() => {});
    return write;
  }

  async testCodex(): Promise<string> {
    if (this.codexTest) throw new Error("Un test de connexion est déjà en cours.");
    const client: CodexClient = new CodexClient({
      notification() {}, request: request => client.rejectRequest(request.id), exit() {},
    });
    this.codexTest = client;
    try {
      await this.settingsWrite;
      const path = await findCodex(this.settings.codexPath);
      const cwd = await this.workingDirectory("");
      if (this.codexTest !== client) throw new Error("Test de connexion interrompu.");
      return await client.connect(path, cwd);
    } finally {
      await client.stop();
      if (this.codexTest === client) this.codexTest = null;
    }
  }

  private configurationDirectory(): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error("Orelius nécessite un coffre local sur Obsidian desktop.");
    return resolve(adapter.getBasePath(), this.app.vault.configDir);
  }

  async workingDirectory(folder = this.settings.folder): Promise<string> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error("Orelius nécessite un coffre local sur Obsidian desktop.");
    if (isAbsolute(folder) || folder.split(/[\\/]/).includes("..")) throw new Error("Choisissez un dossier relatif au coffre.");
    const entry = folder ? this.app.vault.getAbstractFileByPath(folder) : this.app.vault.getRoot();
    if (!(entry instanceof TFolder)) throw new Error(`Dossier introuvable : ${folder}. Corrigez le dossier dans Réglages → Orelius.`);
    const root = await realpath(adapter.getBasePath());
    const cwd = await realpath(resolve(root, folder));
    const location = relative(root, cwd);
    if (location === ".." || location.startsWith("../") || isAbsolute(location)) throw new Error("Le dossier doit rester dans le coffre.");
    return cwd;
  }

  async prepareProject(folder = this.settings.folder, folders: ProjectFolders = this.settings): Promise<string> {
    const preparation = this.projectWrite.then(async () => {
      const cwd = await this.workingDirectory(folder);
      await prepareProject(cwd, folders, this.configurationDirectory());
      await prepareBible(cwd, folders);
      await generateAgent(cwd, { ...folders, folder }, agentTemplate);
      await this.correctionTask(() => prepareCorrections(cwd, folders));
      return cwd;
    });
    this.projectWrite = preparation.then(() => {}, () => {});
    return preparation;
  }

  private correctionTask<T>(action: () => Promise<T>): Promise<T> {
    const work = this.correctionWrite.then(action);
    this.correctionWrite = work.then(() => {}, () => {});
    return work;
  }

  get activeStoryNode() {
    const path = this.app.workspace.getActiveFile()?.path;
    const prefix = this.settings.folder ? `${this.settings.folder}/` : "";
    if (!path?.startsWith(prefix)) return;
    return this.structure?.nodes.find(node => !node.missing && node.kind !== "chapitre" && node.path === path.slice(prefix.length));
  }

  get contextChoiceCount(): number { return this.requestContext?.folder === this.settings.folder ? this.requestContext.choice.include.length + this.requestContext.choice.exclude.length : 0; }

  async chooseContext(): Promise<void> {
    if (this.sending || this.connecting || this.session.busy) throw new Error("Attendez la fin de la tâche pour choisir le contexte du prochain envoi.");
    const folder = this.settings.folder, chapter = this.revisionChapter;
    const draft = this.requestContext?.folder === folder && this.requestContext.choice.chapter === chapter ? this.requestContext.choice : { chapter, include: [], exclude: [] };
    new ContextModal(this.app, structuredClone(draft), async choice => {
      if (folder !== this.settings.folder || this.sending || this.connecting || this.session.busy) throw new Error("Le dossier ou la tâche a changé. Rouvrez Contexte.");
      const cwd = await this.refreshCorrections(chapter ?? undefined);
      validateContextChoice(choice, this.settings, chapter ?? undefined);
      const request = withContext(this.draft, choice);
      const dossier = chapter ? await buildSceneContext(cwd, this.settings, this.settings.codexVersions[cwd] ?? {}, chapter, request, taskPrompts, true) : null;
      const sources = dossier ? dossier.sources
        : (await readEditorialContext(cwd, this.settings, this.settings.codexVersions[cwd] ?? {}, undefined, request)).flatMap(page => (JSON.parse(page) as { sources: { path: string; role: string; content: string; reason?: string }[] }).sources);
      const catalogue = await projectSources(cwd, this.settings);
      const required = new Set([chapter, structurePath(this.settings), configPath(this.settings)]);
      const notes = new Map<string, ContextNote>();
      for (const note of catalogue) notes.set(note.path, { path: note.path, selected: false, characters: 0, reason: required.has(note.path) ? "Configuration indispensable au calcul du contexte" : choice.exclude.includes(note.path) ? "Retirée pour cette demande" : dossier?.omitted?.includes(note.path) ? "Écartée par le budget de références" : "Non retenue automatiquement pour cette demande", required: required.has(note.path) });
      for (const source of sources) {
        if (!source.path.endsWith(".md") || ![this.settings.manuscriptFolder, this.settings.bibleFolder, this.settings.modelFolder].some(root => source.path.startsWith(root + "/"))) continue;
        const note = notes.get(source.path);
        notes.set(source.path, { path: source.path, selected: true, characters: (note?.characters ?? 0) + source.content.length, reason: source.reason ?? SOURCE_REASONS[source.role] ?? source.role, required: required.has(source.path) });
      }
      for (const path of choice.exclude) if (!notes.has(path)) notes.set(path, { path, selected: false, characters: 0, reason: "Retirée pour cette demande", required: false });
      const configuration = await readProjectFile(cwd, configPath(this.settings));
      const config = configuration ? parseConfig(readData(configuration.text), this.settings) : null;
      return { notes: [...notes.values()].sort((a, b) => Number(b.selected) - Number(a.selected) || a.path.localeCompare(b.path, "fr", { numeric: true })), characters: sources.reduce((total, source) => total + source.content.length, 0), budget: chapter ? config?.maxCharacters : undefined, warnings: dossier?.warnings };
    }, choice => {
      if (folder !== this.settings.folder || this.session.busy || this.sending) throw new Error("Le dossier ou la tâche a changé. Rouvrez Contexte.");
      this.requestContext = choice.include.length || choice.exclude.length ? { folder, choice: structuredClone(choice) } : null;
      for (const view of this.views) view.update();
    }).open();
  }

  private contextForRequest(chapter?: string | null): ContextChoice | null {
    if (!this.requestContext) return null;
    if (this.requestContext.folder !== this.settings.folder || this.requestContext.choice.chapter !== (chapter ?? null)) throw new Error("Les choix de contexte concernent un autre dossier ou chapitre. Rouvrez Contexte avant l’envoi.");
    validateContextChoice(this.requestContext.choice, this.settings, chapter ?? undefined);
    return this.requestContext.choice;
  }

  async openNovel(): Promise<void> {
    const leaf = this.app.workspace.getLeavesOfType(NOVEL_VIEW).find(leaf => leaf.view instanceof NovelView && leaf.view.projectFolder === this.settings.folder) ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: NOVEL_VIEW, active: true, state: { folder: this.settings.folder } });
    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof NovelView) await leaf.view.refresh();
  }

  async loadNovel(folder: string, edit?: StructureEdit["outline"]): Promise<StoryStructure> {
    await this.settingsWrite;
    if (folder !== this.settings.folder) throw new Error("Le dossier de travail a changé. Rouvrez la vue du roman.");
    if (this.sending || this.connecting || this.session.busy) throw new Error("Attendez la fin de la tâche puis actualisez la vue du roman.");
    this.sending = true;
    try {
      const cwd = await this.refreshCorrections();
      return await this.correctionTask(async () => {
        const path = structurePath(this.settings), registry = await readProjectFile(cwd, path);
        const ensureCurrent = () => {
          if (folder !== this.settings.folder) throw new Error("Le dossier de travail a changé.");
          this.checkSavedDirectory(cwd);
          this.checkEditor(path, registry?.text ?? "");
        };
        ensureCurrent();
        let data = await syncStructure(cwd, this.settings, {}, this.configurationDirectory(), ensureCurrent);
        if (edit || !data.outline) data = await syncStructure(cwd, this.settings, { outline: edit ?? { expected: JSON.stringify(data), action: { type: "initialize" } } }, this.configurationDirectory(), ensureCurrent);
        this.structure = data;
        const delivery = await collectChanges(cwd, this.settings, this.configurationDirectory());
        this.session.pendingChanges = delivery.pending.map(change => change.path);
        for (const view of this.views) view.update();
        return data;
      });
    } finally { this.sending = false; }
  }

  async decideStory(value: Decision): Promise<void> {
    const node = this.activeStoryNode;
    if (!node || this.session.busy || this.sending || this.connecting) throw new Error("Ouvrez une fiche et attendez la fin de la tâche avant de choisir.");
    const cwd = await this.refreshCorrections();
    await this.correctionTask(async () => {
      this.structure = await syncStructure(cwd, this.settings, { decision: { path: node.path, value } }, this.configurationDirectory());
      const delivery = await collectChanges(cwd, this.settings, this.configurationDirectory());
      this.session.pendingChanges = delivery.pending.map(change => change.path);
      for (const view of this.views) view.update();
    });
  }

  get revisionChapter(): string | null {
    const path = this.app.workspace.getActiveFile()?.path;
    const prefix = this.settings.folder ? `${this.settings.folder}/` : "";
    return path?.startsWith(prefix) ? chapterPath("/", this.settings, path.slice(prefix.length)) : null;
  }

  reactionFor(itemId: string): Reaction | undefined {
    return this.settings.reactions[reactionKey(this.settings.threadCwd, this.session.threadId, itemId)]?.value;
  }

  async react(itemId: string, value: Reaction, message: string): Promise<void> {
    await this.settingsWrite;
    if (this.sending || this.connecting || this.session.busy) throw new Error("Attendez la fin de la tâche ou de l’envoi avant de noter cet échange.");
    const threadId = this.session.threadId;
    const exchange = reactionExchanges(this.session.turns).get(itemId);
    if (!threadId || !exchange) throw new Error("Cette réponse finale n’est plus disponible dans la conversation active.");
    this.sending = true;
    try {
      const cwd = await this.refreshCorrections();
      this.checkSavedDirectory(cwd);
      const folders = this.settings;
      const key = reactionKey(cwd, threadId, itemId);
      let rating = folders.reactions[key];
      await this.correctionTask(async () => {
        rating = await recordReaction(cwd, folders, threadId, exchange, value, message, rating, (path, content) => this.checkEditor(path, content));
      });
      await this.saveSettings({ reactions: { ...this.settings.reactions, [key]: rating } });
      if (this.draft === message) this.draft = "";
      for (const view of this.views) view.update();
      new Notice("Réaction et retour ajoutés au suivi.");
    } finally { this.sending = false; this.releaseNoteLocks(); }
  }

  get acceptanceChapter(): string | null {
    const chapter = this.revisionChapter;
    const key = `${this.settings.folder ? `${this.settings.folder}/` : ""}${chapter}`;
    const snapshot = this.settings.revisionHighlights[key];
    return chapter && snapshot && snapshot.before !== snapshot.after ? chapter : null;
  }

  async clearRevisionHighlights(chapter: string): Promise<void> {
    const folder = this.settings.folder;
    await this.settingsWrite;
    if (this.sending || this.connecting || this.session.busy) throw new Error("Attendez la fin de la tâche ou de l’envoi avant d’effacer le surlignage.");
    if (folder !== this.settings.folder || chapter !== this.acceptanceChapter) throw new Error("Le chapitre surligné a changé. Revenez au chapitre à relire.");
    this.sending = true;
    try {
      const revisionHighlights = { ...this.settings.revisionHighlights };
      delete revisionHighlights[`${folder ? `${folder}/` : ""}${chapter}`];
      await this.saveSettings({ revisionHighlights });
    } finally {
      this.sending = false;
      for (const view of this.views) view.update();
    }
  }

  async acceptRevision(message: string, chapter: string): Promise<void> {
    await this.settingsWrite;
    if (this.sending || this.connecting || this.session.busy) throw new Error("Attendez la fin de la tâche ou de l’envoi avant d’accepter les modifications.");
    if (chapter !== this.acceptanceChapter) throw new Error("Aucune modification à accepter dans ce chapitre.");
    this.sending = true;
    try {
      const cwd = await this.refreshCorrections(chapter);
      const folders = this.settings;
      const key = `${folders.folder ? `${folders.folder}/` : ""}${chapter}`;
      const snapshot = folders.revisionHighlights[key];
      if (!snapshot) throw new Error("Les modifications de ce chapitre ont changé. Relisez-les avant de les accepter.");
      this.lockNote(chapter);
      await this.correctionTask(async () => { await recordAcceptance(cwd, folders, chapter, snapshot, message, (path, content) => this.checkEditor(path, content)); });
      const revisionHighlights = { ...this.settings.revisionHighlights };
      delete revisionHighlights[key];
      await this.saveSettings({ revisionHighlights });
      if (this.draft === message) this.draft = "";
      for (const view of this.views) view.update();
      new Notice("Modifications acceptées ; surlignage retiré et retour ajouté au suivi.");
    } finally { this.sending = false; this.releaseNoteLocks(); }
  }

  async refreshCorrections(chapter?: string): Promise<string> {
    await this.settingsWrite;
    const cwd = await this.prepareProject();
    const folders = this.settings;
    await this.correctionTask(async () => {
      if (this.session.busy) return;
      const versions = folders.codexVersions[cwd] ?? {};
      const pending = new Map<string, MarkdownView>();
      this.app.workspace.iterateAllLeaves(leaf => {
        const view = leaf.view;
        if (!(view instanceof MarkdownView) || !view.file || view.getViewData() === view.data) return;
        const prefix = folders.folder ? `${folders.folder}/` : "";
        if (!view.file.path.startsWith(prefix)) return;
        const path = view.file.path.slice(prefix.length);
        if (![folders.manuscriptFolder, folders.modelFolder, folders.bibleFolder].some(folder => path.startsWith(`${folder}/`))) return;
        const other = pending.get(path);
        if (other && other.getViewData() !== view.getViewData()) throw new Error(`Deux éditeurs ont des corrections différentes pour ${path}. Enregistrez la version souhaitée.`);
        pending.set(path, view);
      });
      for (const view of pending.values()) await view.save();
      await refreshCorrections(cwd, folders, versions);
      this.structure = await syncStructure(cwd, folders, {}, this.configurationDirectory());
      const delivery = await collectChanges(cwd, folders, this.configurationDirectory());
      this.session.pendingChanges = delivery.pending.map(change => change.path);
      for (const view of this.views) view.update();
    });
    return cwd;
  }

  async connect(model?: string): Promise<void> {
    if (this.connecting || this.sending) {
      if (model !== undefined) throw new Error("Attendez la fin de la connexion ou de l’envoi pour changer de modèle.");
      return this.connecting ?? undefined;
    }
    this.connecting = (async () => {
      await this.settingsWrite;
      const cwd = await this.prepareProject();
      if (this.unloaded) return;
      this.checkSavedDirectory(cwd);
      await this.session.connect(this.settings.codexPath, cwd, this.settings.threadId, model);
    })();
    try { await this.connecting; }
    finally { this.connecting = null; }
  }

  async send(text: string, chapter?: string, wholeChapterRequested = false): Promise<void> {
    await this.settingsWrite;
    const currentChapter = this.revisionChapter;
    if (wholeChapterRequested && !chapter) throw new Error("Ouvrez le chapitre à recommencer.");
    if (!chapter && currentChapter && fullRewriteRequested(text, currentChapter)) chapter = currentChapter;
    if (this.sending || this.connecting) throw new Error("Un envoi ou une connexion est déjà en cours. Votre message est conservé.");
    if (chapter && this.session.busy) throw new Error("Attendez la fin de la tâche pour réviser le chapitre avec ses dernières corrections.");
    const activePath = this.app.workspace.getActiveFile()?.path;
    this.sending = true;
    try {
      const cwd = this.session.busy ? await this.workingDirectory() : await this.refreshCorrections(chapter);
      this.checkSavedDirectory(cwd);
      if (!this.session.busy) {
        if (chapter) this.lockNote(chapter);
        else {
          const prefix = this.settings.folder ? `${this.settings.folder}/` : "";
          if (activePath?.startsWith(prefix)) this.lockNote(activePath.slice(prefix.length));
        }
      }
      const versions = this.settings.codexVersions[cwd] ?? {};
      const source = chapter ? await readProjectFile(cwd, chapter) : null;
      if (chapter && !source) throw new Error(`Chapitre introuvable : ${chapter}.`);
      const revision = chapter && source ? planRevision(chapter, source.text, versions[chapter], text, true) : undefined;
      const protections = this.session.busy ? [] : await revisionProtections(cwd, this.settings, versions, chapter);
      const message = chapter ? await revisionPrompt(cwd, this.settings, chapter, versions, text, revision) : text;
      const context = this.session.busy ? null : this.contextForRequest(chapter ?? currentChapter);
      await this.session.send(withContext(message, context), this.settings.codexPath, cwd, this.settings.threadId, revision, protections);
      if (context && this.requestContext?.choice === context) this.requestContext = null;
      if (this.draft === text) this.draft = "";
      for (const view of this.views) view.update();
    } finally { this.sending = false; this.releaseNoteLocks(); }
  }

  async compareVersions(chapter: string): Promise<void> {
    if (this.sending || this.connecting || this.session.busy) throw new Error("Attendez la fin de la tâche pour comparer les versions.");
    const cwd = await this.refreshCorrections(chapter), folders = { ...this.settings };
    const previous = await readProjectFile(cwd, chapter);
    if (!previous) throw new Error("Chapitre introuvable.");
    const versions = await comparisonVersions(cwd, folders, chapter, previous.text);
    new ComparisonModal(this.app, versions, async (content, description) => {
      if (this.sending || this.connecting || this.session.busy) throw new Error("Attendez la fin de la tâche avant d’appliquer ce choix.");
      const ensureCurrent = () => {
        if (folders.folder !== this.settings.folder) throw new Error("Le dossier de travail a changé.");
        this.checkSavedDirectory(cwd);
        this.checkEditor(chapter, previous.text);
      };
      ensureCurrent();
      this.sending = true;
      this.lockNote(chapter);
      try {
        await this.correctionTask(async () => {
          const archive: typeof import("./archives").archiveChanges = (root, changes) => archiveWithCorrections(root, folders, changes,
            folders.codexVersions[cwd] ?? {}, (path, text) => this.checkEditor(path, text), this.configurationDirectory());
          await applyComparison(cwd, folders, chapter, previous, content, ensureCurrent, archive, this.configurationDirectory());
          const key = `${folders.folder ? `${folders.folder}/` : ""}${chapter}`;
          const revisionHighlights = { ...this.settings.revisionHighlights };
          if (content !== previous.text) revisionHighlights[key] = { before: previous.text, after: content };
          await this.saveSettings({ codexVersions: { ...this.settings.codexVersions, [cwd]: { ...this.settings.codexVersions[cwd], [chapter]: content } }, revisionHighlights });
        });
        try {
          const quote = (text: string) => text.split("\n").map(line => `    ${line}`).join("\n");
          const changes = diffToGroups(previous.text, content).map(change => `### Avant\n\n${quote(change.delText)}\n\n### Retenu\n\n${quote(change.insText ?? "")}`).join("\n\n");
          await recordFeedback(cwd, folders, { kind: "reaction", id: randomUUID(), title: `Choix de version — ${chapter}`,
            body: `${description}\n\nChoix explicite de l’auteur. Seuls les changements ci-dessous sont retenus. Ce choix ne constitue pas une approbation générale du chapitre ni une règle de style.\n\n${changes || "Aucun changement de texte."}`,
            summary: `L’auteur a choisi une version de ${chapter}. Consulter les différences retenues ; ne pas déduire de préférence générale d’une restauration ou d’un choix local.` },
            (path, text) => this.checkEditor(path, text));
        } catch (error) { new Notice(`Texte appliqué et archivé, mais le suivi du choix n’a pas pu être enregistré : ${errorText(error)}`, 12000); }
        new Notice("Version appliquée. Le texte précédent est conservé dans les archives.");
      } finally { this.sending = false; this.releaseNoteLocks(); for (const view of this.views) view.update(); }
    }).open();
  }

  private captureSelection(editor: Editor, filePath?: string) {
    const prefix = this.settings.folder ? `${this.settings.folder}/` : "";
    if (!filePath?.startsWith(prefix) || editor.listSelections().length !== 1) return null;
    const path = filePath.slice(prefix.length);
    if (chapterPath("/", this.settings, path) !== path) return null;
    const source = editor.getValue(), from = editor.posToOffset(editor.getCursor("from")), to = editor.posToOffset(editor.getCursor("to"));
    if (!source.slice(from, to).trim()) return null;
    return { path, source, from, to, folder: this.settings.folder };
  }

  private openSelectionAction(action: SelectionAction, selection: NonNullable<ReturnType<OreliusPlugin["captureSelection"]>>): void {
    new SelectionModal(this.app, action, selection.source.slice(selection.from, selection.to), async (details, target) => {
      const request = selectionRequest(action, selection.path, selection.source, selection.from, selection.to, details, target);
      await this.sendSelection(request, selection.folder);
    }).open();
  }

  private async sendSelection(request: SelectionRequest, folder: string): Promise<void> {
    await this.settingsWrite;
    if (folder !== this.settings.folder) throw new Error("Le dossier de travail a changé. Sélectionnez de nouveau le passage.");
    if (this.sending || this.connecting || this.session.busy) throw new Error("Attendez la fin de la tâche avant de lancer une action sur la sélection.");
    this.sending = true;
    try {
      const cwd = await this.refreshCorrections(request.path);
      if (folder !== this.settings.folder || chapterPath(cwd, this.settings, request.path) !== request.path) throw new Error("Le dossier ou le chapitre sélectionné a changé.");
      this.checkSavedDirectory(cwd);
      const source = await readProjectFile(cwd, request.path);
      if (!source) throw new Error("Le chapitre sélectionné n’existe plus.");
      const revision = selectionPlan(request, source.text);
      this.checkEditor(request.path, source.text);
      if (!revision.selection?.readOnly) this.lockNote(request.path);
      const context = this.contextForRequest(request.path);
      await this.session.send(withContext(selectionPrompt(request), context), this.settings.codexPath, cwd, this.settings.threadId, revision);
      if (context && this.requestContext?.choice === context) this.requestContext = null;
      await this.openChat(true);
    } finally { this.sending = false; this.releaseNoteLocks(); }
  }

  async populateWorkshop(): Promise<void> {
    if (this.sending || this.connecting || this.session.busy) throw new Error("Attendez la fin de la tâche avant de peupler l’atelier.");
    this.sending = true;
    try {
      const cwd = await this.refreshCorrections();
      this.checkSavedDirectory(cwd);
      const instruction = POPULATE_PREFIX + `Dossier du manuscrit : ${this.settings.manuscriptFolder}. Sources : ${this.settings.modelFolder}, ${this.settings.bibleFolder}, ${this.settings.manuscriptFolder}.\n\n` + populateTemplate;
      await this.session.send(instruction, this.settings.codexPath, cwd, this.settings.threadId);
    } finally { this.sending = false; }
  }

  async refreshNarrativeState(): Promise<void> {
    if (this.session.busy || this.sending || this.connecting) throw new Error("Attendez la fin de la tâche avant d’actualiser les états.");
    this.sending = true;
    try {
      await this.settingsWrite;
      const cwd = await this.workingDirectory();
      const pending = await pendingStates(cwd, this.settings);
      if (!pending.length) { new Notice("Les états narratifs sont à jour."); return; }
      await this.session.send(maintenancePrompt(pending), this.settings.codexPath, cwd, this.settings.threadId);
    } finally { this.sending = false; }
  }

  async retry(): Promise<void> {
    await this.settingsWrite;
    if (this.sending || this.connecting || this.session.busy) throw new Error("Attendez la fin de la tâche ou de la connexion avant de relancer.");
    this.sending = true;
    try {
      const cwd = await this.workingDirectory();
      this.checkSavedDirectory(cwd);
      await this.session.retry(this.settings.codexPath, cwd, this.settings.threadId);
    } finally { this.sending = false; this.releaseNoteLocks(); }
  }

  private lockNote(path: string): void {
    if (!path || path.split("/").includes("..")) return;
    const key = `${this.settings.folder ? `${this.settings.folder}/` : ""}${path}`.normalize("NFC").toLowerCase();
    if (this.lockedNotes.has(key)) return;
    this.lockedNotes.add(key);
    this.highlights.refresh();
  }

  private releaseNoteLocks(): void {
    if (this.session?.busy || this.sending || !this.lockedNotes.size) return;
    this.lockedNotes.clear();
    this.highlights.refresh();
  }

  private checkSavedDirectory(cwd: string): void {
    if (this.settings.threadId && this.settings.threadCwd !== cwd) {
      throw new Error("Le dossier de la conversation a changé. Créez une nouvelle conversation pour ce dossier.");
    }
  }

  private checkEditor(path: string, content: string): void {
    const vaultPath = this.settings.folder ? `${this.settings.folder}/${path}` : path;
    this.app.workspace.iterateAllLeaves(leaf => {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === vaultPath && view.getViewData() !== content) {
        throw new Error(`La note ${path} a des modifications dans l’éditeur. Attendez leur enregistrement, puis relancez la demande.`);
      }
    });
  }

  async openFile(path: string, newTab = false): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return;
    const cwd = await this.workingDirectory();
    const root = await realpath(adapter.getBasePath());
    const target = await realpath(resolve(cwd, path));
    const location = relative(root, target);
    if (location === ".." || location.startsWith("../") || isAbsolute(location)) throw new Error("Ce fichier est extérieur au coffre.");
    const file = this.app.vault.getAbstractFileByPath(location);
    if (!(file instanceof TFile)) throw new Error(`Fichier introuvable dans Obsidian : ${location}`);
    await this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(file);
  }
}
