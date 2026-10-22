import { Component, ItemView, MarkdownRenderer, type WorkspaceLeaf } from "obsidian";
import type OreliusPlugin from "./main";
import { errorText, object, type RpcObject, type ServerRequest } from "./codex";
import type { ChatItem } from "./session";

export const VIEW_TYPE = "orelius-chat";

export class OreliusView extends ItemView {
  private statusEl!: HTMLElement;
  private folderEl!: HTMLElement;
  private messagesEl!: HTMLElement;
  private requestsEl!: HTMLElement;
  private input!: HTMLTextAreaElement;
  private sendButton!: HTMLButtonElement;
  private stopButton!: HTMLButtonElement;
  private connectButton!: HTMLButtonElement;
  private newButton!: HTMLButtonElement;
  private notice!: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private rendered = new Map<string, { text: string; paths: string; element: HTMLElement; component: Component }>();
  private requestKey = "";
  private active = false;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: OreliusPlugin) { super(leaf); }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Orelius"; }
  getIcon(): string { return "messages-square"; }

  async onOpen(): Promise<void> {
    this.active = true;
    const root = this.contentEl;
    root.empty();
    root.addClass("orelius-chat");
    const header = root.createDiv({ cls: "orelius-header" });
    header.createEl("h4", { text: "Orelius" });
    this.folderEl = header.createDiv({ cls: "orelius-folder" });
    this.statusEl = header.createDiv({ cls: "orelius-status", attr: { role: "status" } });
    const actions = header.createDiv({ cls: "orelius-actions" });
    this.connectButton = actions.createEl("button", { text: "Connecter" });
    this.connectButton.onclick = () => { void this.run(() => this.plugin.connect()); };
    this.newButton = actions.createEl("button", { text: "Nouvelle conversation" });
    this.newButton.onclick = () => { void this.run(() => this.plugin.session.newConversation()); };
    this.messagesEl = root.createDiv({ cls: "orelius-messages", attr: { role: "log", "aria-label": "Conversation avec Codex" } });
    this.requestsEl = root.createDiv({ cls: "orelius-requests" });
    const composer = root.createDiv({ cls: "orelius-composer" });
    this.notice = composer.createDiv({ cls: "orelius-error", attr: { role: "alert" } });
    const label = composer.createEl("label", { text: "Votre message" });
    this.input = label.createEl("textarea", { attr: { rows: "4", placeholder: "Écrire à Codex…" } });
    this.input.value = this.plugin.draft;
    this.input.oninput = () => { this.plugin.draft = this.input.value; this.update(); };
    this.input.onkeydown = event => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing) {
        event.preventDefault();
        void this.send();
      }
    };
    const buttons = composer.createDiv({ cls: "orelius-actions" });
    this.sendButton = buttons.createEl("button", { text: "Envoyer", cls: "mod-cta" });
    this.sendButton.onclick = () => { void this.send(); };
    this.stopButton = buttons.createEl("button", { text: "Arrêter" });
    this.stopButton.onclick = () => { void this.run(() => this.plugin.session.interrupt()); };
    composer.createEl("small", { text: "⌘/Ctrl + Entrée pour envoyer · originaux archivés avant modification" });
    this.plugin.attach(this);
    this.render();
    if (this.plugin.settings.threadId && !this.plugin.session.connected && !this.plugin.session.busy) {
      void this.run(() => this.plugin.connect());
    }
  }

  async onClose(): Promise<void> {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.clearMessages();
    this.plugin.detach(this);
    this.contentEl.removeClass("orelius-chat");
  }

  update(): void {
    if (!this.active) return;
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.render(); }, 60);
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.notice?.setText("");
    try { await action(); }
    catch (error) { this.notice?.setText(errorText(error)); }
    this.update();
  }

  private async send(): Promise<void> {
    const text = this.input.value;
    if (!text.trim() || this.plugin.session.busy) return;
    await this.run(async () => {
      await this.plugin.send(text);
      this.input.value = "";
    });
  }

  private render(): void {
    const session = this.plugin.session;
    if (this.input.value !== this.plugin.draft) this.input.value = this.plugin.draft;
    this.statusEl.setText(session.status);
    this.folderEl.setText(this.plugin.settings.folder || "Racine du coffre");
    this.sendButton.disabled = session.busy || !this.input.value.trim();
    this.stopButton.disabled = !session.busy;
    this.connectButton.disabled = session.busy || session.connected;
    this.newButton.disabled = session.busy;
    this.input.disabled = session.busy;
    const atBottom = this.messagesEl.scrollHeight - this.messagesEl.scrollTop - this.messagesEl.clientHeight < 80;
    if (!session.items.length) {
      this.clearMessages();
      this.messagesEl.createEl("p", { cls: "orelius-empty", text: `Posez une question ou demandez une modification. Les originaux des fichiers modifiés sont conservés dans ${this.plugin.settings.archiveFolder} à la racine du projet.` });
    } else {
      this.messagesEl.querySelector(".orelius-empty")?.remove();
      const visibleIds = new Set(session.items.map(item => item.id));
      for (const [id, rendered] of this.rendered) {
        if (!visibleIds.has(id)) {
          this.removeChild(rendered.component);
          rendered.element.remove();
          this.rendered.delete(id);
        }
      }
      for (const item of session.items) this.renderItem(item);
    }
    const requestKey = JSON.stringify(session.requests);
    if (requestKey !== this.requestKey) {
      this.requestKey = requestKey;
      this.requestsEl.empty();
      for (const request of session.requests) this.renderRequest(request);
    }
    if (atBottom) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private renderItem(item: ChatItem): void {
    let rendered = this.rendered.get(item.id);
    const paths = JSON.stringify(item.paths);
    if (rendered?.text === item.text && rendered.paths === paths) return;
    if (rendered) {
      this.removeChild(rendered.component);
      rendered.element.empty();
    } else {
      const element = this.messagesEl.createEl("article", { cls: `orelius-message orelius-${item.role}` });
      rendered = { text: "", paths: "", element, component: new Component() };
      this.rendered.set(item.id, rendered);
    }
    const component = new Component();
    rendered.component = component;
    rendered.text = item.text;
    rendered.paths = paths;
    this.addChild(component);
    const element = rendered.element;
    element.createEl("strong", { cls: "orelius-role", text: item.role === "user" ? "Vous" : item.role === "assistant" ? "Codex" : "Activité" });
    const body = element.createDiv({ cls: "orelius-message-body" });
    if (item.role === "activity") body.createEl("pre", { text: item.text });
    else {
      const folder = this.plugin.settings.folder;
      void MarkdownRenderer.render(this.app, item.text, body, `${folder ? `${folder}/` : ""}.orelius-chat.md`, component)
        .catch(error => { body.setText(item.text); console.error("Orelius : rendu Markdown", error); });
    }
    for (const path of item.paths) {
      const button = element.createEl("button", { text: path, cls: "orelius-file" });
      button.onclick = () => { void this.run(() => this.plugin.openFile(path)); };
    }
  }

  private renderRequest(request: ServerRequest): void {
    const card = this.requestsEl.createDiv({ cls: "orelius-request" });
    const respond = (result: RpcObject) => { void this.run(async () => this.plugin.session.respond(request.id, result)); };
    if (request.method === "item/tool/requestUserInput" && Array.isArray(request.params.questions)) {
      const inputs = new Map<string, HTMLInputElement>();
      for (const value of request.params.questions) {
        const question = object(value);
        const label = card.createEl("label", { text: String(question.question ?? "Question de Codex") });
        if (Array.isArray(question.options)) {
          for (const option of question.options.map(object)) {
            const button = label.createEl("button", { text: String(option.label ?? "") });
            button.onclick = () => { const input = inputs.get(String(question.id)); if (input) input.value = String(option.label); };
          }
        }
        const input = label.createEl("input", { type: question.isSecret === true ? "password" : "text" });
        inputs.set(String(question.id), input);
      }
      card.createEl("button", { text: "Répondre" }).onclick = () => {
        const answers = Object.fromEntries([...inputs].map(([id, input]) => [id, { answers: [input.value] }]));
        respond({ answers });
      };
      return;
    }
    card.createEl("strong", { text: "Autorisation demandée" });
    const params = request.params;
    if (typeof params.reason === "string") card.createEl("p", { text: params.reason });
    if (typeof params.message === "string") card.createEl("p", { text: params.message });
    if (typeof params.command === "string") card.createEl("pre", { text: params.command });
    if (typeof params.cwd === "string") card.createEl("p", { text: `Dossier : ${params.cwd}` });
    if (typeof params.grantRoot === "string") card.createEl("p", { text: `Écriture : ${params.grantRoot}` });
    const permissions = object(params.permissions);
    const fileSystem = object(permissions.fileSystem);
    for (const [key, label] of [["read", "Lecture"], ["write", "Écriture"]]) {
      const paths = fileSystem[key];
      if (Array.isArray(paths)) for (const path of paths) card.createEl("p", { text: `${label} : ${String(path)}` });
    }
    if (permissions.network) card.createEl("p", { text: "Accès au réseau demandé." });
    card.createEl("p", { text: "Les modifications passent par l’archivage automatique d’Orelius. Les commandes d’écriture et les extensions de permissions sont refusées." });
    card.createEl("button", { text: "Refuser et poursuivre" }).onclick = () => {
      respond(request.method === "item/permissions/requestApproval" ? { permissions: {}, scope: "turn" }
        : request.method === "mcpServer/elicitation/request" ? { action: "decline", content: null }
          : { decision: "decline" });
    };
  }

  private clearMessages(): void {
    for (const item of this.rendered.values()) this.removeChild(item.component);
    this.rendered.clear();
    this.messagesEl.empty();
  }
}
