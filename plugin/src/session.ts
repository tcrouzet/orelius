import { configPath, parseConfig, readData, fingerprint } from "./narrative-context.ts";
import { consultMethod, recordNarrativeState } from "./writing-methods.ts";
import type { TaskPrompts } from "./task-prompts.ts";
import { realpath } from "node:fs/promises";
import { archiveChanges } from "./archives.ts";
import { DEFAULT_PROJECT_FOLDERS, type OreliusSettings, type ProjectFolders } from "./settings.ts";
import { contextRemaining, modelOptions, type ModelOption } from "./models.ts";
import { ProjectMcp } from "./mcp.ts";
import { readProjectFile, writeProjectFile } from "./project-files.ts";
import { CodexClient, errorText, findCodex, object, stringValue, type RpcId, type RpcObject, type ServerRequest } from "./codex.ts";
import type { ConversationTurn } from "./conversation.ts";
import { planRevision, revisionFor, revisionKey, revisionPath, type RevisionHighlight, type RevisionPlan } from "./revision.ts";
import { chapterPath, revisionPrompt, revisionProtections, revisionRequest } from "./corrections.ts";
import { buildSceneContext, saveSceneContext, type SceneContext } from "./scene-context.ts";
import { ChapterReview } from "./chapter-review.ts";
import { readEditorialContext } from "./editorial-context.ts";

export interface ChatItem {
  id: string;
  role: "user" | "assistant" | "activity";
  text: string;
  paths: string[];
  phase?: string;
}

interface SessionContext extends ProjectFolders {
  activeChapter?: string | null;
  configDir?: string;
  agentInstructions?: string;
  taskPrompts?: TaskPrompts;
  checkEditor?: (path: string, content: string) => void;
  lockNote?: (path: string) => void;
  codexVersions?: OreliusSettings["codexVersions"];
}

export function codexFailure(message: string, code?: unknown): { message: string; retryable: boolean } {
  const retryable = typeof code === "string" && ["serveroverloaded", "serverisoverloaded"].includes(code.toLowerCase().replace(/_/g, ""))
    || /selected model is at capacity|model.*temporarily overloaded/i.test(message);
  return { message: retryable
    ? "Le modèle est temporairement saturé côté OpenAI. Votre quota d’utilisation n’est pas épuisé. Vous pouvez relancer la demande."
    : message, retryable };
}

export class ChatSession {
  items: ChatItem[] = [];
  turns: ConversationTurn[] = [];
  requests: ServerRequest[] = [];
  status = "Déconnecté";
  busy = false;
  connected = false;
  threadId = "";
  models: ModelOption[] = [];
  model = "";
  contextRemaining: number | null = null;
  failure: ReturnType<typeof codexFailure> | null = null;
  private turnId = "";
  private interrupting = false;
  private client: CodexClient | null = null;
  private files: ProjectMcp | null = null;
  private generation = 0;
  private operation = 0;
  private recording = Promise.resolve();
  private closing = Promise.resolve();
  private revision: RevisionPlan | null = null;
  private protections: RevisionPlan[] = [];
  private sceneContext: SceneContext | null = null;
  private chapterReview = new ChapterReview();
  private editorialContext: Promise<string[]> | null = null;
  private editorialChapter: string | undefined;
  private editorialPagesRead = new Set<number>();
  private lastRequest: { text: string; cwd: string; threadId: string; turnId?: string; revision?: RevisionPlan; protections: RevisionPlan[]; restored?: boolean; originalPrompt?: string } | null = null;

  private readonly changed: () => void;
  private readonly remember: (threadId: string, cwd: string) => Promise<void>;
  private readonly archive: typeof archiveChanges;
  private readonly context: () => SessionContext;
  private readonly written: (cwd: string, changes: unknown, highlight?: RevisionHighlight) => Promise<void>;
  private readonly conversation?: (cwd: string, threadId: string, turns: ConversationTurn[]) => Promise<void>;

