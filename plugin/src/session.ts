import { realpath } from "node:fs/promises";
import { archiveChanges } from "./archives.ts";
import { DEFAULT_PROJECT_FOLDERS, type ProjectFolders } from "./settings.ts";
import { CodexClient, errorText, findCodex, object, type RpcId, type RpcObject, type ServerRequest } from "./codex.ts";

export interface ChatItem {
  id: string;
  role: "user" | "assistant" | "activity";
  text: string;
  paths: string[];
}

interface SessionContext extends ProjectFolders {
  agentInstructions?: string;
}

export class ChatSession {
  items: ChatItem[] = [];
  requests: ServerRequest[] = [];
  status = "Déconnecté";
  busy = false;
  connected = false;
  threadId = "";
  private turnId = "";
  private client: CodexClient | null = null;
  private generation = 0;
  private operation = 0;
  private patches = new Map<string, unknown>();

  private readonly changed: () => void;
  private readonly remember: (threadId: string, cwd: string) => Promise<void>;
  private readonly archive: typeof archiveChanges;
  private readonly context: () => SessionContext;

  constructor(changed: () => void, remember: (threadId: string, cwd: string) => Promise<void>,
    archive: typeof archiveChanges = archiveChanges, context: () => SessionContext = () => DEFAULT_PROJECT_FOLDERS) {
    this.changed = changed;
    this.remember = remember;
    this.archive = archive;
    this.context = context;
  }

  async connect(executable: string, cwd: string, savedThreadId: string): Promise<void> {
    if (this.busy) throw new Error("Attendez la fin de la tâche ou utilisez Arrêter.");
    const operation = ++this.operation;
    this.busy = true;
    this.status = "Connexion à Codex…";
    this.changed();
    try {
      await this.initialize(executable, cwd, savedThreadId);
      if (operation === this.operation) this.status = "Prêt";
    } catch (error) {
      if (operation === this.operation) this.disconnect(errorText(error));
      throw error;
    } finally {
      if (operation === this.operation) {
        this.busy = false;
        this.changed();
      }
    }
  }

  async send(text: string, executable: string, cwd: string, savedThreadId: string): Promise<void> {
    if (this.busy || !text.trim()) return;
    const operation = ++this.operation;
    this.busy = true;
    this.status = "Codex travaille…";
    this.changed();
    try {
      if (!this.connected || !this.threadId) await this.initialize(executable, cwd, savedThreadId, true);
      const client = this.client;
      if (!client) throw new Error("Connexion Codex interrompue.");
      const result = await client.request("turn/start", {
        threadId: this.threadId,
        input: [{ type: "text", text, text_elements: [] }],
        cwd, approvalPolicy: "on-request", approvalsReviewer: "user",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
      });
      if (operation === this.operation && this.busy) this.turnId = String(object(result.turn).id ?? "");
    } catch (error) {
      // A lost start response can hide a running turn; close our process before retrying.
      if (operation === this.operation) this.disconnect(errorText(error));
      throw error;
    }
  }

  async interrupt(): Promise<void> {
    if (!this.busy) return;
    const operation = this.operation;
    if (!this.client || !this.turnId) {
      this.disconnect("Connexion interrompue. Vous pouvez reprendre la conversation.");
      return;
    }
    this.status = "Interruption…";
    this.changed();
    try {
      await this.client.request("turn/interrupt", { threadId: this.threadId, turnId: this.turnId });
    } catch (error) {
      if (operation === this.operation) this.disconnect(errorText(error));
      throw error;
    }
  }

  respond(id: RpcId, result: RpcObject): void {
    const request = this.requests.find(request => request.id === id);
    if (!request || !this.client) throw new Error("Cette demande Codex n’est plus active.");
    this.client.respond(id, result);
    this.requests = this.requests.filter(request => request.id !== id);
    this.status = this.requests.length ? "En attente de votre réponse" : "Codex travaille…";
    this.changed();
  }

  disconnect(status = "Déconnecté"): void {
    this.operation++;
    this.generation++;
    this.client?.stop();
    this.client = null;
    this.connected = false;
    this.busy = false;
    this.turnId = "";
    this.requests = [];
    this.patches.clear();
    this.status = status;
    this.changed();
  }

