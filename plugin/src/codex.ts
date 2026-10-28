import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";

export type RpcObject = Record<string, unknown>;
export type RpcId = string | number;
export interface ServerRequest {
  id: RpcId;
  method: string;
  params: RpcObject;
}

interface ClientHandlers {
  notification: (method: string, params: RpcObject) => void;
  request: (request: ServerRequest) => void;
  exit: (message: string) => void;
}

export function object(value: unknown): RpcObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RpcObject : {};
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function codexVersion(userAgent: unknown): string {
  return typeof userAgent === "string"
    ? userAgent.match(/\b\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?\b/)?.[0] ?? "non communiquée"
    : "non communiquée";
}

export async function findCodex(configured: string, extended = false): Promise<string> {
  const custom = configured.trim().replace(/^~\//, `${homedir()}/`);
  if (custom && !isAbsolute(custom)) {
    throw new Error("Indiquez un chemin absolu vers Codex, ou laissez le champ vide pour la détection automatique.");
  }
  const candidates = custom ? [custom] : [
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean).map(dir => join(dir, "codex")),
    join(homedir(), ".local/bin/codex"), "/opt/homebrew/bin/codex", "/usr/local/bin/codex",
  ];
  if (extended && !custom) {
    candidates.push(join(homedir(), ".volta/bin/codex"), join(homedir(), ".npm-global/bin/codex"));
    for (const directory of [".codex/packages/standalone/releases", ".nvm/versions/node"]) {
      const root = join(homedir(), directory);
      const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
      for (const entry of entries.filter(entry => entry.isDirectory())
        .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))) {
        candidates.push(join(root, entry.name, "bin/codex"));
      }
    }
  }
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch { continue; }
  }
  throw new Error("Codex introuvable. Installez Codex CLI, puis indiquez son chemin dans Réglages → Orelius.");
}