  get running(): boolean { return this.connected && this.busy && Boolean(this.turnId) && !this.interrupting; }
  get canRetry(): boolean { return !this.busy && Boolean(this.failure?.retryable && this.lastRequest?.threadId === this.threadId); }

  constructor(changed: () => void, remember: (threadId: string, cwd: string) => Promise<void>,
    archive: typeof archiveChanges = archiveChanges, context: () => SessionContext = () => DEFAULT_PROJECT_FOLDERS,
    written: (cwd: string, changes: unknown, highlight?: RevisionHighlight) => Promise<void> = async () => {},
    conversation?: (cwd: string, threadId: string, turns: ConversationTurn[]) => Promise<void>) {
    this.changed = changed;
    this.remember = remember;
    this.archive = archive;
    this.context = context;
    this.written = written;
    this.conversation = conversation;
  }

  async connect(executable: string, cwd: string, savedThreadId: string, model?: string): Promise<void> {
    if (this.busy) throw new Error("Attendez la fin de la tâche ou utilisez Arrêter.");
    if (model !== undefined && !this.models.some(option => option.model === model)) throw new Error("Choisissez un modèle proposé par Codex.");
    const operation = ++this.operation;
    this.busy = true;
    this.status = "Connexion à Codex…";
    this.changed();
    try {
      await this.initialize(executable, cwd, savedThreadId, false, model);
      if (operation === this.operation) this.status = "";
    } catch (error) {
      if (operation === this.operation) { this.fail(error); await this.disconnect(this.status); }
      throw error;
    } finally {
      if (operation === this.operation) {
        this.busy = false;
        this.changed();
      }
    }
  }

  async send(text: string, executable: string, cwd: string, savedThreadId: string, revision?: RevisionPlan, protections: RevisionPlan[] = []): Promise<void> {
    if (!text.trim()) return;
    if (this.busy) {
      if (revision) throw new Error("Attendez la fin de la tâche avant une révision ciblée.");
      await this.steer(text);
      return;
    }
    const operation = ++this.operation;
    this.failure = null;
    this.lastRequest = null;
    this.busy = true;
    this.status = "Codex travaille…";
    this.changed();
    try {
      if (!this.connected || !this.threadId) await this.initialize(executable, cwd, savedThreadId, true);
      this.failure = null;
      this.revision = revision ?? null;
      this.protections = revision ? [revision, ...protections] : protections;
      this.editorialContext = null;
      this.chapterReview = new ChapterReview();
      this.sceneContext = null;
      this.editorialChapter = revision?.path ?? this.context().activeChapter ?? undefined;
      this.editorialPagesRead.clear();
      this.lastRequest = { text, cwd, threadId: this.threadId, revision, protections };
      const client = this.client;
      if (!client) throw new Error("Connexion Codex interrompue.");
      const result = await client.request("turn/start", {
        threadId: this.threadId,
        input: [{ type: "text", text, text_elements: [] }],
        cwd, approvalPolicy: "never", approvalsReviewer: "user",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
      });
      if (operation === this.operation && this.busy) {
        this.turnId = stringValue(object(result.turn).id);
        if (this.lastRequest) this.lastRequest.turnId = this.turnId;
      }
    } catch (error) {
      // A lost start response can hide a running turn; close our process before retrying.
      if (operation === this.operation) { this.fail(error); await this.disconnect(this.status); }
      throw error;
    }
  }

  async retry(executable: string, cwd: string, savedThreadId: string): Promise<void> {
    const request = await this.prepareRetry(cwd, savedThreadId);
    if (request.revision) this.context().lockNote?.(request.revision.path);
    await this.send(request.text, executable, cwd, savedThreadId, request.revision, request.protections);
  }

