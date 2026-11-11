import { brainstormFolder, withBrainstorm } from "./brainstorm";
import { trackDocuments, waitForTracking } from "./document-tracking";
import { recordInput } from "./author-inputs";
import { externalSources, prepareSourceConfig } from "./external-sources";
import { moveProjects, movedPath } from "./project-move";
import { ResetProjectModal } from "./reset-project-modal";
import { resetProject } from "./reset-project";
import { ExplorerActions } from "./explorer-actions";
import { PopulateNotice } from "./populate-notice";
import { newModelSources } from "./populate-state";
import { loadTranslationFiles } from "./locale-files";
import { t, setLocale, getLocale } from "./i18n.ts";
import { NewProjectModal } from "./new-project-modal";
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
import { parseYaml, addIcon, getLanguage, requireApiVersion, type Editor, editorInfoField, FileSystemAdapter, FileView, MarkdownView, Notice, Plugin, TFile, TFolder } from "obsidian";
import oreliusIcon from "../icon.svg";
import { readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { CodexClient, errorText, findCodex } from "./codex";
import { ChatSession } from "./session";
import { checkPath, prepareProject } from "./archives";
import { prepareBible } from "./bible";
import { saveConversation } from "./conversation";
import { archiveWithCorrections, captureCodexVersions, chapterPath, revisionDocumentPath, refreshCorrections, revisionPrompt, revisionProtections } from "./corrections";
import { applySettings, loadSettings, PROJECT_FOLDER_KEYS, validateFolderName, visibleFolder, associatedFolder, type OreliusSettings, type ProjectFolders, type SettingsChanges } from "./settings";
import { OreliusSettingTab } from "./settings-tab";
import { OreliusView, VIEW_TYPE } from "./chat-view";
import { ChatNavigation } from "./navigation";
import { generateAgent, renderAgent } from "./generate-agent.ts";
import agentTemplate from "../../prompts/agent.md";
import readinessPrompt from "../../prompts/verifier-prerequis.md";
import deepenProjectPrompt from "../../prompts/approfondir-projet.md";
import enrichBiblePrompt from "../../prompts/enrichir-bible.md";
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

const taskPrompts = { "verifier-prerequis": readinessPrompt, "approfondir-projet": deepenProjectPrompt, "enrichir-bible": enrichBiblePrompt, "preparer-scene": prepareScenePrompt, rediger: writePrompt, reviser: revisePrompt,
  "controler-continuite": continuityPrompt, "controler-publication": publicationPrompt, "actualiser-suivi": followupPrompt, "idees": task0, "synopsis": task1, "planifier": task2, "decomposer-scene": task3, "resumer": task4, "developper": task5, "reformuler": task6, "condenser": task7, "critiquer": task8, "extraire-style": task9, "adapter": task10, "actualiser-bible": task11, "decrire": task12, "continuer": task13 };

interface ProjectState {
  folder: string;
  session?: ChatSession;
  draft: string;
  lockedNotes: Set<string>;
  connecting: Promise<void> | null;
}

export default class OreliusPlugin extends Plugin {
  settings = loadSettings(undefined);
  private structure: StoryStructure | null = null;
  private explorerActions: ExplorerActions | null = null;
  private projects = new Map<string, ProjectState>();
  get session(): ChatSession { return this.projectSession(this.settings.folder); }
  get draft(): string { return this.projectState(this.settings.folder).draft; }
  set draft(value: string) { this.projectState(this.settings.folder).draft = value; }
  private get connecting(): Promise<void> | null { return this.projects.get(this.settings.folder)?.connecting ?? null; }
  private requestContext: { folder: string; choice: ContextChoice } | null = null;
  private views = new Set<OreliusView>();
  private settingsWrite = Promise.resolve();
  private projectWrite = Promise.resolve();
  private correctionWrite = Promise.resolve();
  private navigation = new ChatNavigation();
  private sending = false;
  private populatePending = false;
  resetting = false;
  private hidingChat = false;
  private unloaded = false;
  private codexTest: CodexClient | null = null;
  private highlights = revisionHighlights(() => this.settings.revisionHighlights);
  private documentTracking = new Map<string, number>();
  private pendingProjectMoves: { from: string; to: string }[] = [];

  private projectState(folder: string): ProjectState {
    let project = this.projects.get(folder);
    if (!project) {
      project = { folder, draft: "", lockedNotes: new Set(), connecting: null };
      this.projects.set(folder, project);
    }
    return project;
  }

  private projectSettings(folder: string): OreliusSettings { return applySettings(this.settings, { folder }); }

  private projectSession(folder: string): ChatSession {
    const project = this.projectState(folder);
    return project.session ??= this.createSession(project);
  }

  private createSession(project: ProjectState): ChatSession {
    return new ChatSession(() => {
      this.explorerActions?.refresh();
      this.releaseNoteLocks(project.folder);
      if (project.folder === this.settings.folder) for (const view of this.views) view.update();
    }, (threadId, cwd) => this.saveSettings(settings => ({ sessions: { ...settings.sessions, [project.folder]: { threadId, cwd } } })),
    (cwd, changes) => archiveWithCorrections(cwd, this.projectSettings(project.folder), changes, this.settings.codexVersions[cwd] ?? {},
      (path, content) => this.checkEditor(path, content, project.folder), this.configurationDirectory()),
    () => ({ ...this.projectSettings(project.folder), agentInstructions: renderAgent(agentTemplate, this.projectSettings(project.folder)),
      activeChapter: project.folder === this.settings.folder ? this.revisionChapter : null, taskPrompts,
      externalSources: (cwd, args) => externalSources(cwd, args, parseYaml),
      configDir: this.configurationDirectory(),
      checkEditor: (path, content) => this.checkEditor(path, content, project.folder), lockNote: path => this.lockNote(path, project.folder) }),
    async (cwd, changes, highlight) => {
      const folders = this.projectSettings(project.folder);
      const versions = await captureCodexVersions(cwd, folders, changes);
      if (Object.keys(versions).length) {
        await this.saveSettings(settings => {
          const revisionHighlights = { ...settings.revisionHighlights };
          for (const path of Object.keys(versions)) {
            const key = `${folders.folder ? `${folders.folder}/` : ""}${path}`;
            delete revisionHighlights[key];
            if (highlight) revisionHighlights[key] = highlight;
          }
          return { codexVersions: { ...settings.codexVersions, [cwd]: { ...settings.codexVersions[cwd], ...versions } }, revisionHighlights };
        });
      }
    }, (cwd, threadId, turns) => {
      const folders = this.projectSettings(project.folder);
      return this.correctionTask(async () => {
        const path = `${folders.folder ? `${folders.folder}/` : ""}Tracking/Conversation.md`;
        this.app.workspace.iterateAllLeaves(leaf => {
          const view = leaf.view;
          if (view instanceof MarkdownView && view.file?.path === path && view.getViewData() !== view.data) {
            throw new Error(t("theConversationLogHasUnsavedEditorChangesWaitFor"));
          }
        });
        await saveConversation(cwd, folders, threadId, turns);
      });
    });
  }

  async onload(): Promise<void> {
    setLocale(requireApiVersion("1.8.7") ? getLanguage() : window.localStorage.getItem("language") ?? "en");
    for (const error of await loadTranslationFiles(this.app.vault.adapter, `${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`}/locales`)) new Notice(error);
    addIcon("orelius", oreliusIcon);
    this.settings = loadSettings(await this.loadData());
    this.registerEditorExtension(this.highlights.extension);
    this.registerEditorExtension(editorLock(state => state.field(editorInfoField, false)?.file?.path, path => {
      const key = path.normalize("NFC").toLowerCase();
      for (const project of this.projects.values()) if (project.lockedNotes.has(key)) return true;
      return false;
    }));
    this.registerView(NOVEL_VIEW, leaf => new NovelView(leaf, this));
    this.addCommand({ id: "novel-outline", name: t("novelOverview"), callback: () => { void this.openNovel().catch(error => new Notice(errorText(error))); } });
    this.registerView(VIEW_TYPE, leaf => new OreliusView(leaf, this));
    this.addSettingTab(new OreliusSettingTab(this));
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, info) => {
      const prefix = this.settings.folder ? `${this.settings.folder}/` : "";
      const chapter = info.file?.path.startsWith(prefix) ? chapterPath("/", this.settings, info.file.path.slice(prefix.length)) : null;
      if (chapter) menu.addItem(item => item.setSection("orelius").setTitle(t("oreliusCompareVersions")).setIcon("columns-2")
        .onClick(() => { void this.compareVersions(chapter).catch(error => new Notice(errorText(error))); }));
      const selection = this.captureSelection(editor, info.file?.path);
      if (!selection) return;
      for (const action of SELECTION_ACTIONS) menu.addItem(item => item.setSection("orelius").setTitle(t("orelius", { value1: action.label })).setIcon("pencil")
        .setDisabled(this.session.busy || this.sending || Boolean(this.connecting)).onClick(() => this.openSelectionAction(action.id, selection)));
    }));
    for (const action of SELECTION_ACTIONS) this.addCommand({ id: `selection-${action.id}`, name: t("selection", { value1: action.label }),
      editorCheckCallback: (checking, editor, info) => {
        const selection = this.captureSelection(editor, info.file?.path);
        if (!selection || this.session.busy || this.sending || this.connecting) return false;
        if (!checking) this.openSelectionAction(action.id, selection);
        return true;
      } });
    this.addCommand({ id: "compare-versions", name: t("compareVersions"), checkCallback: checking => {
      const chapter = this.revisionChapter;
      if (!chapter) return false;
      if (!checking) void this.compareVersions(chapter).catch(error => new Notice(errorText(error)));
      return true;
    } });
    this.addCommand({ id: "refresh-narrative-state", name: t("updateNarrativeStates"), callback: () => {
      void this.refreshNarrativeState().catch(error => new Notice(errorText(error)));
    } });
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      const parent = file instanceof TFolder ? file : file.parent;
      if (parent) menu.addItem(item => item.setTitle(t("newOreliusProject")).setIcon("orelius")
        .onClick(() => this.newProject(parent)));
    }));
    this.addCommand({ id: "new-project", name: t("newOreliusProject"), callback: () => {
      this.newProject(this.app.workspace.getActiveFile()?.parent ?? this.app.vault.getRoot());
    } });
    this.addCommand({ id: "open-chat", name: t("openChat"), callback: () => { void this.openChat(); } });
    this.addRibbonIcon("orelius", t("openOrelius"), () => { void this.openChat(); });
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (this.resetting) return;
      if (file instanceof TFolder && this.moveProjectFolders(oldPath, file.path)) return;
      const folders = { ...this.settings };
      if (!folders.folder || associatedFolder(folders, oldPath) !== folders.folder || associatedFolder(folders, file.path) !== folders.folder) return;
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
    this.explorerActions = new ExplorerActions(this.app, () => this.settings,
      folder => Boolean(this.projects.get(folder)?.session?.busy || this.sending || this.populatePending || this.connecting),
      async folder => !this.resetting && (await newModelSources(await this.workingDirectory(folder), this.settings)).length > 0,
      folder => { void this.populateWorkshop(folder).catch(error => new Notice(errorText(error))); });
    this.registerEvent(this.app.vault.on("create", file => this.trackDocument(file.path)));
    this.registerEvent(this.app.vault.on("modify", file => this.trackDocument(file.path)));
    this.registerEvent(this.app.vault.on("delete", file => this.trackDocument(file.path)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => { this.trackDocument(oldPath); this.trackDocument(file.path); }));
    this.register(() => { for (const timer of this.documentTracking.values()) window.clearTimeout(timer); this.documentTracking.clear(); });
    this.register(() => this.explorerActions?.destroy());
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      this.explorerActions?.refresh();
    });
    this.registerEvent(this.app.workspace.on("layout-change", () => this.explorerActions?.refresh()));
    this.navigation = new ChatNavigation(this.app.workspace.getActiveFile()?.path ?? null);
    this.registerEvent(this.app.workspace.on("file-open", file => {
      if ([...this.projects.values()].some(project => project.lockedNotes.size)) this.highlights.refresh();
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
      if (leaf?.view instanceof OreliusView && visibleFolder(this.settings, this.navigation.path, false) === this.settings.folder && !this.session.busy && !this.connecting && !this.sending) {
        void this.refreshCorrections(undefined, false).catch(error => new Notice(errorText(error)));
      }
    }));
    this.registerDomEvent(this.app.workspace.containerEl, "click", event => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(".orelius-populate")) return;
      const title = event.target.closest(".nav-folder-title, .nav-file-title");
      if (!title?.closest('.workspace-leaf-content[data-type="file-explorer"]')) return;
      const path = title.getAttribute("data-path");
      if (path === null) return;
      this.navigate(path === "/" ? "" : path);
    }, { capture: true });
  }

  private navigate(path: string | null): void {
    const task = this.navigation.run(path, async current => {
      await this.settingsWrite;
      if (this.unloaded || !current()) return;
      const folder = visibleFolder(this.settings, path, this.sending);
      if (folder === undefined) {
        this.hideChat();
        return;
      }
      if (folder !== this.settings.folder) await this.saveSettings({ folder });
      if (this.unloaded || !current()) return;
      await this.openChat(false);
    });
    for (const view of this.views) view.update();
    if (visibleFolder(this.settings, path, this.sending) === undefined) this.hideChat();
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
    for (const project of this.projects.values()) void project.session?.disconnect();
  }

  async openChat(focus = true): Promise<void> {
    const current = this.navigation.current();
    let previousCollapsed: boolean | null = null;
    try {
      await this.settingsWrite;
      if (this.unloaded || !current()) return;
      if (visibleFolder(this.settings, this.navigation.path, false) !== this.settings.folder) { this.hideChat(); return; }
      await this.refreshCorrections(undefined, false);
      if (this.unloaded || !current()) return;
      previousCollapsed = this.navigation.rememberSidebar(this.app.workspace.rightSplit.collapsed);
      const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0] ?? this.app.workspace.getRightLeaf(false);
      if (!leaf) throw new Error(t("unableToOpenASidebarPanel"));
      await leaf.setViewState({ type: VIEW_TYPE, active: focus });
      if (this.unloaded || !current()) { this.hideChat(previousCollapsed); return; }
      await this.app.workspace.revealLeaf(leaf);
      if (this.unloaded || !current()) { this.hideChat(previousCollapsed); return; }
      if (focus) for (const view of this.views) view.followConversation();
      const session = this.session;
      const folder = this.settings.folder;
      void this.connect().catch(error => {
        if (this.unloaded) return;
        session.failure ??= { message: errorText(error), retryable: false };
        if (folder === this.settings.folder) for (const view of this.views) view.update();
      });
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

  private moveProjectFolders(from: string, to: string): boolean {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return false;
    const projected = this.pendingProjectMoves.reduce((settings, move) => moveProjects(settings, move.from, move.to, adapter.getBasePath()) ?? settings, this.settings);
    const affected = [projected.folder, ...Object.keys(projected.sessions)]
      .some(path => path && movedPath(path, from, to) !== path);
    if (!affected) return false;
    const active = movedPath(projected.folder, from, to) !== projected.folder;
    const move = { from, to };
    this.pendingProjectMoves.push(move);
    const moved = [...this.projects.values()].filter(project => this.pendingProjectMoves.reduce((folder, item) => movedPath(folder, item.from, item.to), project.folder) !== project.folder);
    const wasBusy = moved.some(project => project.session?.busy);
    const stopped = Promise.all(moved.map(project => project.session?.disconnect()));
    const path = this.navigation.path === null ? null : movedPath(this.navigation.path, from, to);
    void this.navigation.run(path, async () => {});
    const write = this.settingsWrite.then(async () => {
      await stopped;
      const root = await realpath(adapter.getBasePath());
      const next = moveProjects(this.settings, from, to, root);
      if (!next) return;
      await this.saveData(next);
      this.settings = next;
      for (const project of moved) {
        const folder = movedPath(project.folder, from, to);
        if (folder === project.folder) continue;
        this.projects.delete(project.folder);
        project.folder = folder;
        project.lockedNotes.clear();
        this.projects.set(folder, project);
      }
      this.app.workspace.iterateAllLeaves(leaf => {
        if (leaf.view instanceof NovelView) leaf.view.projectFolder = movedPath(leaf.view.projectFolder, from, to);
      });
      if (active) { this.structure = null; this.requestContext = null; }
      this.highlights.refresh();
      this.explorerActions?.refresh();
      for (const view of this.views) view.update();
      if (wasBusy) new Notice(t("projectMovedDuringTask"));
    });
    const finished = write.finally(() => { this.pendingProjectMoves = this.pendingProjectMoves.filter(item => item !== move); });
    this.settingsWrite = finished.catch(() => {});
    void finished.then(() => this.navigate(this.navigation.path)).catch(error => new Notice(errorText(error)));
    return true;
  }

  saveSettings(update: SettingsChanges | ((settings: OreliusSettings) => Partial<OreliusSettings>)): Promise<void> {
    const write = this.settingsWrite.then(async () => {
      const previous = this.settings;
      const changes = typeof update === "function" ? update(previous) : update;
      const changedFolder = changes.folder !== undefined && changes.folder !== previous.folder;
      const changedLayout = PROJECT_FOLDER_KEYS.some(key => changes[key] !== undefined && changes[key] !== previous[key]);
      const changedConnection = changedLayout || (changes.codexPath !== undefined && changes.codexPath !== previous.codexPath);
      const busy = [...this.projects.values()].some(project => project.session?.busy || project.connecting);
      if (changedConnection && (busy || this.sending) || changedFolder && this.sending) {
        throw new Error(t("stopTheCodexTaskBeforeChangingFoldersOrConnections"));
      }
      const next = applySettings(previous, changes);
      if (changedFolder && !this.projects.get(next.folder)?.session?.busy) await this.prepareProject(next.folder, next);
      await this.saveData(next);
      this.settings = next;
      this.explorerActions?.refresh();
      if (changedFolder || changedLayout) { this.structure = null; this.requestContext = null; }
      if (previous.revisionHighlights !== next.revisionHighlights) this.highlights.refresh();
      if (previous.showActivity !== next.showActivity || previous.debugMode !== next.debugMode) for (const view of this.views) view.update();
      if (changedConnection) {
        await Promise.all([...this.projects.values()].map(project => project.session?.disconnect()));
      }
    });
    this.settingsWrite = write.catch(() => {});
    return write;
  }

  async testCodex(): Promise<string> {
    if (this.codexTest) throw new Error(t("aConnectionTestIsAlreadyRunning"));
    const client: CodexClient = new CodexClient({
      notification() {}, request: request => client.rejectRequest(request.id), exit() {},
    });
    this.codexTest = client;
    try {
      await this.settingsWrite;
      const path = await findCodex(this.settings.codexPath);
      const cwd = await this.workingDirectory("", true);
      if (this.codexTest !== client) throw new Error(t("connectionTestInterrupted"));
      return await client.connect(path, cwd);
    } finally {
      await client.stop();
      if (this.codexTest === client) this.codexTest = null;
    }
  }

  private configurationDirectory(): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error(t("oreliusRequiresALocalVaultInObsidianDesktop"));
    return resolve(adapter.getBasePath(), this.app.vault.configDir);
  }

  async workingDirectory(folder = this.settings.folder, allowVaultRoot = false): Promise<string> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error(t("oreliusRequiresALocalVaultInObsidianDesktop"));
    if (isAbsolute(folder) || folder.split(/[\\/]/).includes("..")) throw new Error(t("chooseAFolderRelativeToTheVault"));
    const entry = folder ? this.app.vault.getAbstractFileByPath(folder) : this.app.vault.getRoot();
    if (!(entry instanceof TFolder)) throw new Error(t("folderNotFoundOpenAnExistingProjectFolderOr", { value1: folder }));
    const root = await realpath(adapter.getBasePath());
    const cwd = await realpath(resolve(root, folder));
    const location = relative(root, cwd);
    if (!location && !allowVaultRoot) throw new Error(t("projectFolderRequired"));
    if (location === ".." || location.startsWith("../") || isAbsolute(location)) throw new Error(t("theFolderMustStayInsideTheVault"));
    return cwd;
  }

  private newProject(parent: TFolder): void {
    new NewProjectModal(this.app, parent.path === "/" ? "" : parent.path, this.settings.modelFolder, async (name, selectedParent) => {
      if (name !== null) validateFolderName(name);
      if (this.sending) throw new Error(t("waitForTheTaskToFinishBeforeCreatingA"));
      const parentFolder = selectedParent ? this.app.vault.getAbstractFileByPath(selectedParent) : this.app.vault.getRoot();
      if (!(parentFolder instanceof TFolder)) throw new Error(t("projectParentMissing"));
      const prefix = selectedParent ? `${selectedParent}/` : "";
      const path = name === null ? selectedParent : `${prefix}${name}`;
      if (!path) throw new Error(t("projectFolderRequired"));
      if (name !== null && this.app.vault.getAbstractFileByPath(path)) throw new Error(t("thisNameAlreadyExistsChooseANewFolder"));
      const root = await this.workingDirectory("", true);
      await checkPath(root, resolve(root, path), this.configurationDirectory());
      if (name !== null) await this.app.vault.createFolder(path);
      await this.navigation.run(path, async current => {
        if (this.unloaded || !current()) return;
        try {
          const unchanged = this.settings.folder === path;
          const session = this.settings.sessions[path];
          await this.saveSettings({ folder: path, threadId: session?.threadId ?? "", threadCwd: session?.cwd ?? "" });
          if (unchanged && !this.projects.get(path)?.session?.busy) await this.prepareProject(path);
        } catch (error) {
          throw new Error(t("projectSetupFailed", { folder: path || this.app.vault.getName(), error: errorText(error) }));
        }
        if (this.unloaded || !current()) return;
        new Notice(t("projectCreatedCopyYourSourcesIntoThenRightClick", { value1: path || this.app.vault.getName(), value2: this.settings.modelFolder }), 12000);
        await this.openChat();
      });
    }).open();
  }

  async prepareProject(folder = this.settings.folder, folders: ProjectFolders = this.settings): Promise<string> {
    const preparation = this.projectWrite.then(async () => {
      const cwd = await this.workingDirectory(folder);
      await prepareProject(cwd, folders, this.configurationDirectory());
      await prepareSourceConfig(cwd, folders.archiveFolder, parseYaml);
      await prepareBible(cwd, folders);
      await generateAgent(cwd, { ...folders, folder }, agentTemplate);
      return cwd;
    });
    this.projectWrite = preparation.then(() => {}, () => {});
    return preparation;
  }

  private trackDocument(path: string): void {
    if (this.resetting || this.unloaded) return;
    const folder = associatedFolder(this.settings, path);
    if (folder === undefined) return;
    const relativePath = path.slice(folder ? folder.length + 1 : 0);
    const entry = this.app.vault.getAbstractFileByPath(path);
    const journal = `${folder ? `${folder}/` : ""}Tracking/Changements.md`;
    if ((!entry || entry instanceof TFolder) && !this.app.vault.getAbstractFileByPath(journal)) return;
    if (relativePath === "Tracking/Populate.md") this.explorerActions?.refresh();
    if (relativePath === "Tracking/Changements.md" || relativePath === "Tracking/Documents" || relativePath.startsWith("Tracking/Documents/") || relativePath === this.settings.archiveFolder || relativePath.startsWith(`${this.settings.archiveFolder}/`)) return;
    this.explorerActions?.refresh();
    const previous = this.documentTracking.get(folder);
    if (previous !== undefined) window.clearTimeout(previous);
    const folders = { ...this.settings };
    this.documentTracking.set(folder, window.setTimeout(() => {
      this.documentTracking.delete(folder);
      if (this.resetting || this.unloaded || folder && !(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) return;
      void this.workingDirectory(folder).then(cwd => trackDocuments(cwd, folders, this.configurationDirectory()))
        .catch(error => new Notice(errorText(error)));
    }, 250));
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
    if (this.sending || this.connecting || this.session.busy) throw new Error(t("waitForTheTaskToFinishBeforeChoosingContext"));
    const folder = this.settings.folder, chapter = this.revisionChapter;
    const draft = this.requestContext?.folder === folder && this.requestContext.choice.chapter === chapter ? this.requestContext.choice : { chapter, include: [], exclude: [] };
    new ContextModal(this.app, structuredClone(draft), async choice => {
      if (folder !== this.settings.folder || this.sending || this.connecting || this.session.busy) throw new Error(t("theFolderOrTaskChangedReopenContext"));
      const cwd = await this.refreshCorrections(chapter ?? undefined);
      validateContextChoice(choice, this.settings, chapter ?? undefined);
      const request = withContext(this.draft, choice);
      const dossier = chapter ? await buildSceneContext(cwd, this.settings, this.settings.codexVersions[cwd] ?? {}, chapter, request, taskPrompts, true) : null;
      const sources = dossier ? dossier.sources
        : (await readEditorialContext(cwd, this.settings, this.settings.codexVersions[cwd] ?? {}, undefined, request)).flatMap(page => (JSON.parse(page) as { sources: { path: string; role: string; content: string; reason?: string }[] }).sources);
      const catalogue = await projectSources(cwd, this.settings);
      const required = new Set([chapter, structurePath(this.settings), configPath(this.settings)]);
      const notes = new Map<string, ContextNote>();
      for (const note of catalogue) notes.set(note.path, { path: note.path, selected: false, characters: 0, reason: required.has(note.path) ? t("configurationRequiredToAssembleContext") : choice.exclude.includes(note.path) ? t("removedForThisRequest") : dossier?.omitted?.includes(note.path) ? t("excludedByTheReferenceBudget") : t("notAutomaticallySelectedForThisRequest"), required: required.has(note.path) });
      for (const source of sources) {
        if (!source.path.endsWith(".md") || ![this.settings.manuscriptFolder, this.settings.bibleFolder, this.settings.modelFolder, "Tracking"].some(root => source.path.startsWith(root + "/"))) continue;
        const note = notes.get(source.path);
        notes.set(source.path, { path: source.path, selected: true, characters: (note?.characters ?? 0) + source.content.length, reason: source.reason ?? SOURCE_REASONS[source.role] ?? source.role, required: required.has(source.path) });
      }
      for (const path of choice.exclude) if (!notes.has(path)) notes.set(path, { path, selected: false, characters: 0, reason: t("removedForThisRequest"), required: false });
      const configuration = await readProjectFile(cwd, configPath(this.settings));
      const config = configuration ? parseConfig(readData(configuration.text), this.settings) : null;
      return { notes: [...notes.values()].sort((a, b) => Number(b.selected) - Number(a.selected) || a.path.localeCompare(b.path, getLocale(), { numeric: true })), characters: sources.reduce((total, source) => total + source.content.length, 0), budget: chapter ? config?.maxCharacters : undefined, warnings: dossier?.warnings };
    }, choice => {
      if (folder !== this.settings.folder || this.session.busy || this.sending) throw new Error(t("theFolderOrTaskChangedReopenContext"));
      this.requestContext = choice.include.length || choice.exclude.length ? { folder, choice: structuredClone(choice) } : null;
      for (const view of this.views) view.update();
    }).open();
  }

  private contextForRequest(chapter?: string | null): ContextChoice | null {
    if (!this.requestContext) return null;
    if (this.requestContext.folder !== this.settings.folder || this.requestContext.choice.chapter !== (chapter ?? null)) throw new Error(t("theContextChoicesBelongToAnotherFolderOrChapter"));
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
    if (folder !== this.settings.folder) throw new Error(t("theWorkingFolderChangedReopenTheNovelView"));
    if (this.sending || this.connecting || this.session.busy) throw new Error(t("waitForTheTaskToFinishThenRefreshThe"));
    this.sending = true;
    try {
      const cwd = await this.refreshCorrections();
      return await this.correctionTask(async () => {
        const path = structurePath(this.settings), registry = await readProjectFile(cwd, path);
        const ensureCurrent = () => {
          if (folder !== this.settings.folder) throw new Error(t("theWorkingFolderChanged"));
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
    if (!node || this.session.busy || this.sending || this.connecting) throw new Error(t("openANoteAndWaitForTheTaskTo"));
    const cwd = await this.refreshCorrections();
    await this.correctionTask(async () => {
      this.structure = await syncStructure(cwd, this.settings, { decision: { path: node.path, value } }, this.configurationDirectory());
      const delivery = await collectChanges(cwd, this.settings, this.configurationDirectory());
      this.session.pendingChanges = delivery.pending.map(change => change.path);
      for (const view of this.views) view.update();
    });
  }

  get brainstormDirectory(): string | null {
    const prefix = this.settings.folder ? `${this.settings.folder}/` : "";
    const path = this.navigation.path;
    return path?.startsWith(prefix) ? brainstormFolder(path.slice(prefix.length), this.settings) : null;
  }

  get brainstormDocument(): string | null {
    const folder = this.brainstormDirectory;
    if (!folder) return null;
    const prefix = this.settings.folder ? `${this.settings.folder}/` : "";
    const selected = this.navigation.path?.slice(prefix.length);
    const candidates = [selected, ...this.session.items.slice().reverse().flatMap(item => item.modifiedPaths ?? [])];
    return candidates.find(path => path && path.toLowerCase().endsWith(".md") && brainstormFolder(path, this.settings) === folder
      && this.app.vault.getAbstractFileByPath(prefix + path) instanceof TFile) ?? null;
  }

  get revisionChapter(): string | null {
    if (this.brainstormDirectory) return null;
    const path = this.app.workspace.getActiveFile()?.path;
    const prefix = this.settings.folder ? `${this.settings.folder}/` : "";
    return path?.startsWith(prefix) ? chapterPath("/", this.settings, path.slice(prefix.length)) : null;
  }

  get revisionDocument(): string | null {
    if (this.brainstormDirectory) return this.brainstormDocument;
    const path = this.app.workspace.getActiveFile()?.path;
    const prefix = this.settings.folder ? `${this.settings.folder}/` : "";
    return path?.startsWith(prefix) ? revisionDocumentPath("/", this.settings, path.slice(prefix.length)) : null;
  }

  reactionFor(itemId: string): Reaction | undefined {
    return this.settings.reactions[reactionKey(this.settings.threadCwd, this.session.threadId, itemId)]?.value;
  }

  async react(itemId: string, value: Reaction, message: string): Promise<void> {
    await this.settingsWrite;
    if (this.sending || this.connecting || this.session.busy) throw new Error(t("waitForTheTaskOrMessageToFinishBefore"));
    const threadId = this.session.threadId;
    const exchange = reactionExchanges(this.session.turns).get(itemId);
    if (!threadId || !exchange) throw new Error(t("thisFinalAnswerIsNoLongerAvailableInThe"));
    this.sending = true;
    try {
      const cwd = await this.refreshCorrections();
      this.checkSavedDirectory(cwd);
      const folders = this.settings;
      const key = reactionKey(cwd, threadId, itemId);
      await recordInput(cwd,folders,`Réaction : ${value}\nRéponse concernée : ${itemId}\n\n${message}`,undefined,this.configurationDirectory());
      let rating = folders.reactions[key];
      await this.correctionTask(async () => {
        rating = await recordReaction(cwd, folders, threadId, exchange, value, message, rating, (path, content) => this.checkEditor(path, content));
      });
      await this.saveSettings({ reactions: { ...this.settings.reactions, [key]: rating } });
      if (this.draft === message) this.draft = "";
      for (const view of this.views) view.update();
      new Notice(t("reactionAndFeedbackAddedToTheTrackingNotes"));
    } finally { this.sending = false; this.releaseNoteLocks(); }
  }

  get highlightedDocument(): string | null {
    const chapter = this.revisionDocument;
    const key = `${this.settings.folder ? `${this.settings.folder}/` : ""}${chapter}`;
    const snapshot = this.settings.revisionHighlights[key];
    return chapter && snapshot && snapshot.before !== snapshot.after ? chapter : null;
  }

  get acceptanceChapter(): string | null {
    return this.revisionChapter === this.highlightedDocument ? this.highlightedDocument : null;
  }

  async clearRevisionHighlights(chapter: string): Promise<void> {
    const folder = this.settings.folder;
    await this.settingsWrite;
    if (this.sending || this.connecting || this.session.busy) throw new Error(t("waitForTheTaskOrMessageToFinishBefore2"));
    if (folder !== this.settings.folder || chapter !== this.highlightedDocument) throw new Error(t("theHighlightedChapterChangedReturnToTheChapterTo"));
    this.sending = true;
    try {
      await this.saveSettings(settings => {
        const revisionHighlights = { ...settings.revisionHighlights };
        delete revisionHighlights[`${folder ? `${folder}/` : ""}${chapter}`];
        return { revisionHighlights };
      });
    } finally {
      this.sending = false;
      for (const view of this.views) view.update();
    }
  }

  async acceptRevision(message: string, chapter: string): Promise<void> {
    await this.settingsWrite;
    if (this.sending || this.connecting || this.session.busy) throw new Error(t("waitForTheTaskOrMessageToFinishBefore3"));
    if (chapter !== this.acceptanceChapter) throw new Error(t("noChangesToAcceptInThisChapter"));
    this.sending = true;
    try {
      const cwd = await this.refreshCorrections(chapter);
      const folders = this.settings;
      const key = `${folders.folder ? `${folders.folder}/` : ""}${chapter}`;
      const snapshot = folders.revisionHighlights[key];
      if (!snapshot) throw new Error(t("thisChapterSChangesHaveChangedReviewThemBefore"));
      await recordInput(cwd,folders,`Accepter les modifications de ${chapter}.\n\n${message}`,undefined,this.configurationDirectory());
      this.lockNote(chapter);
      await this.correctionTask(async () => { await recordAcceptance(cwd, folders, chapter, snapshot, message, (path, content) => this.checkEditor(path, content)); });
      await this.saveSettings(settings => {
        const revisionHighlights = { ...settings.revisionHighlights };
        delete revisionHighlights[key];
        return { revisionHighlights };
      });
      if (this.draft === message) this.draft = "";
      for (const view of this.views) view.update();
      new Notice(t("changesAcceptedHighlightsClearedAndFeedbackRecorded"));
    } finally { this.sending = false; this.releaseNoteLocks(); }
  }

  async refreshCorrections(chapter?: string, activate = true): Promise<string> {
    await this.settingsWrite;
    const folders = this.settings;
    const session = this.projectSession(folders.folder);
    if (this.resetting || session.busy) return this.workingDirectory(folders.folder);
    if (!activate) {
      const root = await this.workingDirectory(folders.folder);
      let entries: string[];
      try { entries = await readdir(join(root, "Tracking")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return root; throw error; }
      if (!entries.length) return root;
    }
    const cwd = await this.prepareProject(folders.folder, folders);
    await this.correctionTask(async () => {
      if (session.busy || this.resetting) return;
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
        if (other && other.getViewData() !== view.getViewData()) throw new Error(t("twoEditorsHaveDifferentCorrectionsForSaveTheVersion", { value1: path }));
        pending.set(path, view);
      });
      for (const view of pending.values()) await view.save();
      await refreshCorrections(cwd, folders, versions);
      const structure = await syncStructure(cwd, folders, {}, this.configurationDirectory());
      const delivery = await collectChanges(cwd, folders, this.configurationDirectory());
      session.pendingChanges = delivery.pending.map(change => change.path);
      if (this.settings.folder === folders.folder) {
        this.structure = structure;
        for (const view of this.views) view.update();
      }
    });
    return cwd;
  }

  async connect(model?: string): Promise<void> {
    if (visibleFolder(this.settings, this.navigation.path, false) !== this.settings.folder) return;
    const project = this.projectState(this.settings.folder);
    const session = this.projectSession(project.folder);
    if (model === undefined && (session.connected || session.busy)) return;
    if (project.connecting || this.sending) {
      if (model !== undefined) throw new Error(t("waitForTheConnectionOrMessageToFinishBefore"));
      return project.connecting ?? undefined;
    }
    project.connecting = (async () => {
      await this.settingsWrite;
      if (this.unloaded) return;
      const settings = this.projectSettings(project.folder);
      const cwd = await this.workingDirectory(settings.folder);
      if (this.unloaded || project.folder !== settings.folder) return;
      this.checkSavedDirectory(cwd, settings);
      await session.connect(settings.codexPath, cwd, settings.threadId, model);
    })();
    try { await project.connecting; }
    finally { project.connecting = null; this.explorerActions?.refresh(); }
  }

  async send(text: string, chapter?: string, wholeChapterRequested = false): Promise<void> {
    const currentChapter = this.revisionChapter;
    const brainstorm = this.brainstormDirectory;
    if (wholeChapterRequested && !chapter) throw new Error(t("openTheChapterToStartOver"));
    if (!chapter && currentChapter && !this.session.busy && !this.session.brainstormActive && fullRewriteRequested(text, currentChapter)) chapter = currentChapter;
    if (this.sending || this.connecting) throw new Error(t("aMessageOrConnectionIsAlreadyInProgressYour"));
    if (chapter && this.session.busy) throw new Error(t("waitForTheTaskToFinishBeforeRevisingThe2"));
    const activePath = this.app.workspace.getActiveFile()?.path;
    this.sending = true;
    try {
      if (!this.session.busy) {
        if (chapter) this.lockNote(chapter);
        else if (!brainstorm) {
          const prefix = this.settings.folder ? `${this.settings.folder}/` : "";
          if (activePath?.startsWith(prefix)) this.lockNote(activePath.slice(prefix.length));
        }
      }
      await this.settingsWrite;
      const cwd = this.session.busy ? await this.workingDirectory() : await this.refreshCorrections(chapter);
      this.checkSavedDirectory(cwd);
      const versions = this.settings.codexVersions[cwd] ?? {};
      const source = chapter ? await readProjectFile(cwd, chapter) : null;
      if (chapter && !source) throw new Error(t("documentNotFound", { value1: chapter }));
      const revision = chapter && source ? planRevision(chapter, source.text, versions[chapter], text, true) : undefined;
      const protections = this.session.busy || brainstorm ? [] : await revisionProtections(cwd, this.settings, versions, chapter);
      const message = chapter ? await revisionPrompt(cwd, this.settings, chapter, versions, text, revision)
        : brainstorm ? withBrainstorm(text, { folder: brainstorm }) : text;
      const context = this.session.busy || brainstorm ? null : this.contextForRequest(chapter ? chapterPath(cwd, this.settings, chapter) : currentChapter);
      await this.session.send(withContext(message, context), this.settings.codexPath, cwd, this.settings.threadId, revision, protections);
      if (context && this.requestContext?.choice === context) this.requestContext = null;
      if (this.draft === text) this.draft = "";
      for (const view of this.views) view.update();
    } finally { this.sending = false; this.releaseNoteLocks(); }
  }

  async compareVersions(chapter: string): Promise<void> {
    if (this.sending || this.connecting || this.session.busy) throw new Error(t("waitForTheTaskToFinishBeforeComparingVersions"));
    const cwd = await this.refreshCorrections(chapter), folders = { ...this.settings };
    const previous = await readProjectFile(cwd, chapter);
    if (!previous) throw new Error(t("chapterNotFound2"));
    const versions = await comparisonVersions(cwd, folders, chapter, previous.text);
    new ComparisonModal(this.app, versions, async (content, description) => {
      if (this.sending || this.connecting || this.session.busy) throw new Error(t("waitForTheTaskToFinishBeforeApplyingThis"));
      const ensureCurrent = () => {
        if (folders.folder !== this.settings.folder) throw new Error(t("theWorkingFolderChanged"));
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
          await this.saveSettings(settings => {
            const revisionHighlights = { ...settings.revisionHighlights };
            if (content !== previous.text) revisionHighlights[key] = { before: previous.text, after: content };
            return { codexVersions: { ...settings.codexVersions, [cwd]: { ...settings.codexVersions[cwd], [chapter]: content } }, revisionHighlights };
          });
        });
        try {
          const quote = (text: string) => text.split("\n").map(line => `    ${line}`).join("\n");
          const changes = diffToGroups(previous.text, content).map(change => `### Avant\n\n${quote(change.delText)}\n\n### Retenu\n\n${quote(change.insText ?? "")}`).join("\n\n");
          await recordFeedback(cwd, folders, { kind: "reaction", id: randomUUID(), title: t("versionSelection", { value1: chapter }),
            body: `${description}\n\nChoix explicite de l’auteur. Seuls les changements ci-dessous sont retenus. Ce choix ne constitue pas une approbation générale du chapitre ni une règle de style.\n\n${changes || t("noTextChanges")}`,
            summary: t("theAuthorSelectedAVersionOfReviewTheRetained", { value1: chapter }) },
            (path, text) => this.checkEditor(path, text));
        } catch (error) { new Notice(t("textAppliedAndArchivedButRecordingTheChoiceFailed", { value1: errorText(error) }), 12000); }
        new Notice(t("versionAppliedThePreviousTextIsPreservedInThe"));
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
    if (folder !== this.settings.folder) throw new Error(t("theWorkingFolderChangedSelectThePassageAgain"));
    if (this.sending || this.connecting || this.session.busy) throw new Error(t("waitForTheTaskToFinishBeforeRunningAn"));
    this.sending = true;
    try {
      const cwd = await this.refreshCorrections(request.path);
      if (folder !== this.settings.folder || chapterPath(cwd, this.settings, request.path) !== request.path) throw new Error(t("theFolderOrSelectedChapterChanged"));
      this.checkSavedDirectory(cwd);
      const source = await readProjectFile(cwd, request.path);
      if (!source) throw new Error(t("theSelectedChapterNoLongerExists"));
      const revision = selectionPlan(request, source.text);
      this.checkEditor(request.path, source.text);
      if (!revision.selection?.readOnly) this.lockNote(request.path);
      const context = this.contextForRequest(request.path);
      await this.session.send(withContext(selectionPrompt(request), context), this.settings.codexPath, cwd, this.settings.threadId, revision);
      if (context && this.requestContext?.choice === context) this.requestContext = null;
      await this.openChat(true);
    } finally { this.sending = false; this.releaseNoteLocks(); }
  }

  async resetActiveProject(): Promise<void> {
    if (!this.settings.debugMode) throw new Error(t("debugModeRequired"));
    if (this.resetting || this.sending || this.connecting || this.populatePending || this.session.busy) throw new Error(t("waitForTheTaskToFinishOrUseStop"));
    this.resetting = true;
    this.sending = true;
    for (const view of this.views) view.update();
    try {
      await this.settingsWrite;
      await this.projectWrite;
      const cwd = await this.workingDirectory();
      const folder = this.settings.folder;
      const layout = PROJECT_FOLDER_KEYS.map(key => this.settings[key]).join("\n");
      const confirmation = new ResetProjectModal(this.app, folder || cwd, this.settings);
      confirmation.open();
      if (!await confirmation.result) return;
      if (!this.settings.debugMode || this.settings.folder !== folder || PROJECT_FOLDER_KEYS.map(key => this.settings[key]).join("\n") !== layout
        || await this.workingDirectory() !== cwd) throw new Error(t("resetProjectChanged"));
      await this.session.newConversation();
      const prefix = this.settings.folder ? `${this.settings.folder}/` : "";
      const editors: MarkdownView[] = [];
      this.app.workspace.iterateAllLeaves(leaf => {
        const view = leaf.view;
        if (view instanceof MarkdownView && view.file && [this.settings.bibleFolder, this.settings.manuscriptFolder, this.settings.archiveFolder, "Tracking", "Context", "_Archives"]
          .some(name => view.file!.path.normalize("NFC").toLowerCase().startsWith(`${prefix}${name}/`.normalize("NFC").toLowerCase()))) editors.push(view);
      });
      for (const view of editors) await view.save();
      for (const view of editors) view.leaf.detach();
      const timer = this.documentTracking.get(folder);
      if (timer !== undefined) { window.clearTimeout(timer); this.documentTracking.delete(folder); }
      await waitForTracking(cwd);
      await this.correctionTask(() => resetProject(cwd, this.settings, this.configurationDirectory(), {
        mkdir: async path => {
          const target = `${prefix}${path}`;
          if (!this.app.vault.getAbstractFileByPath(target)) await this.app.vault.createFolder(target);
        },
        remove: async path => {
          const source = this.app.vault.getAbstractFileByPath(`${prefix}${path}`);
          if (!(source instanceof TFolder)) throw new Error(t("resetNotDirectory", { name: path }));
          await this.app.vault.delete(source, true);
        },
      }));
      await this.saveSettings(settings => {
        const codexVersions = { ...settings.codexVersions };
        delete codexVersions[cwd];
        const revisionHighlights = Object.fromEntries(Object.entries(settings.revisionHighlights)
          .filter(([path]) => ![settings.bibleFolder, settings.manuscriptFolder].some(name => path.startsWith(`${prefix}${name}/`))));
        const reactions = Object.fromEntries(Object.entries(settings.reactions).filter(([key]) => {
          try { return (JSON.parse(key) as unknown[])[0] !== cwd; } catch { return true; }
        }));
        return { codexVersions, revisionHighlights, reactions };
      });
      this.structure = null;
      this.requestContext = null;
      this.draft = "";
      this.session.pendingChanges = [];
      this.session.status = "";
      new Notice(t("projectResetComplete"));
    } finally {
      this.resetting = false;
      this.sending = false;
      this.releaseNoteLocks();
      this.explorerActions?.refresh();
      for (const view of this.views) view.update();
    }
  }

  private async populateWorkshop(folder: string): Promise<void> {
    if (this.populatePending || this.sending || this.projects.get(folder)?.connecting || this.projects.get(folder)?.session?.busy) throw new Error(t("waitForTheTaskToFinishBeforePopulatingThe"));
    this.populatePending = true;
    this.explorerActions?.refresh();
    try {
      const pending = await newModelSources(await this.workingDirectory(folder), this.settings);
      if (!pending.length) {
        new PopulateNotice(this.app, `${folder ? `${folder}/` : ""}${this.settings.modelFolder}`).open();
        return;
      }
      await this.navigation.run(`${folder ? `${folder}/` : ""}${this.settings.modelFolder}`, async current => {
        if (this.unloaded || !current()) return;
        await this.saveSettings({ folder });
        if (this.unloaded || !current()) return;
        if (this.sending || this.connecting || this.session.busy) throw new Error(t("waitForTheTaskToFinishBeforePopulatingThe"));
        this.sending = true;
        try {
          const cwd = await this.refreshCorrections();
          if (this.unloaded || !current()) return;
          this.checkSavedDirectory(cwd);
          await this.openChat(true);
          if (this.unloaded || !current()) return;
          const instruction = POPULATE_PREFIX + renderAgent(populateTemplate, this.settings);
          await this.session.send(instruction, this.settings.codexPath, cwd, this.settings.threadId);
        } finally { this.sending = false; }
      });
    } finally { this.populatePending = false; this.explorerActions?.refresh(); }
  }

  async refreshNarrativeState(): Promise<void> {
    if (this.session.busy || this.sending || this.connecting) throw new Error(t("waitForTheTaskToFinishBeforeUpdatingStates"));
    this.sending = true;
    try {
      await this.settingsWrite;
      const cwd = await this.workingDirectory();
      const pending = await pendingStates(cwd, this.settings);
      if (!pending.length) { new Notice(t("narrativeStatesAreUpToDate")); return; }
      await this.session.send(maintenancePrompt(pending), this.settings.codexPath, cwd, this.settings.threadId);
    } finally { this.sending = false; }
  }

  async retry(): Promise<void> {
    await this.settingsWrite;
    if (this.sending || this.connecting || this.session.busy) throw new Error(t("waitForTheTaskOrConnectionToFinishBefore"));
    this.sending = true;
    try {
      const cwd = await this.workingDirectory();
      this.checkSavedDirectory(cwd);
      await this.session.retry(this.settings.codexPath, cwd, this.settings.threadId);
    } finally { this.sending = false; this.releaseNoteLocks(); }
  }

  private lockNote(path: string, folder = this.settings.folder): void {
    if (!path || path.split("/").includes("..")) return;
    const key = `${folder ? `${folder}/` : ""}${path}`.normalize("NFC").toLowerCase();
    const locks = this.projectState(folder).lockedNotes;
    if (locks.has(key)) return;
    locks.add(key);
    this.highlights.refresh();
  }

  private releaseNoteLocks(folder = this.settings.folder): void {
    const project = this.projects.get(folder);
    if (!project || project.session?.busy || folder === this.settings.folder && this.sending || !project.lockedNotes.size) return;
    project.lockedNotes.clear();
    this.highlights.refresh();
  }

  private checkSavedDirectory(cwd: string, settings = this.settings): void {
    if (settings.threadId && settings.threadCwd !== cwd) {
      throw new Error(t("theConversationFolderChangedCreateANewConversationFor"));
    }
  }

  private checkEditor(path: string, content: string, folder = this.settings.folder): void {
    const vaultPath = folder ? `${folder}/${path}` : path;
    this.app.workspace.iterateAllLeaves(leaf => {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === vaultPath && view.getViewData() !== content) {
        throw new Error(t("noteHasEditorChangesWaitForThemToBe", { value1: path }));
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
    if (location === ".." || location.startsWith("../") || isAbsolute(location)) throw new Error(t("thisFileIsOutsideTheVault"));
    const file = this.app.vault.getAbstractFileByPath(location);
    if (!(file instanceof TFile)) throw new Error(t("fileNotFoundInObsidian", { value1: location }));
    await this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(file);
  }
}
