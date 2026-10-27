import { FileSystemAdapter, FileView, MarkdownView, Notice, Plugin, TFile, TFolder } from "obsidian";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { CodexClient, errorText, findCodex } from "./codex";
import { ChatSession } from "./session";
import { prepareProject } from "./archives";
import { prepareBible } from "./bible";
import { saveConversation } from "./conversation";
import { archiveWithCorrections, captureCodexVersions, chapterPath, prepareCorrections, refreshCorrections, revisionPrompt } from "./corrections";
import { applySettings, loadSettings, PROJECT_FOLDER_KEYS, visibleFolder, type ProjectFolders, type SettingsChanges } from "./settings";
import { OreliusSettingTab } from "./settings-tab";
import { OreliusView, VIEW_TYPE } from "./chat-view";
import { ChatNavigation } from "./navigation";
import { generateAgent, renderAgent } from "../../generate-agent.ts";
import agentTemplate from "../../prompts/agent.md";
import { readProjectFile } from "./project-files.ts";
import { planRevision, type RevisionPlan } from "./revision.ts";
import { revisionHighlights } from "./revision-highlights";

export default class OreliusPlugin extends Plugin {
  settings = loadSettings(undefined);
  session!: ChatSession;
  draft = "";
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

  async onload(): Promise<void> {
    this.settings = loadSettings(await this.loadData());
    this.registerEditorExtension(this.highlights.extension);
    this.session = new ChatSession(() => {
      for (const view of this.views) view.update();
    }, (threadId, cwd) => this.saveSettings({ threadId, threadCwd: cwd }),
    (cwd, changes) => archiveWithCorrections(cwd, this.settings, changes, this.settings.codexVersions[cwd] ?? {},
      (path, content) => this.checkEditor(path, content)),
    () => ({ ...this.settings, agentInstructions: renderAgent(agentTemplate, this.settings),
      checkEditor: (path, content) => this.checkEditor(path, content) }),
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
    this.registerView(VIEW_TYPE, leaf => new OreliusView(leaf, this));
    this.addSettingTab(new OreliusSettingTab(this));
    this.addCommand({ id: "open-chat", name: "Ouvrir le chat", callback: () => { void this.openChat(); } });
    this.addRibbonIcon("messages-square", "Ouvrir Orelius", () => { void this.openChat(); });
    this.navigation = new ChatNavigation(this.app.workspace.getActiveFile()?.path ?? null);
    this.registerEvent(this.app.workspace.on("file-open", file => {
      const activeFile = this.app.workspace.getActiveViewOfType(FileView)?.file;
      if (!this.hidingChat && file && activeFile?.path === file.path && file.path !== this.navigation.path) {
        this.navigate(file.path);
      }
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", leaf => {
      if (this.hidingChat) return;
      if (leaf?.getRoot() === this.app.workspace.rootSplit) {
        const path = leaf.view instanceof FileView ? leaf.view.file?.path ?? null : null;
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
    this.codexTest?.stop();
    this.codexTest = null;
    this.session.disconnect();
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

  attach(view: OreliusView): void { this.views.add(view); }
  detach(view: OreliusView): void { this.views.delete(view); }

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
      if (previous.revisionHighlights !== next.revisionHighlights) this.highlights.refresh();
      if (previous.showActivity !== next.showActivity) for (const view of this.views) view.update();
      if (changedConnection) {
        if (changedFolder) {
          this.session.items = [];
          this.session.threadId = "";
        }
        this.session.disconnect();
      }
    });
    this.settingsWrite = write.catch(() => {});
    return write;
  }

  async testCodex(): Promise<string> {
    if (this.codexTest) throw new Error("Un test de connexion est déjà en cours.");
    const client = new CodexClient({
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
      client.stop();
      if (this.codexTest === client) this.codexTest = null;
    }
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
      await prepareProject(cwd, folders);
      await prepareBible(cwd, folders);
      await generateAgent(cwd, { ...folders, folder }, agentTemplate);
      await this.correctionTask(() => prepareCorrections(cwd, folders));
      return cwd;
    });
    this.projectWrite = preparation.then(() => {}, () => {});
    return preparation;
  }

  private correctionTask(action: () => Promise<void>): Promise<void> {
    const work = this.correctionWrite.then(action);
    this.correctionWrite = work.catch(() => {});
    return work;
  }

  get revisionChapter(): string | null {
    const path = this.app.workspace.getActiveFile()?.path;
    const prefix = this.settings.folder ? `${this.settings.folder}/` : "";
    return path?.startsWith(prefix) ? chapterPath("/", this.settings, path.slice(prefix.length)) : null;
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
        if (!Object.prototype.hasOwnProperty.call(versions, path) && path !== chapter && path !== `${folders.bibleFolder}/suivi.md`
          && path !== `${folders.bibleFolder}/Suivi/Connaissances.md`) return;
        const other = pending.get(path);
        if (other && other.getViewData() !== view.getViewData()) throw new Error(`Deux éditeurs ont des corrections différentes pour ${path}. Enregistrez la version souhaitée.`);
        pending.set(path, view);
      });
      for (const view of pending.values()) await view.save();
      await refreshCorrections(cwd, folders, versions);
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

  async send(text: string, chapter?: string): Promise<void> {
    await this.settingsWrite;
    if (this.sending || this.connecting) throw new Error("Un envoi ou une connexion est déjà en cours. Votre message est conservé.");
    if (chapter && this.session.busy) throw new Error("Attendez la fin de la tâche pour réviser le chapitre avec ses dernières corrections.");
    this.sending = true;
    try {
      const cwd = this.session.busy ? await this.workingDirectory() : await this.refreshCorrections(chapter);
      this.checkSavedDirectory(cwd);
      const versions = this.settings.codexVersions[cwd] ?? {};
      const source = chapter ? await readProjectFile(cwd, chapter) : null;
      if (chapter && !source) throw new Error(`Chapitre introuvable : ${chapter}.`);
      const revision = chapter && source ? planRevision(chapter, source.text, versions[chapter]) : undefined;
      const protections: RevisionPlan[] = [];
      if (!this.session.busy) for (const [path, baseline] of Object.entries(versions)) {
        if (path === chapter || chapterPath(cwd, this.settings, path) !== path) continue;
        const current = await readProjectFile(cwd, path);
        if (current && (current.text !== baseline || /\(\(\([\s\S]*?\)\)\)|~~[\s\S]*?~~/.test(current.text))) {
          protections.push(planRevision(path, current.text, baseline));
        }
      }
      const message = chapter ? await revisionPrompt(cwd, this.settings, chapter, versions, text, revision) : text;
      await this.session.send(message, this.settings.codexPath, cwd, this.settings.threadId, revision, protections);
      if (this.draft === text) this.draft = "";
      for (const view of this.views) view.update();
    } finally { this.sending = false; }
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

  async openFile(path: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return;
    const cwd = await this.workingDirectory();
    const root = await realpath(adapter.getBasePath());
    const target = await realpath(resolve(cwd, path));
    const location = relative(root, target);
    if (location === ".." || location.startsWith("../") || isAbsolute(location)) throw new Error("Ce fichier est extérieur au coffre.");
    const file = this.app.vault.getAbstractFileByPath(location);
    if (!(file instanceof TFile)) throw new Error(`Fichier introuvable dans Obsidian : ${location}`);
    await this.app.workspace.getLeaf(false).openFile(file);
  }
}