  private async prepareRetry(cwd: string, savedThreadId: string) {
    const request = this.lastRequest;
    if (!this.canRetry || !request) throw new Error("Aucune demande interrompue à relancer.");
    if (cwd !== request.cwd || savedThreadId !== request.threadId) throw new Error("Revenez dans le dossier et la conversation de la demande à relancer.");
    if (request.restored) {
      const folders = this.context();
      const versions = folders.codexVersions?.[cwd] ?? {};
      const originalPrompt = request.originalPrompt ?? request.text;
      const target = revisionRequest(originalPrompt);
      if (!target && originalPrompt.startsWith("Révise le chapitre ")) throw new Error("Cette ancienne demande de révision ne peut pas être récupérée. Ouvrez le chapitre puis utilisez Réviser.");
      if (target) {
        const source = await readProjectFile(cwd, target.path);
        if (!source) throw new Error("Chapitre introuvable. Ouvrez le chapitre puis utilisez Réviser.");
        const revision = planRevision(target.path, source.text, versions[target.path], target.details, target.wholeChapterRequested);
        if (await revisionPrompt(cwd, folders, target.path, versions, target.details, revision) !== originalPrompt) {
          throw new Error("Le chapitre ou les consignes ont changé depuis l’échec. Utilisez Réviser pour préparer une nouvelle demande.");
        }
        request.revision = revision;
      }
      request.protections = await revisionProtections(cwd, folders, versions, request.revision?.path);
      request.restored = false;
    }
    for (const plan of request.revision ? [request.revision, ...request.protections] : request.protections) {
      const file = await readProjectFile(cwd, plan.path);
      if (file?.text !== plan.expected) throw new Error("Le chapitre a changé depuis l’échec. Utilisez Réviser pour prendre en compte vos nouvelles corrections.");
      this.context().checkEditor?.(plan.path, file.text);
    }
    return request;
  }

  private restoreFailure(cwd: string, threadId: string, turns: ConversationTurn[]): void {
    const last = turns[turns.length - 1];
    this.failure = last?.failure ?? null;
    if (last?.failure && this.lastRequest?.turnId !== last.id) {
      const prompts = last.messages.filter(item => item.role === "user").map(item => item.text);
      const text = prompts.join("\n\n");
      this.lastRequest = text ? { text, cwd, threadId, turnId: last.id, protections: [], restored: true, originalPrompt: prompts[0] } : null;
    }
    if (!last?.failure) this.lastRequest = null;
  }

  private fail(error: unknown): void {
    const value = object(error);
    this.failure = codexFailure(typeof value.message === "string" ? value.message : errorText(error), value.codexErrorInfo ?? value.codex_error_info);
    this.status = this.failure.message;
  }

  async steer(text: string): Promise<void> {
    if (!text.trim()) return;
    const client = this.client;
    const generation = this.generation;
    const turnId = this.turnId;
    if (!client || !this.running) throw new Error("Aucune tâche active ne peut recevoir cette consigne. Votre message est conservé.");
    const result = await client.request("turn/steer", { threadId: this.threadId, expectedTurnId: turnId,
      input: [{ type: "text", text, text_elements: [] }] });
    if (generation !== this.generation) throw new Error("Connexion interrompue pendant l’envoi. Vérifiez l’historique avant de renvoyer la consigne.");
    if (result.turnId !== turnId) {
      await this.disconnect("Codex n’a pas confirmé la tâche destinataire de la consigne.");
      throw new Error(this.status);
    }
    if (this.lastRequest) this.lastRequest.text += `\n\n${text}`;
    this.editorialContext = null;
    this.sceneContext = null;
    this.editorialPagesRead.clear();
    this.chapterReview = new ChapterReview();
    this.upsert({ id: `steer-${turnId}-${Date.now()}`, role: "activity", text: "Consigne transmise à la tâche en cours", paths: [] });
    this.changed();
  }