export class CodexClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private nextId = 0;
  private stopping = false;
  private closed = Promise.resolve();
  private threadConfig: RpcObject = {};
  private version = "non communiquée";
  private pending = new Map<number, {
    method: string;
    resolve: (result: RpcObject) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  private readonly handlers: ClientHandlers;

  constructor(handlers: ClientHandlers) { this.handlers = handlers; }

  async connect(executable: string, cwd: string, files?: { url: string; token: string }): Promise<string> {
    if (this.child) throw new Error("Une connexion Codex est déjà ouverte.");
    this.stopping = false;
    this.buffer = "";
    this.version = "non communiquée";
    this.threadConfig = {};
    // Only Orelius may write project files, after archiving their originals.
    const child = spawn(executable, ["app-server", "--listen", "stdio://",
      "--disable", "apps", "--disable", "plugins", "--disable", "multi_agent", "--disable", "multi_agent_v2"], {
      cwd, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32",
      env: files ? { ...process.env, ORELIUS_MCP_TOKEN: files.token } : process.env,
    });
    this.child = child;
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => this.receive(chunk));
    child.stdin.on("error", error => this.fail(error));
    child.once("error", error => this.fail(error));
    child.once("close", code => {
      if (this.child === child) {
        this.fail(new Error(`Codex s’est arrêté (code ${code ?? "inconnu"}). ${stderr.trim()}`));
      }
    });
    try {
      const result = await this.request("initialize", {
        clientInfo: { name: "orelius", title: "Orelius", version: "0.1.0" },
        capabilities: { experimentalApi: false },
      });
      if (typeof result.userAgent !== "string" || !result.userAgent.trim()) throw new Error("Réponse d’initialisation Codex invalide : identification du serveur absente.");
      this.version = codexVersion(result.userAgent);
      this.write({ method: "initialized" });
      const account = await this.request("account/read", { refreshToken: false });
      if (account.requiresOpenaiAuth === true && !account.account) {
        throw new Error("Codex n’est pas connecté. Lancez « codex login » dans le terminal, puis réessayez.");
      }
      const { config } = await this.request("config/read", { cwd, includeLayers: false });
      if (config === null || typeof config !== "object" || Array.isArray(config)) {
        throw new Error(`Codex ${this.version} : configuration du serveur invalide. Mettez à jour Codex et Orelius.`);
      }
      this.threadConfig = { mcp_servers: Object.fromEntries(Object.keys(object(object(config).mcp_servers))
        .map(name => [name, { enabled: false }])) };
      if (files) this.threadConfig = { mcp_servers: { ...object(this.threadConfig.mcp_servers), orelius: {
        url: files.url, bearer_token_env_var: "ORELIUS_MCP_TOKEN", enabled: true, required: true,
        default_tools_approval_mode: "approve", enabled_tools: ["ecrire_fichier"],
      } } };
      const models = await this.request("model/list", { limit: 1 });
      if (!Array.isArray(models.data)) throw new Error(`Codex ${this.version} : catalogue des modèles invalide. Mettez à jour Codex et Orelius.`);
      return this.version;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  request(method: string, params: RpcObject): Promise<RpcObject> {
    if (method === "thread/start" || method === "thread/resume") {
      params = { ...params, config: { ...object(params.config), ...this.threadConfig } };
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`Codex ${this.version} ne répond pas à ${method}. Vérifiez sa disponibilité, puis reconnectez-vous.`);
        reject(error);
        this.fail(error);
      }, 30000);
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(errorText(error)));
      }
    });
  }

  respond(id: RpcId, result: RpcObject): void {
    this.write({ id, result });
  }

  rejectRequest(id: RpcId): void {
    this.write({ id, error: { code: -32601, message: "Cette demande n’est pas prise en charge par Orelius." } });
  }

  stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    this.rejectPending(new Error("Connexion Codex fermée."));
    if (!child) return this.closed;
    this.closed = child.pid && child.exitCode === null && child.signalCode === null
      ? new Promise<void>(resolve => { child.once("close", () => resolve()); }) : Promise.resolve();
    child.stdin.destroy();
    const signal = (name: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, name);
        else child.kill(name);
      } catch (error) {
        if (object(error).code !== "ESRCH") console.error("Orelius : arrêt du processus impossible", error);
      }
    };
    signal("SIGTERM");
    // Children can outlive app-server; terminate only its private process group.
    setTimeout(() => signal("SIGKILL"), 1500).unref();
    return this.closed;
  }

  private write(message: RpcObject): void {
    if (!this.child || this.child.stdin.destroyed) throw new Error("Codex n’est pas connecté.");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    let end: number;
    while ((end = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (!line.trim()) continue;
      if (line.length > 16 * 1024 * 1024) {
        this.fail(new Error("Réponse Codex trop volumineuse."));
        return;
      }
      try {
        const message = object(JSON.parse(line));
        if (typeof message.method === "string") {
          const params = object(message.params);
          if (typeof message.id === "number" || typeof message.id === "string") {
            this.handlers.request({ id: message.id, method: message.method, params });
          } else {
            this.handlers.notification(message.method, params);
          }
        } else if (typeof message.id === "number") {
          const pending = this.pending.get(message.id);
          if (!pending) continue;
          clearTimeout(pending.timer);
          this.pending.delete(message.id);
          if (message.error) {
            const error = object(message.error);
            const detail = error.code === -32600 || error.code === -32601
              ? "Fonction indisponible." : stringValue(error.message, "Erreur Codex.");
            const advice = typeof error.code === "number" && [-32600, -32601, -32602].includes(error.code)
              ? " Mettez à jour Codex ou Orelius." : "";
            pending.reject(new Error(`Codex ${this.version} — ${pending.method} : ${detail}${advice}`));
          } else pending.resolve(object(message.result));
        }
      } catch (error) {
        this.fail(new Error(`Échange Codex invalide : ${errorText(error)}`));
        return;
      }
    }
    if (this.buffer.length > 16 * 1024 * 1024) this.fail(new Error("Réponse Codex trop volumineuse."));
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private fail(error: Error): void {
    if (this.stopping) return;
    this.rejectPending(error);
    void this.stop();
    this.handlers.exit(error.message);
  }
}
