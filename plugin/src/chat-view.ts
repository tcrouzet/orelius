import { Component, ItemView, MarkdownRenderer, type WorkspaceLeaf } from "obsidian";
import type OreliusPlugin from "./main";
import { errorText, object, type RpcObject, type ServerRequest } from "./codex";
import type { ChatItem } from "./session";

export const VIEW_TYPE = "orelius-chat";

export class OreliusView extends ItemView {
  private projectTitleEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private modelSelect!: HTMLSelectElement;
  private contextEl!: HTMLElement;
  private modelKey = "";
  private timelineEl!: HTMLElement;
  private messagesEl!: HTMLElement;
  private requestsEl!: HTMLElement;
  private input!: HTMLTextAreaElement;
  private sendButton!: HTMLButtonElement;
  private reviseButton!: HTMLButtonElement;
  private stopButton!: HTMLButtonElement;
  private newButton!: HTMLButtonElement;
  private notice!: HTMLElement;
  private hintEl!: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private frame: number | null = null;
  private resize: ResizeObserver | null = null;
  private submitting = false;
  private lastScrollTop = 0;
  private rendered = new Map<string, { text: string; paths: string; element: HTMLElement; component: Component; revision: number }>();
  private requestKey = "";
  private active = false;
  private followMessages = true;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: OreliusPlugin) { super(leaf); }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return this.plugin?.settings.folder.split("/").pop() || this.app.vault.getName(); }
  getIcon(): string { return "messages-square"; }

  async onOpen(): Promise<void> {
    this.active = true;
    const root = this.contentEl;
    root.empty();
    root.addClass("orelius-chat");
    const header = root.createDiv({ cls: "orelius-header" });
    this.projectTitleEl = header.createEl("h4", { text: this.getDisplayText() });
    const modelLabel = header.createEl("label", { cls: "orelius-model", text: "Modèle" });
    this.modelSelect = modelLabel.createEl("select", { attr: { "aria-label": "Modèle Codex actif" } });
    this.modelSelect.onchange = () => { void this.run(() => this.plugin.connect(this.modelSelect.value)); };
    this.contextEl = header.createDiv({ cls: "orelius-context", attr: { role: "status" } });
    this.contextEl.title = "Place restante dans le contexte de cette conversation, selon la dernière mesure Codex.";
    this.modelKey = "";
    const actions = header.createDiv({ cls: "orelius-actions" });
    this.newButton = actions.createEl("button", { text: "Nouvelle conversation" });
    this.newButton.onclick = () => { void this.run(async () => {
      await this.plugin.session.newConversation();
      await this.plugin.connect();
    }); };
    this.timelineEl = root.createDiv({ cls: "orelius-timeline", attr: { tabindex: "0", "aria-label": "Conversation et questions de Codex" } });
    this.messagesEl = this.timelineEl.createDiv({ cls: "orelius-messages", attr: { role: "log", "aria-label": "Conversation avec Codex" } });
    this.followMessages = true;
    this.lastScrollTop = 0;
    this.requestKey = "";
    this.registerDomEvent(this.timelineEl, "scroll", () => {
      const top = this.timelineEl.scrollTop;
      if (this.timelineEl.scrollHeight - top - this.timelineEl.clientHeight < 80) this.followMessages = true;
      else if (top < this.lastScrollTop) this.followMessages = false;
      this.lastScrollTop = top;
    });
    this.requestsEl = this.timelineEl.createDiv({ cls: "orelius-requests" });
    const composer = root.createDiv({ cls: "orelius-composer" });
    this.statusEl = composer.createDiv({ cls: "orelius-status", attr: { role: "status" } });
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
    this.reviseButton = buttons.createEl("button", { text: "Réviser" });
    this.reviseButton.onclick = () => { void this.send(true); };
    this.stopButton = buttons.createEl("button", { text: "Arrêter" });
    this.stopButton.onclick = () => { void this.run(() => this.plugin.session.interrupt()); };
    this.hintEl = composer.createEl("small");
    this.resize = new ResizeObserver(() => this.scrollMessages());
    for (const element of [this.timelineEl, this.messagesEl, this.requestsEl]) this.resize.observe(element);
    this.plugin.attach(this);
    this.registerDomEvent(root, "focusin", event => {
      if (event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) return;
      void this.run(async () => { await this.plugin.refreshCorrections(); });
    });
    this.render();
    if (!this.plugin.session.connected && !this.plugin.session.busy) {
      void this.run(() => this.plugin.connect());
    }
  }

  async onClose(): Promise<void> {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.resize?.disconnect();
    this.resize = null;
    if (this.frame !== null) this.contentEl.ownerDocument.defaultView?.cancelAnimationFrame(this.frame);
    this.frame = null;
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

  private async send(revise = false): Promise<void> {
    const text = this.input.value;
    const chapter = revise ? this.plugin.revisionChapter : undefined;
    if ((revise ? !chapter || this.plugin.session.busy : !text.trim()) || this.submitting
      || (this.plugin.session.busy && !this.plugin.session.running)) return;
    this.submitting = true;
    this.followMessages = true;
    this.update();
    try { await this.run(() => this.plugin.send(text, chapter ?? undefined)); }
    finally { this.submitting = false; this.update(); }
  }

  private render(): void {
    const session = this.plugin.session;
    this.contentEl.toggleClass("orelius-show-activity", this.plugin.settings.showActivity);
    this.projectTitleEl.setText(this.getDisplayText());
    if (this.input.value !== this.plugin.draft) this.input.value = this.plugin.draft;
    this.statusEl.setText(session.status || (session.busy ? "Codex travaille…" : ""));
    this.statusEl.toggleClass("is-working", session.busy && !session.requests.length);
    const modelKey = JSON.stringify([session.models, session.model]);
    if (modelKey !== this.modelKey) {
      this.modelKey = modelKey;
      this.modelSelect.empty();
      if (!session.model) this.modelSelect.createEl("option", { value: "", text: "Modèle indisponible" });
      else if (!session.models.some(option => option.model === session.model)) {
        this.modelSelect.createEl("option", { value: session.model, text: session.model });
      }
      for (const option of session.models) this.modelSelect.createEl("option", { value: option.model, text: option.name });
    }
    this.modelSelect.value = session.model;
    this.modelSelect.disabled = session.busy || !session.connected || !session.models.length;
    this.contextEl.setText(session.contextRemaining === null ? "Contexte disponible : —"
      : `Contexte disponible : ${session.contextRemaining} %`);
    this.sendButton.disabled = this.submitting || (session.busy && !session.running) || !this.input.value.trim();
    this.sendButton.setText(this.submitting ? "Envoi…" : session.running ? "Envoyer à la tâche" : "Envoyer");
    const chapter = this.plugin.revisionChapter;
    this.reviseButton.disabled = this.submitting || session.busy || !chapter;
    this.reviseButton.title = !chapter ? "Ouvrez un chapitre du manuscrit pour le réviser."
      : session.busy ? "Attendez la fin de la tâche pour réviser le chapitre."
        : `Réviser ${chapter} à partir de vos corrections ; précisions facultatives dans le message.`;
    this.stopButton.disabled = !session.busy;
    this.newButton.disabled = session.busy;
    this.input.placeholder = session.running ? "Ajouter une consigne à la tâche en cours…" : "Message ou précisions facultatives pour Réviser…";
    this.hintEl.setText(session.running ? "⌘/Ctrl + Entrée pour ajouter une consigne à la tâche en cours"
      : "⌘/Ctrl + Entrée pour envoyer · originaux archivés avant modification");
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
      if (session.requests.length) {
        this.followMessages = false;
        this.requestsEl.scrollIntoView({ block: "start" });
        this.requestsEl.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
      } else this.followMessages = true;
    }
    this.scrollMessages();
  }

  private scrollMessages(): void {
    const win = this.contentEl.ownerDocument.defaultView;
    if (!this.active || !this.followMessages || this.plugin.session.requests.length || this.frame !== null || !win) return;
    this.frame = win.requestAnimationFrame(() => {
      this.frame = null;
      if (!this.active || !this.followMessages || this.plugin.session.requests.length) return;
      this.timelineEl.scrollTop = this.timelineEl.scrollHeight;
      this.lastScrollTop = this.timelineEl.scrollTop;
    });
  }

  private renderItem(item: ChatItem): void {
    let rendered = this.rendered.get(item.id);
    const paths = JSON.stringify(item.paths);
    if (rendered?.text === item.text && rendered.paths === paths) return;
    if (!rendered) {
      const element = this.messagesEl.createEl("article", { cls: `orelius-message orelius-${item.role}` });
      const component = new Component();
      this.addChild(component);
      rendered = { text: "", paths: "", element, component, revision: 0 };
      this.rendered.set(item.id, rendered);
    }
    const component = new Component();
    rendered.text = item.text;
    rendered.paths = paths;
    const revision = ++rendered.revision;
    this.addChild(component);
    const element = this.contentEl.ownerDocument.createElement("article");
    element.className = `orelius-message orelius-${item.role}`;
    element.createEl("strong", { cls: "orelius-role", text: item.role === "user" ? "Vous" : item.role === "assistant" ? "Codex" : "Activité" });
    const body = element.createDiv({ cls: "orelius-message-body" });
    for (const path of item.paths) {
      const button = element.createEl("button", { text: path, cls: "orelius-file" });
      button.onclick = () => { void this.run(() => this.plugin.openFile(path)); };
    }
    const display = () => {
      if (!this.active || this.rendered.get(item.id) !== rendered || rendered.revision !== revision) {
        this.removeChild(component);
        return;
      }
      this.removeChild(rendered.component);
      rendered.element.replaceWith(element);
      rendered.element = element;
      rendered.component = component;
      this.scrollMessages();
    };
    if (item.role === "activity") { body.createEl("pre", { text: item.text }); display(); }
    else {
      const folder = this.plugin.settings.folder;
      void MarkdownRenderer.render(this.app, item.text, body, `${folder ? `${folder}/` : ""}.orelius-chat.md`, component)
        .catch(error => { body.setText(item.text); console.error("Orelius : rendu Markdown", error); })
        .then(display);
    }
  }

  private renderRequest(request: ServerRequest): void {
    const card = this.requestsEl.createEl("form", { cls: "orelius-request" });
    const respond = (result: RpcObject) => { void this.run(async () => this.plugin.session.respond(request.id, result)); };
    if (request.method === "item/tool/requestUserInput" && Array.isArray(request.params.questions)) {
      const inputs = new Map<string, HTMLInputElement>();
      for (const value of request.params.questions) {
        const question = object(value);
        const field = card.createEl("fieldset");
        field.createEl("legend", { text: String(question.question ?? "Question de Codex") });
        if (Array.isArray(question.options)) {
          for (const option of question.options.map(object)) {
            const button = field.createEl("button", { type: "button", text: String(option.label ?? "") });
            if (typeof option.description === "string") button.title = option.description;
            button.onclick = () => {
              const input = inputs.get(String(question.id));
              if (input) { input.value = String(option.label); input.focus(); }
            };
          }
        }
        const input = field.createEl("input", { type: question.isSecret === true ? "password" : "text",
          attr: { "aria-label": String(question.question ?? "Votre réponse") } });
        input.required = true;
        inputs.set(String(question.id), input);
      }
      card.createEl("button", { type: "submit", text: "Répondre", cls: "mod-cta" });
      card.onsubmit = event => {
        event.preventDefault();
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
    card.createEl("button", { type: "button", text: "Refuser et poursuivre" }).onclick = () => {
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