  async interrupt(): Promise<void> {
    if (!this.busy) return;
    const operation = this.operation;
    if (!this.client || !this.turnId) {
      await this.disconnect("Connexion interrompue. Vous pouvez reprendre la conversation.");
      return;
    }
    this.interrupting = true;
    this.status = "Interruption…";
    this.changed();
    try {
      await this.client.request("turn/interrupt", { threadId: this.threadId, turnId: this.turnId });
    } catch (error) {
      if (operation === this.operation) await this.disconnect(errorText(error));
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

  disconnect(status = "Déconnecté"): Promise<void> {
    this.operation++;
    this.generation++;
    this.closing = Promise.all([this.closing, this.client?.stop(), this.files?.stop(), this.recording.catch(() => {})]).then(() => {});
    this.client = null;
    this.files = null;
    this.connected = false;
    this.busy = false;
    this.turnId = "";
    this.interrupting = false;
    this.revision = null;
    this.protections = [];
    this.editorialContext = null;
    this.editorialPagesRead.clear();
    this.requests = [];
    this.models = [];
    this.model = "";
    this.contextRemaining = null;
    this.status = status;
    this.changed();
    return this.closing;
  }

  async newConversation(): Promise<void> {
    if (this.busy) throw new Error("Attendez la fin de la tâche ou utilisez Arrêter.");
    this.busy = true;
    this.changed();
    try { await this.remember("", ""); }
    catch (error) { this.busy = false; this.changed(); throw error; }
    const model = this.model;
    await this.disconnect();
    this.model = model;
    this.threadId = "";
    this.items = [];
    this.turns = [];
    this.failure = null;
    this.lastRequest = null;
    this.changed();
  }

  private async initialize(executable: string, cwd: string, savedThreadId: string, createThread = false, selectedModel?: string): Promise<void> {
    if (this.lastRequest && savedThreadId !== this.lastRequest.threadId) { this.lastRequest = null; this.failure = null; }
    const generation = ++this.generation;
    const requestedModel = selectedModel ?? (!savedThreadId ? this.model || undefined : undefined);
    let pendingUsage: unknown = null;
    await Promise.all([this.client?.stop(), this.files?.stop(), this.closing, this.recording.catch(() => {})]);
    if (generation !== this.generation) throw new Error("Connexion interrompue.");
    this.files = null;
    this.recording = Promise.resolve();
    const client = new CodexClient({
      notification: (method, params) => {
        if (generation === this.generation && method === "thread/tokenUsage/updated" && params.threadId === savedThreadId && savedThreadId) {
          pendingUsage = params.tokenUsage;
        }
        if (generation === this.generation) void this.notification(method, params, cwd).catch(error => {
          if (generation === this.generation) void this.disconnect(errorText(error));
        });
      },
      request: request => {
        if (generation !== this.generation) return;
        if (request.params.threadId !== this.threadId) {
          client.rejectRequest(request.id);
          return;
        }
        if (["item/fileChange/requestApproval", "item/commandExecution/requestApproval"].includes(request.method)) {
          client.respond(request.id, { decision: "decline" });
          this.upsert({ id: `refused-${request.id}`, role: "activity", text: "Accès direct refusé. Les écritures passent par l’outil Orelius ecrire_fichier.", paths: [] });
          this.changed();
          return;
        }
        if (request.method === "item/permissions/requestApproval") {
          client.respond(request.id, { permissions: {}, scope: "turn" });
          return;
        }
        const supported = ["item/tool/requestUserInput", "mcpServer/elicitation/request"];
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
        if (generation === this.generation) void this.disconnect(message);
      },
    });
    this.client = client;
    const ensureCurrent = () => {
      if (generation !== this.generation) throw new Error("Connexion interrompue.");
    };
    const binary = await findCodex(executable);
    ensureCurrent();
    const files = new ProjectMcp((path, content) => {
      const turnId = this.turnId;
      let original: string | null = null;
      const ensureActive = () => {
        ensureCurrent();
        if (!this.running || !turnId || turnId !== this.turnId) throw new Error("Écriture refusée hors de la tâche Codex active.");
        if (original !== null) this.context().checkEditor?.(path, original);
      };
      const write = this.recording.then(async () => {
        ensureActive();
        this.status = "Archivage et écriture…";
        this.changed();
        const revision = this.revision;
        if (revision) path = revisionPath(revision, cwd, this.context().bibleFolder, path);
        if (revisionKey(cwd, path).startsWith(`${this.context().manuscriptFolder}/Context/`.normalize("NFC").toLowerCase()) && revisionKey(cwd, path).endsWith("/etat.md")) throw new Error("Utilisez enregistrer_etat_narratif pour les états vérifiés.");
        if (revisionKey(cwd, path) === revisionKey(cwd, configPath(this.context()))) parseConfig(readData(content), this.context());
        const protection = revisionFor(this.protections, cwd, path);
        if (protection) path = protection.path;
        if (chapterPath(cwd, this.context(), path)) {
          const pages = await this.editorialContext;
          if (!pages || this.editorialPagesRead.size !== pages.length) {
            throw new Error("Avant d’écrire un chapitre, lisez toutes les pages de consulter_contexte_editorial pour appliquer les consignes et les corrections des chapitres précédents à cette demande.");
          }
        }
        if (chapterPath(cwd, this.context(), path)) await this.chapterReview.check(cwd, path);
        this.context().lockNote?.(revisionKey(cwd, path));
        const previous = await readProjectFile(cwd, path);
        original = previous?.text ?? "";
        const archives = await writeProjectFile(cwd, path, content, previous, this.context().archiveFolder, this.archive, ensureActive, true, protection, this.context().configDir);
        const changes = [{ path, kind: { type: previous ? "update" : "add" } }];
        try { await this.written(cwd, changes, protection ? { before: protection.source, after: content } : undefined); }
        catch (error) { throw new Error(`Le fichier ${path} a été écrit, mais sa référence de suivi n’a pas pu être enregistrée : ${errorText(error)}`); }
        if (protection) protection.expected = content;
        if (revisionKey(cwd, path) === revisionKey(cwd, `${this.context().bibleFolder}/Suivi/Connaissances.md`)) {
          for (const plan of this.protections) plan.intentRecorded = true;
        }
        if (generation === this.generation) {
          this.upsert({ id: `write-${turnId}-${path}`, role: "activity", text: "Fichier écrit et version générée archivée par Orelius", paths: [path, ...archives] });
          this.status = "Codex travaille…";
          this.changed();
        }
        return JSON.stringify({ fichier: path, archives, resultat: "Fichier écrit et version générée archivée.",
          ...(chapterPath(cwd, this.context(), path) ? { empreinte: fingerprint(content), suite: "Actualiser le résumé et les progressions avec enregistrer_etat_narratif depuis le texte enregistré ; aucun fait du plan ne devient acquis automatiquement." } : {}) });
      });
      this.recording = write.then(() => {}, () => {});
      return write.catch(error => {
        if (generation === this.generation) {
          this.status = errorText(error);
          this.upsert({ id: `write-error-${turnId}-${path}`, role: "activity", text: `Erreur d’écriture : ${errorText(error)}`, paths: [] });
          this.changed();
        }
        throw error;
      });
    }, (page, chapter) => {
      const turnId = this.turnId;
      const requestText = this.lastRequest?.text;
      const consultation = this.recording.then(async () => {
        const ensureActive = () => {
          ensureCurrent();
          if (!this.running || !turnId || turnId !== this.turnId) throw new Error("Consultation refusée hors de la tâche active.");
          if (this.lastRequest?.text !== requestText) throw new Error("La demande a changé. Relisez le dossier depuis la page 0.");
        };
        ensureActive();
        const context = this.context();
        if (chapter !== undefined) {
          if (chapterPath(cwd, context, chapter) !== chapter) throw new Error("Chemin de chapitre relatif attendu.");
          if (this.revision && chapter !== this.revision.path) throw new Error("Le dossier doit rester celui du chapitre ciblé par la révision.");
          if (chapter !== this.editorialChapter && page !== 0) throw new Error("Commencez le dossier du nouveau chapitre par la page 0.");
          this.editorialChapter = chapter;
        }
        if (page === 0 || !this.editorialContext) {
          this.editorialPagesRead.clear();
          this.chapterReview = new ChapterReview();
          this.sceneContext = null;
          this.editorialContext = null;
          if (this.editorialChapter) {
            const dossier = await buildSceneContext(cwd, context, context.codexVersions?.[cwd] ?? {}, this.editorialChapter, this.lastRequest?.text ?? "", context.taskPrompts);
            await saveSceneContext(cwd, context, dossier, ensureActive, context.configDir);
            ensureActive();
            this.sceneContext = dossier;
            this.editorialContext = Promise.resolve(dossier.pages);
          } else {
            this.editorialContext = readEditorialContext(cwd, context, context.codexVersions?.[cwd] ?? {});
          }
        }
        const pages = await this.editorialContext;
        ensureActive();
        if (page >= pages.length) throw new Error(`Page introuvable. Consultez les pages 0 à ${pages.length - 1}.`);
        this.editorialPagesRead.add(page);
        return pages[page];
      });
      this.recording = consultation.then(() => {}, () => {});
      return consultation;
    }, args => {
      const turnId = this.turnId;
      const preparation = this.recording.then(async () => {
        ensureCurrent();
        if (!this.running || !turnId || turnId !== this.turnId) throw new Error("Préparation refusée hors de la tâche active.");
        const pages = await this.editorialContext;
        if (!pages || this.editorialPagesRead.size !== pages.length) throw new Error("Lisez toutes les pages de consulter_contexte_editorial avant de préparer le chapitre.");
        if (!this.sceneContext) throw new Error("Consultez la page 0 de consulter_contexte_editorial avec le chemin du chapitre à préparer.");
        this.status = "Préparation de la scène…";
        this.changed();
        const result = await this.chapterReview.prepare(cwd, this.context(), args, this.sceneContext, () => {
          ensureCurrent();
          if (!this.running || turnId !== this.turnId) throw new Error("La tâche a changé pendant la préparation.");
        }, this.context().configDir);
        ensureCurrent();
        if (!this.running || turnId !== this.turnId) throw new Error("La tâche a changé pendant la préparation.");
        return result;
      });
      this.recording = preparation.then(() => {}, () => {});
      return preparation;
    }, args => {
      const turnId = this.turnId;
      const action = this.recording.then(async () => {
        const ensureActive = () => { ensureCurrent(); if (!this.running || !turnId || turnId !== this.turnId) throw new Error("Tâche inactive."); };
        ensureActive();
        if (!this.sceneContext) throw new Error("Consultez le dossier du chapitre avant la méthode.");
        return consultMethod(cwd, this.context(), args, this.sceneContext, ensureActive, this.context().configDir);
      });
      this.recording = action.then(() => {}, () => {});
      return action;
    }, args => {
      const turnId = this.turnId;
      const action = this.recording.then(async () => {
        const ensureActive = () => { ensureCurrent(); if (!this.running || !turnId || turnId !== this.turnId) throw new Error("Tâche inactive."); };
        ensureActive();
        if (!this.editorialChapter) throw new Error("Choisissez le chapitre avant son extraction.");
        return recordNarrativeState(cwd, this.context(), args, this.editorialChapter, ensureActive, this.context().configDir, this.sceneContext ?? undefined);
      });
      this.recording = action.then(() => {}, () => {});
      return action;
    });
    this.files = files;
    const url = await files.start();
    ensureCurrent();
    await client.connect(binary, cwd, { url, token: files.token });
    ensureCurrent();
    const models: ModelOption[] = [];
    let modelCursor: string | null = null;
    do {
      const page = await client.request("model/list", { limit: 100, includeHidden: false, cursor: modelCursor });
      ensureCurrent();
      models.push(...modelOptions(page.data));
      modelCursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
    } while (modelCursor);
    this.models = models;
    if (selectedModel !== undefined && !models.some(option => option.model === selectedModel)) throw new Error("Ce modèle n’est plus proposé par Codex.");
    if (!savedThreadId && !createThread) {
      const { config } = await client.request("config/read", { cwd, includeLayers: false });
      ensureCurrent();
      const configured = object(config).model;
      this.model = requestedModel ?? (typeof configured === "string" && configured ? configured : models.find(option => option.isDefault)?.model ?? "");
      this.contextRemaining = null;
      this.threadId = "";
      this.items = [];
      this.turns = [];
      this.connected = true;
      return;
    }
    const context = this.context();
    const result = await client.request(savedThreadId ? "thread/resume" : "thread/start", {
      ...(savedThreadId ? { threadId: savedThreadId, excludeTurns: true } : { ephemeral: false }),
      cwd, sandbox: "read-only", approvalPolicy: "never", approvalsReviewer: "user",
      ...(requestedModel ? { model: requestedModel } : {}),
      developerInstructions: [context.agentInstructions,
        `Before chapter prose, read consulter_contexte_editorial for that chapter and record its scene preparation with preparer_chapitre. These tools maintain visible manuscript Context files. Create or modify manuscript files only with the Orelius MCP tool ecrire_fichier (chemin, contenu). Provide the complete UTF-8 content. Orelius archives the original before writing. Shell writes, apply_patch, permission extensions, deletions and renames are forbidden. Do not change archive directories, the Obsidian configuration directory${context.configDir ? ` (${JSON.stringify(context.configDir)})` : ""} or .git. If an edit fails, report it and do not retry through another tool.`].filter(Boolean).join("\n\n"),
    });
    ensureCurrent();
    const thread = object(result.thread);
    if (typeof thread.id !== "string" || !thread.id || (savedThreadId && thread.id !== savedThreadId)) {
      throw new Error("Codex n’a pas renvoyé la conversation attendue. Aucune conversation de remplacement n’a été créée.");
    }
    if (object(result.sandbox).type !== "readOnly" || result.approvalPolicy !== "never"
      || result.approvalsReviewer !== "user" || await realpath(String(result.cwd)) !== await realpath(cwd)) {
      throw new Error("Codex n’a pas appliqué le dossier ou les permissions demandés. Connexion arrêtée.");
    }
    if (object(thread.status).type === "active") {
      throw new Error("Cette conversation est déjà occupée. Arrêtez sa tâche avant de la reprendre dans Orelius.");
    }
    ensureCurrent();
    this.threadId = thread.id;
    this.model = typeof result.model === "string" ? result.model : "";
    this.contextRemaining = contextRemaining(pendingUsage);
    let items: ChatItem[] = [];
    let turns: ConversationTurn[] = [];
    if (savedThreadId) {
      turns = await readConversation(client, thread.id, ensureCurrent);
      items = turns.flatMap(turn => turn.messages);
      this.restoreFailure(cwd, thread.id, turns);
      await this.conversation?.(cwd, thread.id, turns);
      ensureCurrent();
    }
    await this.remember(thread.id, cwd);
    ensureCurrent();
    this.items = items;
    this.turns = turns;
    this.connected = true;
  }

  private async notification(method: string, params: RpcObject, cwd: string): Promise<void> {
    if (params.threadId !== this.threadId) return;
    const generation = this.generation;
    if (method === "turn/started") {
      this.turnId = stringValue(object(params.turn).id);
      this.interrupting = false;
      this.busy = true;
      this.failure = null;
      this.status = "Codex travaille…";
    } else if (method === "thread/tokenUsage/updated") {
      this.contextRemaining = contextRemaining(params.tokenUsage);
    } else if (method === "turn/completed") {
      const turn = object(params.turn);
      if (turn.status === "failed" || turn.error) this.fail(turn.error ?? "La tâche Codex a échoué.");
      this.turnId = "";
      this.interrupting = false;
      this.status = "Enregistrement du suivi…";
      this.changed();
      await this.recording;
      if (generation !== this.generation || params.threadId !== this.threadId) return;
      if (this.client) {
        const ensureCurrent = () => {
          if (generation !== this.generation || params.threadId !== this.threadId) throw new Error("Conversation interrompue pendant l’enregistrement du journal.");
        };
        const turns = await readConversation(this.client, this.threadId, ensureCurrent);
        this.turns = turns;
        await this.conversation?.(cwd, this.threadId, turns);
        ensureCurrent();
      }
      this.busy = false;
      this.turnId = "";
      this.requests = [];
      this.status = this.failure?.message ?? (turn.status === "interrupted" ? "Tâche interrompue" : "");
    } else if (method === "item/started" || method === "item/completed") {
      const item = toChatItem(object(params.item));
      if (item && !(method === "item/started" && this.items.some(previous => previous.id === item.id))) this.upsert(item);
    } else if (method === "item/agentMessage/delta" && typeof params.delta === "string" && typeof params.itemId === "string") {
      const previous = this.items.find(item => item.id === params.itemId);
      this.upsert({ id: params.itemId, role: "assistant", text: (previous?.text ?? "") + params.delta, paths: [] });
    } else if (method === "serverRequest/resolved") {
      this.requests = this.requests.filter(request => request.id !== params.requestId);
      this.status = this.requests.length ? "En attente de votre réponse" : this.busy ? "Codex travaille…" : "";
    } else if (method === "error") {
      if (params.willRetry) this.status = codexFailure(stringValue(object(params.error).message, "Erreur Codex."), object(params.error).codexErrorInfo).message;
      else this.fail(params.error ?? "Erreur Codex.");
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
      .map(part => stringValue(part.text)).join("\n") };
  }
  if (item.type === "agentMessage") return { ...base, role: "assistant", text: stringValue(item.text),
    ...(typeof item.phase === "string" ? { phase: item.phase } : {}) };
  if (item.type === "commandExecution") {
    const actions = Array.isArray(item.commandActions) ? item.commandActions.map(object) : [];
    return { ...base, role: "activity", text: `Commande · ${stringValue(item.status, "en cours")}\n${stringValue(item.command)}`,
      paths: actions.filter(action => typeof action.path === "string").map(action => String(action.path)) };
  }
  if (item.type === "fileChange" && Array.isArray(item.changes)) {
    return { ...base, role: "activity", text: item.status === "completed" ? "Fichier enregistré" : `Modification · ${stringValue(item.status, "en cours")}`,
      paths: item.changes.map(object).filter(change => typeof change.path === "string").map(change => String(change.path)) };
  }
  if (item.type === "mcpToolCall") return { ...base, role: "activity", text: `Outil · ${stringValue(item.server)}/${stringValue(item.tool)} · ${stringValue(item.status)}` };
  return null;
}

export async function readConversation(client: CodexClient, threadId: string, ensureCurrent: () => void): Promise<ConversationTurn[]> {
  const turns: ConversationTurn[] = [];
  let cursor: string | null = null;
  do {
    const page = await client.request("thread/turns/list", { threadId, limit: 100, sortDirection: "asc", itemsView: "full", cursor });
    ensureCurrent();
    if (!Array.isArray(page.data)) throw new Error("Impossible de lire l’historique Codex.");
    for (const entry of page.data) {
      const turn = object(entry);
      if (typeof turn.id !== "string" || !Array.isArray(turn.items)) throw new Error("Échange Codex invalide dans l’historique.");
      if (turn.status === "inProgress") continue;
      const timestamp = typeof turn.startedAt === "number" ? turn.startedAt : turn.completedAt;
      const date = typeof timestamp === "number" && Number.isFinite(timestamp) ? new Date(timestamp * 1000) : null;
      turns.push({ id: turn.id, date, completed: turn.status === "completed",
        ...(turn.status === "failed" || turn.error ? { failure: codexFailure(stringValue(object(turn.error).message, "La tâche Codex a échoué."), object(turn.error).codexErrorInfo) } : {}),
        messages: turn.items.map(value => toChatItem(object(value))).filter((item): item is ChatItem => item !== null) });
    }
    cursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
  } while (cursor);
  return turns;
}