  async newConversation(): Promise<void> {
    if (this.busy) throw new Error("Attendez la fin de la tâche ou utilisez Arrêter.");
    this.busy = true;
    this.changed();
    try { await this.remember("", ""); }
    catch (error) { this.busy = false; this.changed(); throw error; }
    this.disconnect();
    this.threadId = "";
    this.items = [];
    this.changed();
  }

  private async initialize(executable: string, cwd: string, savedThreadId: string, createThread = false): Promise<void> {
    const generation = ++this.generation;
    this.client?.stop();
    const client = new CodexClient({
      notification: (method, params) => {
        if (generation === this.generation) this.notification(method, params);
      },
      request: request => {
        if (generation !== this.generation) return;
        if (request.params.threadId !== this.threadId) {
          client.rejectRequest(request.id);
          return;
        }
        if (request.method === "item/fileChange/requestApproval") {
          const changes = this.patches.get(String(request.params.itemId));
          void (async () => {
            let decision = "decline";
            try {
              if (!this.busy || !this.turnId || request.params.turnId !== this.turnId || request.params.grantRoot != null) {
                throw new Error("Demande d’écriture hors de la tâche active ou d’extension des permissions refusée.");
              }
              this.status = "Archivage des originaux…";
              this.changed();
              const paths = await this.archive(cwd, changes, undefined, this.context().archiveFolder);
              if (generation !== this.generation || request.params.turnId !== this.turnId) return;
              if (this.patches.get(String(request.params.itemId)) !== changes) {
                throw new Error("Le patch a changé pendant l’archivage. Écriture refusée.");
              }
              if (paths.length) this.upsert({ id: `archive-${request.params.itemId}`, role: "activity",
                text: "Originaux archivés avant modification", paths });
              decision = "accept";
              this.status = "Codex travaille…";
            } catch (error) {
              if (generation !== this.generation) return;
              this.status = `Écriture refusée : ${errorText(error)}`;
              this.upsert({ id: `archive-${request.params.itemId}`, role: "activity", text: this.status, paths: [] });
            }
            if (generation === this.generation) {
              client.respond(request.id, { decision });
              this.patches.delete(String(request.params.itemId));
              this.changed();
            }
          })().catch(error => {
            if (generation === this.generation) this.disconnect(errorText(error));
          });
          return;
        }
        const supported = ["item/commandExecution/requestApproval",
          "item/permissions/requestApproval", "item/tool/requestUserInput", "mcpServer/elicitation/request"];
        if (!supported.includes(request.method)) {
          client.rejectRequest(request.id);
          this.status = `Demande non prise en charge : ${request.method}`;
        } else {
          this.requests.push(request);
          this.status = "En attente de votre réponse";
        }
        this.changed();
      },
      exit: message => {
        if (generation === this.generation) this.disconnect(message);
      },
    });
    this.client = client;
    const ensureCurrent = () => {
      if (generation !== this.generation) throw new Error("Connexion interrompue.");
    };
    const binary = await findCodex(executable);
    ensureCurrent();
    await client.connect(binary, cwd);
    ensureCurrent();
    if (!savedThreadId && !createThread) {
      this.threadId = "";
      this.items = [];
      this.connected = true;
      return;
    }
    const context = this.context();
    const result = await client.request(savedThreadId ? "thread/resume" : "thread/start", {
      ...(savedThreadId ? { threadId: savedThreadId, excludeTurns: true } : { ephemeral: false }),
      cwd, sandbox: "read-only", approvalPolicy: "on-request", approvalsReviewer: "user",
      developerInstructions: [context.agentInstructions,
        "Use apply_patch for requested file edits. Orelius must archive originals before approving each patch. Shell writes, permission extensions, deletions and renames are forbidden. Do not change archive directories, .obsidian or .git. If an edit is declined, report it and do not retry through another tool."].filter(Boolean).join("\n\n"),
    });
    ensureCurrent();
    const thread = object(result.thread);
    if (typeof thread.id !== "string" || !thread.id || (savedThreadId && thread.id !== savedThreadId)) {
      throw new Error("Codex n’a pas renvoyé la conversation attendue. Aucune conversation de remplacement n’a été créée.");
    }
    if (object(result.sandbox).type !== "readOnly" || result.approvalPolicy !== "on-request"
      || result.approvalsReviewer !== "user" || await realpath(String(result.cwd)) !== await realpath(cwd)) {
      throw new Error("Codex n’a pas appliqué le dossier ou les permissions demandés. Connexion arrêtée.");
    }
    if (object(thread.status).type === "active") {
      throw new Error("Cette conversation est déjà occupée. Arrêtez sa tâche avant de la reprendre dans Orelius.");
    }
    ensureCurrent();
    this.threadId = thread.id;
    const items: ChatItem[] = [];
    if (savedThreadId) {
      let cursor: string | null = null;
      do {
        const page = await client.request("thread/items/list", {
          threadId: thread.id, limit: 100, sortDirection: "asc", cursor,
        });
        ensureCurrent();
        if (!Array.isArray(page.data)) throw new Error("Impossible de lire l’historique Codex.");
        for (const entry of page.data) {
          const item = toChatItem(object(object(entry).item));
          if (item) items.push(item);
        }
        cursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
      } while (cursor);
    }
    await this.remember(thread.id, cwd);
    ensureCurrent();
    this.items = items;
    this.connected = true;
  }

