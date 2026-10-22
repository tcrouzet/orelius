import { FileSystemAdapter, MarkdownView, Notice, Plugin, TFile, TFolder } from "obsidian";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { CodexClient, errorText, findCodex } from "./codex";
import { ChatSession } from "./session";
import { archiveChanges, prepareProject } from "./archives";
import { applySettings, loadSettings, PROJECT_FOLDER_KEYS, visibleFolder, type ProjectFolders, type SettingsChanges } from "./settings";
import { OreliusSettingTab } from "./settings-tab";
import { OreliusView, VIEW_TYPE } from "./chat-view";
import { generateAgent, renderAgent } from "../../generate-agent.ts";
import agentTemplate from "../../prompts/agent.md";

export default class OreliusPlugin extends Plugin {
  settings = loadSettings(undefined);
  session!: ChatSession;
  draft = "";
  private views = new Set<OreliusView>();
  private settingsWrite = Promise.resolve();
  private projectWrite = Promise.resolve();
  private navigation = Promise.resolve();
  private connecting: Promise<void> | null = null;
  private sending = false;
  private openedFile: string | null = null;
  private unloaded = false;
  private codexTest: CodexClient | null = null;

  async onload(): Promise<void> {
    this.settings = loadSettings(await this.loadData());
    this.session = new ChatSession(() => {
      for (const view of this.views) view.update();
    }, (threadId, cwd) => this.saveSettings({ threadId, threadCwd: cwd }),
    (cwd, changes) => archiveChanges(cwd, changes, (path, content) => {
      const vaultPath = this.settings.folder ? `${this.settings.folder}/${path}` : path;
      this.app.workspace.iterateAllLeaves(leaf => {
        const view = leaf.view;
        if (view instanceof MarkdownView && view.file?.path === vaultPath && view.getViewData() !== content) {
          throw new Error(`La note ${path} a des modifications dans l’éditeur. Attendez leur enregistrement, puis relancez la demande.`);
        }
      });
    }, this.settings.archiveFolder), () => ({ ...this.settings, agentInstructions: renderAgent(agentTemplate, this.settings) }));
    this.registerView(VIEW_TYPE, leaf => new OreliusView(leaf, this));
    this.addSettingTab(new OreliusSettingTab(this));
    this.addCommand({ id: "open-chat", name: "Ouvrir le chat", callback: () => { void this.openChat(); } });
    this.addRibbonIcon("messages-square", "Ouvrir Orelius", () => { void this.openChat(); });
    this.openedFile = this.app.workspace.getActiveFile()?.path ?? null;
    this.registerEvent(this.app.workspace.on("file-open", file => {
      if (file && file.path !== this.openedFile) {
        this.openedFile = file.path;
        this.navigate(file.path);
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

  private navigate(path: string): void {
    this.navigation = this.navigation.then(async () => {
      await this.settingsWrite;
      if (this.unloaded) return;
      const folder = visibleFolder(this.settings, path, Boolean(this.session.busy || this.connecting || this.sending));
      if (folder === undefined) {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) leaf.detach();
        return;
      }
      if (folder !== this.settings.folder) await this.saveSettings({ folder });
      if (this.unloaded) return;
      await this.openChat(false);
      if (!this.unloaded && this.settings.threadId && !this.session.connected && !this.session.busy) {
        void this.connect().catch(error => { if (!this.unloaded) new Notice(errorText(error)); });
      }
    }).catch(error => { if (!this.unloaded) new Notice(errorText(error)); });
  }

  onunload(): void {
    this.unloaded = true;
    this.codexTest?.stop();
    this.codexTest = null;
    this.session.disconnect();
  }

  async openChat(focus = true): Promise<void> {
    try {
      await this.settingsWrite;
      if (this.unloaded) return;
      await this.prepareProject();
      const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0] ?? this.app.workspace.getRightLeaf(false);
      if (!leaf) throw new Error("Impossible d’ouvrir un panneau latéral.");
      await leaf.setViewState({ type: VIEW_TYPE, active: focus });
      await this.app.workspace.revealLeaf(leaf);
    } catch (error) { new Notice(errorText(error)); }
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
      await generateAgent(cwd, { ...folders, folder }, agentTemplate);
      return cwd;
    });
    this.projectWrite = preparation.then(() => {}, () => {});
    return preparation;
  }

  async connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.sending) return;
    this.connecting = (async () => {
      await this.settingsWrite;
      const cwd = await this.prepareProject();
      if (this.unloaded) return;
      this.checkSavedDirectory(cwd);
      await this.session.connect(this.settings.codexPath, cwd, this.settings.threadId);
    })();
    try { await this.connecting; }
    finally { this.connecting = null; }
  }

  async send(text: string): Promise<void> {
    await this.settingsWrite;
    if (this.sending || this.connecting || this.session.busy) throw new Error("Attendez la fin de la tâche ou utilisez Arrêter.");
    this.sending = true;
    try {
      const cwd = await this.prepareProject();
      this.checkSavedDirectory(cwd);
      await this.session.send(text, this.settings.codexPath, cwd, this.settings.threadId);
      this.draft = "";
      for (const view of this.views) view.update();
    } finally { this.sending = false; }
  }

  private checkSavedDirectory(cwd: string): void {
    if (this.settings.threadId && this.settings.threadCwd !== cwd) {
      throw new Error("Le dossier de la conversation a changé. Créez une nouvelle conversation pour ce dossier.");
    }
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