  private notification(method: string, params: RpcObject): void {
    if (params.threadId !== this.threadId) return;
    if (method === "turn/started") {
      this.turnId = String(object(params.turn).id ?? "");
      this.busy = true;
      this.status = "Codex travaille…";
    } else if (method === "turn/completed") {
      const turn = object(params.turn);
      this.busy = false;
      this.turnId = "";
      this.requests = [];
      this.patches.clear();
      this.status = turn.status === "failed" ? String(object(turn.error).message ?? "La tâche Codex a échoué.")
        : turn.status === "interrupted" ? "Tâche interrompue · prêt" : "Prêt";
    } else if (method === "item/started" || method === "item/completed") {
      const raw = object(params.item);
      if (method === "item/started" && raw.type === "fileChange" && typeof raw.id === "string") {
        this.patches.set(raw.id, raw.changes);
      }
      const item = toChatItem(object(params.item));
      if (item && !(method === "item/started" && this.items.some(previous => previous.id === item.id))) this.upsert(item);
    } else if (method === "item/fileChange/patchUpdated" && typeof params.itemId === "string") {
      this.patches.set(params.itemId, params.changes);
    } else if (method === "item/agentMessage/delta" && typeof params.delta === "string" && typeof params.itemId === "string") {
      const previous = this.items.find(item => item.id === params.itemId);
      this.upsert({ id: params.itemId, role: "assistant", text: (previous?.text ?? "") + params.delta, paths: [] });
    } else if (method === "serverRequest/resolved") {
      this.requests = this.requests.filter(request => request.id !== params.requestId);
      this.status = this.requests.length ? "En attente de votre réponse" : this.busy ? "Codex travaille…" : "Prêt";
    } else if (method === "error") {
      this.status = String(object(params.error).message ?? "Erreur Codex.");
    }
    this.changed();
  }

  private upsert(item: ChatItem): void {
    const index = this.items.findIndex(previous => previous.id === item.id);
    if (index === -1) this.items.push(item);
    else this.items[index] = item;
  }
}

export function toChatItem(item: RpcObject): ChatItem | null {
  if (typeof item.id !== "string") return null;
  const base = { id: item.id, paths: [] as string[] };
  if (item.type === "userMessage" && Array.isArray(item.content)) {
    return { ...base, role: "user", text: item.content.map(object).filter(part => part.type === "text")
      .map(part => String(part.text ?? "")).join("\n") };
  }
  if (item.type === "agentMessage") return { ...base, role: "assistant", text: String(item.text ?? "") };
  if (item.type === "commandExecution") {
    const actions = Array.isArray(item.commandActions) ? item.commandActions.map(object) : [];
    return { ...base, role: "activity", text: `Commande · ${item.status ?? "en cours"}\n${item.command ?? ""}`,
      paths: actions.filter(action => typeof action.path === "string").map(action => String(action.path)) };
  }
  if (item.type === "fileChange" && Array.isArray(item.changes)) {
    return { ...base, role: "activity", text: item.status === "completed" ? "Fichier enregistré" : `Modification · ${item.status ?? "en cours"}`,
      paths: item.changes.map(object).filter(change => typeof change.path === "string").map(change => String(change.path)) };
  }
  if (item.type === "mcpToolCall") return { ...base, role: "activity", text: `Outil · ${item.server}/${item.tool} · ${item.status}` };
  return null;
}
