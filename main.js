"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// plugin/src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => OreliusPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");
var import_promises5 = require("node:fs/promises");
var import_node_path4 = require("node:path");

// plugin/src/codex.ts
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_promises = require("node:fs/promises");
var import_node_os = require("node:os");
var import_node_path = require("node:path");
var import_node_timers = require("node:timers");
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
async function findCodex(configured, extended = false) {
  const custom = configured.trim().replace(/^~\//, `${(0, import_node_os.homedir)()}/`);
  if (custom && !(0, import_node_path.isAbsolute)(custom)) {
    throw new Error("Indiquez un chemin absolu vers Codex, ou laissez le champ vide pour la d\xE9tection automatique.");
  }
  const candidates = custom ? [custom] : [
    ...(process.env.PATH ?? "").split(import_node_path.delimiter).filter(Boolean).map((dir) => (0, import_node_path.join)(dir, "codex")),
    (0, import_node_path.join)((0, import_node_os.homedir)(), ".local/bin/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex"
  ];
  if (extended && !custom) {
    candidates.push((0, import_node_path.join)((0, import_node_os.homedir)(), ".volta/bin/codex"), (0, import_node_path.join)((0, import_node_os.homedir)(), ".npm-global/bin/codex"));
    for (const directory of [".codex/packages/standalone/releases", ".nvm/versions/node"]) {
      const root = (0, import_node_path.join)((0, import_node_os.homedir)(), directory);
      const entries = await (0, import_promises.readdir)(root, { withFileTypes: true }).catch(() => []);
      for (const entry of entries.filter((entry2) => entry2.isDirectory()).sort((a, b) => b.name.localeCompare(a.name, void 0, { numeric: true }))) {
        candidates.push((0, import_node_path.join)(root, entry.name, "bin/codex"));
      }
    }
  }
  for (const candidate of candidates) {
    try {
      await (0, import_promises.access)(candidate, import_node_fs.constants.X_OK);
      if ((await (0, import_promises.stat)(candidate)).isFile()) return candidate;
    } catch {
    }
  }
  throw new Error("Codex introuvable. Installez Codex CLI, puis indiquez son chemin dans R\xE9glages \u2192 Orelius.");
}
var CodexClient = class {
  constructor(handlers) {
    this.child = null;
    this.buffer = "";
    this.nextId = 0;
    this.stopping = false;
    this.threadConfig = {};
    this.pending = /* @__PURE__ */ new Map();
    this.handlers = handlers;
  }
  async connect(executable, cwd) {
    if (this.child) throw new Error("Une connexion Codex est d\xE9j\xE0 ouverte.");
    this.stopping = false;
    this.buffer = "";
    const child = (0, import_node_child_process.spawn)(executable, [
      "app-server",
      "--listen",
      "stdio://",
      "--disable",
      "apps",
      "--disable",
      "plugins",
      "--disable",
      "multi_agent",
      "--disable",
      "multi_agent_v2"
    ], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32"
    });
    this.child = child;
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4e3);
    });
    child.stdout.setEncoding("utf8").on("data", (chunk) => this.receive(chunk));
    child.stdin.on("error", (error) => this.fail(error));
    child.once("error", (error) => this.fail(error));
    child.once("close", (code) => {
      if (this.child === child) {
        this.fail(new Error(`Codex s\u2019est arr\xEAt\xE9 (code ${code ?? "inconnu"}). ${stderr.trim()}`));
      }
    });
    try {
      const result = await this.request("initialize", {
        clientInfo: { name: "orelius", title: "Orelius", version: "0.1.0" },
        capabilities: { experimentalApi: false }
      });
      const version = String(result.userAgent ?? "").match(/\b0\.163\.\d+\b/)?.[0];
      if (!version) {
        throw new Error("Version Codex incompatible avec ce socle. Version prise en charge : 0.163.x (test\xE9e : 0.163.0).");
      }
      this.write({ method: "initialized" });
      const account = await this.request("account/read", { refreshToken: false });
      if (account.requiresOpenaiAuth === true && !account.account) {
        throw new Error("Codex n\u2019est pas connect\xE9. Lancez \xAB codex login \xBB dans le terminal, puis r\xE9essayez.");
      }
      const { config } = await this.request("config/read", { cwd, includeLayers: false });
      this.threadConfig = { mcp_servers: Object.fromEntries(Object.keys(object(object(config).mcp_servers)).map((name) => [name, { enabled: false }])) };
      return version;
    } catch (error) {
      this.stop();
      throw error;
    }
  }
  request(method, params) {
    if (method === "thread/start" || method === "thread/resume") {
      params = { ...params, config: { ...object(params.config), ...this.threadConfig } };
    }
    const id = ++this.nextId;
    return new Promise((resolve3, reject) => {
      const timer = (0, import_node_timers.setTimeout)(() => {
        this.pending.delete(id);
        const error = new Error(`Codex ne r\xE9pond pas \xE0 ${method}. V\xE9rifiez sa disponibilit\xE9, puis reconnectez-vous.`);
        reject(error);
        this.fail(error);
      }, 3e4);
      this.pending.set(id, { resolve: resolve3, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (error) {
        (0, import_node_timers.clearTimeout)(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  respond(id, result) {
    this.write({ id, result });
  }
  rejectRequest(id) {
    this.write({ id, error: { code: -32601, message: "Cette demande n\u2019est pas prise en charge par Orelius." } });
  }
  stop() {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    this.rejectPending(new Error("Connexion Codex ferm\xE9e."));
    if (!child) return;
    child.stdin.destroy();
    const signal = (name) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, name);
        else child.kill(name);
      } catch (error) {
        if (object(error).code !== "ESRCH") console.error("Orelius : arr\xEAt du processus impossible", error);
      }
    };
    signal("SIGTERM");
    (0, import_node_timers.setTimeout)(() => signal("SIGKILL"), 1500).unref();
  }
  write(message) {
    if (!this.child || this.child.stdin.destroyed) throw new Error("Codex n\u2019est pas connect\xE9.");
    this.child.stdin.write(`${JSON.stringify(message)}
`);
  }
  receive(chunk) {
    this.buffer += chunk;
    let end;
    while ((end = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (!line.trim()) continue;
      if (line.length > 16 * 1024 * 1024) {
        this.fail(new Error("R\xE9ponse Codex trop volumineuse."));
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
          (0, import_node_timers.clearTimeout)(pending.timer);
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(String(object(message.error).message ?? "Erreur Codex.")));
          else pending.resolve(object(message.result));
        }
      } catch (error) {
        this.fail(new Error(`\xC9change Codex invalide : ${errorText(error)}`));
        return;
      }
    }
    if (this.buffer.length > 16 * 1024 * 1024) this.fail(new Error("R\xE9ponse Codex trop volumineuse."));
  }
  rejectPending(error) {
    for (const pending of this.pending.values()) {
      (0, import_node_timers.clearTimeout)(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
  fail(error) {
    if (this.stopping) return;
    this.stop();
    this.handlers.exit(error.message);
  }
};

// plugin/src/session.ts
var import_promises3 = require("node:fs/promises");

// plugin/src/archives.ts
var import_node_crypto = require("node:crypto");
var import_node_fs2 = require("node:fs");
var import_promises2 = require("node:fs/promises");
var import_node_path2 = require("node:path");

// plugin/src/settings.ts
var PROJECT_FOLDER_KEYS = ["archiveFolder", "manuscriptFolder", "bibleFolder"];
var DEFAULT_PROJECT_FOLDERS = {
  archiveFolder: "Archives",
  manuscriptFolder: "Manuscript",
  bibleFolder: "Bible"
};
function validateFolderName(name) {
  if (typeof name !== "string" || !name || name !== name.trim() || name.startsWith(".") || /[<>:"/\\|?*\u0000-\u001f\u007f]/.test(name) || name.endsWith(".")) {
    throw new Error("Indiquez un nom de dossier simple, sans chemin ni caract\xE8re r\xE9serv\xE9.");
  }
}
function validateProjectFolders(folders) {
  const names = PROJECT_FOLDER_KEYS.map((key) => {
    validateFolderName(folders[key]);
    return folders[key].normalize("NFC").toLowerCase();
  });
  if (new Set(names).size !== names.length || names.slice(1).includes("_archives") || names.some((name) => name === "agents.md" || name === "agents.override.md")) {
    throw new Error("Les dossiers doivent avoir des noms distincts ; AGENTS.md, AGENTS.override.md et les anciennes archives _Archives sont r\xE9serv\xE9s.");
  }
}
function projectPaths(folders) {
  validateProjectFolders(folders);
  const content = [
    folders.manuscriptFolder,
    ...["Chapitres", "Personnages", "Plan", "Resume"].map((name) => `${folders.manuscriptFolder}/${name}`),
    folders.bibleFolder
  ];
  return [folders.archiveFolder, ...content, ...content.map((path) => `${folders.archiveFolder}/${path}`)];
}
function associatedFolder(settings, path) {
  return [settings.folder, ...Object.keys(settings.sessions)].filter((folder) => folder === "" || path === folder || path.startsWith(`${folder}/`)).sort((a, b) => b.length - a.length)[0];
}
function visibleFolder(settings, path, busy) {
  const folder = associatedFolder(settings, path);
  return busy && folder !== settings.folder ? void 0 : folder;
}
function folderSession(settings) {
  return Object.prototype.hasOwnProperty.call(settings.sessions, settings.folder) ? settings.sessions[settings.folder] : void 0;
}
function loadSettings(value) {
  const saved = object(value);
  const settings = {
    ...DEFAULT_PROJECT_FOLDERS,
    codexPath: "",
    folder: "",
    threadId: "",
    threadCwd: "",
    sessions: {}
  };
  for (const key of ["codexPath", "folder", "threadId", "threadCwd"]) {
    if (typeof saved[key] === "string") settings[key] = saved[key];
  }
  for (const key of PROJECT_FOLDER_KEYS) {
    if (saved[key] === void 0) continue;
    if (typeof saved[key] !== "string") throw new Error(`Nom de dossier invalide pour ${DEFAULT_PROJECT_FOLDERS[key]}.`);
    settings[key] = saved[key];
  }
  if (saved.sessions !== void 0 && (saved.sessions === null || typeof saved.sessions !== "object" || Array.isArray(saved.sessions))) {
    throw new Error("Les associations entre dossiers et sessions Codex sont invalides.");
  }
  settings.sessions = Object.fromEntries(Object.entries(object(saved.sessions)).map(([folder, value2]) => {
    const session = object(value2);
    if (typeof session.threadId !== "string" || typeof session.cwd !== "string") {
      throw new Error(`Association Codex invalide pour le dossier \xAB ${folder || "Racine du coffre"} \xBB.`);
    }
    return [folder, { threadId: session.threadId, cwd: session.cwd }];
  }));
  if (settings.threadId && !folderSession(settings)) {
    settings.sessions = {
      ...settings.sessions,
      [settings.folder]: { threadId: settings.threadId, cwd: settings.threadCwd }
    };
  }
  return applySettings(settings, {});
}
function applySettings(previous, changes) {
  const next = { ...previous, ...changes };
  validateProjectFolders(next);
  if (changes.threadId !== void 0 || changes.threadCwd !== void 0) {
    next.sessions = {
      ...previous.sessions,
      [next.folder]: { threadId: next.threadId, cwd: next.threadCwd }
    };
  }
  const session = folderSession(next);
  return { ...next, threadId: session?.threadId ?? "", threadCwd: session?.cwd ?? "" };
}

// plugin/src/archives.ts
async function checkPath(root, path) {
  let current = root;
  for (const part of (0, import_node_path2.relative)(root, path).split(import_node_path2.sep)) {
    current = (0, import_node_path2.join)(current, part);
    let info;
    try {
      info = await (0, import_promises2.lstat)(current);
    } catch (error) {
      if (object(error).code === "ENOENT") return;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error("Les liens symboliques ne peuvent pas \xEAtre modifi\xE9s ni servir d\u2019archives.");
  }
}
async function prepareProject(cwd, folders) {
  const paths = projectPaths(folders);
  const root = await (0, import_promises2.realpath)(cwd);
  for (const path of paths) {
    const target = (0, import_node_path2.join)(root, path);
    await checkPath(root, target);
    try {
      await (0, import_promises2.mkdir)(target);
    } catch (error) {
      if (object(error).code !== "EEXIST") throw error;
    }
    if (!(await (0, import_promises2.lstat)(target)).isDirectory()) throw new Error(`Un fichier occupe le chemin du dossier ${path}.`);
    await checkPath(root, target);
  }
}
async function archiveChanges(cwd, changes, checkEditor = () => {
}, archiveFolder = DEFAULT_PROJECT_FOLDERS.archiveFolder) {
  validateFolderName(archiveFolder);
  if (!Array.isArray(changes) || !changes.length) throw new Error("Liste des modifications absente. \xC9criture refus\xE9e.");
  const root = await (0, import_promises2.realpath)(cwd);
  const suppliedRoot = (0, import_node_path2.resolve)(cwd);
  const targets = changes.map((value) => {
    const change = object(value);
    const kind = object(change.kind);
    if (typeof change.path !== "string" || !change.path || change.path.includes("\0") || !["add", "update"].includes(String(kind.type)) || kind.move_path != null) {
      throw new Error("Seules la cr\xE9ation et la modification de fichiers sont prises en charge.");
    }
    const requested = (0, import_node_path2.resolve)(suppliedRoot, change.path);
    const target = requested.startsWith(`${suppliedRoot}${import_node_path2.sep}`) ? (0, import_node_path2.resolve)(root, (0, import_node_path2.relative)(suppliedRoot, requested)) : requested;
    const path = (0, import_node_path2.relative)(root, target);
    if (!path || path === ".." || path.startsWith(`..${import_node_path2.sep}`) || (0, import_node_path2.isAbsolute)(path) || [archiveFolder.normalize("NFC").toLowerCase(), "_archives", ".obsidian", ".git"].includes(path.split(import_node_path2.sep)[0].normalize("NFC").toLowerCase())) {
      throw new Error(`\xC9criture refus\xE9e : le fichier doit appartenir au projet, hors ${archiveFolder}, _Archives et dossiers internes.`);
    }
    return { target, path, creating: kind.type === "add" };
  });
  for (const { target } of targets) await checkPath(root, target);
  const archives = [];
  for (const { target, path, creating } of targets) {
    let source;
    try {
      source = await (0, import_promises2.open)(target, import_node_fs2.constants.O_RDONLY | import_node_fs2.constants.O_NOFOLLOW);
    } catch (error) {
      if (creating && object(error).code === "ENOENT") continue;
      throw error;
    }
    try {
      const before = await source.stat();
      if (!before.isFile() || before.nlink !== 1) throw new Error(`Fichier ordinaire sans lien requis : ${path}`);
      const original = await source.readFile();
      checkEditor(path.split(import_node_path2.sep).join("/"), original.toString("utf8"));
      const directory = (0, import_node_path2.join)(root, archiveFolder, (0, import_node_path2.dirname)(path));
      await checkPath(root, directory);
      await (0, import_promises2.mkdir)(directory, { recursive: true });
      await checkPath(root, directory);
      const extension = (0, import_node_path2.extname)(path);
      const version = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}-${(0, import_node_crypto.randomUUID)()}`;
      const archive = (0, import_node_path2.join)(directory, `${(0, import_node_path2.basename)(path, extension)}.${version}${extension}`);
      const copy = await (0, import_promises2.open)(archive, "wx", before.mode & 511);
      try {
        await copy.writeFile(original);
        await copy.sync();
      } finally {
        await copy.close();
      }
      const after = await (0, import_promises2.lstat)(target);
      if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
        throw new Error(`Le fichier a chang\xE9 pendant l\u2019archivage : ${path}. Relancez la demande.`);
      }
      checkEditor(path.split(import_node_path2.sep).join("/"), original.toString("utf8"));
      archives.push((0, import_node_path2.relative)(root, archive).split(import_node_path2.sep).join("/"));
    } finally {
      await source.close();
    }
  }
  return archives;
}

// plugin/src/session.ts
var ChatSession = class {
  constructor(changed, remember, archive = archiveChanges, context = () => DEFAULT_PROJECT_FOLDERS) {
    this.items = [];
    this.requests = [];
    this.status = "D\xE9connect\xE9";
    this.busy = false;
    this.connected = false;
    this.threadId = "";
    this.turnId = "";
    this.client = null;
    this.generation = 0;
    this.operation = 0;
    this.patches = /* @__PURE__ */ new Map();
    this.changed = changed;
    this.remember = remember;
    this.archive = archive;
    this.context = context;
  }
  async connect(executable, cwd, savedThreadId) {
    if (this.busy) throw new Error("Attendez la fin de la t\xE2che ou utilisez Arr\xEAter.");
    const operation = ++this.operation;
    this.busy = true;
    this.status = "Connexion \xE0 Codex\u2026";
    this.changed();
    try {
      await this.initialize(executable, cwd, savedThreadId);
      if (operation === this.operation) this.status = "Pr\xEAt";
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
  async send(text, executable, cwd, savedThreadId) {
    if (this.busy || !text.trim()) return;
    const operation = ++this.operation;
    this.busy = true;
    this.status = "Codex travaille\u2026";
    this.changed();
    try {
      if (!this.connected || !this.threadId) await this.initialize(executable, cwd, savedThreadId, true);
      const client = this.client;
      if (!client) throw new Error("Connexion Codex interrompue.");
      const result = await client.request("turn/start", {
        threadId: this.threadId,
        input: [{ type: "text", text, text_elements: [] }],
        cwd,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "readOnly", networkAccess: false }
      });
      if (operation === this.operation && this.busy) this.turnId = String(object(result.turn).id ?? "");
    } catch (error) {
      if (operation === this.operation) this.disconnect(errorText(error));
      throw error;
    }
  }
  async interrupt() {
    if (!this.busy) return;
    const operation = this.operation;
    if (!this.client || !this.turnId) {
      this.disconnect("Connexion interrompue. Vous pouvez reprendre la conversation.");
      return;
    }
    this.status = "Interruption\u2026";
    this.changed();
    try {
      await this.client.request("turn/interrupt", { threadId: this.threadId, turnId: this.turnId });
    } catch (error) {
      if (operation === this.operation) this.disconnect(errorText(error));
      throw error;
    }
  }
  respond(id, result) {
    const request = this.requests.find((request2) => request2.id === id);
    if (!request || !this.client) throw new Error("Cette demande Codex n\u2019est plus active.");
    this.client.respond(id, result);
    this.requests = this.requests.filter((request2) => request2.id !== id);
    this.status = this.requests.length ? "En attente de votre r\xE9ponse" : "Codex travaille\u2026";
    this.changed();
  }
  disconnect(status = "D\xE9connect\xE9") {
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
  async newConversation() {
    if (this.busy) throw new Error("Attendez la fin de la t\xE2che ou utilisez Arr\xEAter.");
    this.busy = true;
    this.changed();
    try {
      await this.remember("", "");
    } catch (error) {
      this.busy = false;
      this.changed();
      throw error;
    }
    this.disconnect();
    this.threadId = "";
    this.items = [];
    this.changed();
  }
  async initialize(executable, cwd, savedThreadId, createThread = false) {
    const generation = ++this.generation;
    this.client?.stop();
    const client = new CodexClient({
      notification: (method, params) => {
        if (generation === this.generation) this.notification(method, params);
      },
      request: (request) => {
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
                throw new Error("Demande d\u2019\xE9criture hors de la t\xE2che active ou d\u2019extension des permissions refus\xE9e.");
              }
              this.status = "Archivage des originaux\u2026";
              this.changed();
              const paths = await this.archive(cwd, changes, void 0, this.context().archiveFolder);
              if (generation !== this.generation || request.params.turnId !== this.turnId) return;
              if (this.patches.get(String(request.params.itemId)) !== changes) {
                throw new Error("Le patch a chang\xE9 pendant l\u2019archivage. \xC9criture refus\xE9e.");
              }
              if (paths.length) this.upsert({
                id: `archive-${request.params.itemId}`,
                role: "activity",
                text: "Originaux archiv\xE9s avant modification",
                paths
              });
              decision = "accept";
              this.status = "Codex travaille\u2026";
            } catch (error) {
              if (generation !== this.generation) return;
              this.status = `\xC9criture refus\xE9e : ${errorText(error)}`;
              this.upsert({ id: `archive-${request.params.itemId}`, role: "activity", text: this.status, paths: [] });
            }
            if (generation === this.generation) {
              client.respond(request.id, { decision });
              this.patches.delete(String(request.params.itemId));
              this.changed();
            }
          })().catch((error) => {
            if (generation === this.generation) this.disconnect(errorText(error));
          });
          return;
        }
        const supported = [
          "item/commandExecution/requestApproval",
          "item/permissions/requestApproval",
          "item/tool/requestUserInput",
          "mcpServer/elicitation/request"
        ];
        if (!supported.includes(request.method)) {
          client.rejectRequest(request.id);
          this.status = `Demande non prise en charge : ${request.method}`;
        } else {
          this.requests.push(request);
          this.status = "En attente de votre r\xE9ponse";
        }
        this.changed();
      },
      exit: (message) => {
        if (generation === this.generation) this.disconnect(message);
      }
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
      ...savedThreadId ? { threadId: savedThreadId, excludeTurns: true } : { ephemeral: false },
      cwd,
      sandbox: "read-only",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      developerInstructions: [
        context.agentInstructions,
        "Use apply_patch for requested file edits. Orelius must archive originals before approving each patch. Shell writes, permission extensions, deletions and renames are forbidden. Do not change archive directories, .obsidian or .git. If an edit is declined, report it and do not retry through another tool."
      ].filter(Boolean).join("\n\n")
    });
    ensureCurrent();
    const thread = object(result.thread);
    if (typeof thread.id !== "string" || !thread.id || savedThreadId && thread.id !== savedThreadId) {
      throw new Error("Codex n\u2019a pas renvoy\xE9 la conversation attendue. Aucune conversation de remplacement n\u2019a \xE9t\xE9 cr\xE9\xE9e.");
    }
    if (object(result.sandbox).type !== "readOnly" || result.approvalPolicy !== "on-request" || result.approvalsReviewer !== "user" || await (0, import_promises3.realpath)(String(result.cwd)) !== await (0, import_promises3.realpath)(cwd)) {
      throw new Error("Codex n\u2019a pas appliqu\xE9 le dossier ou les permissions demand\xE9s. Connexion arr\xEAt\xE9e.");
    }
    if (object(thread.status).type === "active") {
      throw new Error("Cette conversation est d\xE9j\xE0 occup\xE9e. Arr\xEAtez sa t\xE2che avant de la reprendre dans Orelius.");
    }
    ensureCurrent();
    this.threadId = thread.id;
    const items = [];
    if (savedThreadId) {
      let cursor = null;
      do {
        const page = await client.request("thread/items/list", {
          threadId: thread.id,
          limit: 100,
          sortDirection: "asc",
          cursor
        });
        ensureCurrent();
        if (!Array.isArray(page.data)) throw new Error("Impossible de lire l\u2019historique Codex.");
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
  notification(method, params) {
    if (params.threadId !== this.threadId) return;
    if (method === "turn/started") {
      this.turnId = String(object(params.turn).id ?? "");
      this.busy = true;
      this.status = "Codex travaille\u2026";
    } else if (method === "turn/completed") {
      const turn = object(params.turn);
      this.busy = false;
      this.turnId = "";
      this.requests = [];
      this.patches.clear();
      this.status = turn.status === "failed" ? String(object(turn.error).message ?? "La t\xE2che Codex a \xE9chou\xE9.") : turn.status === "interrupted" ? "T\xE2che interrompue \xB7 pr\xEAt" : "Pr\xEAt";
    } else if (method === "item/started" || method === "item/completed") {
      const raw = object(params.item);
      if (method === "item/started" && raw.type === "fileChange" && typeof raw.id === "string") {
        this.patches.set(raw.id, raw.changes);
      }
      const item = toChatItem(object(params.item));
      if (item && !(method === "item/started" && this.items.some((previous) => previous.id === item.id))) this.upsert(item);
    } else if (method === "item/fileChange/patchUpdated" && typeof params.itemId === "string") {
      this.patches.set(params.itemId, params.changes);
    } else if (method === "item/agentMessage/delta" && typeof params.delta === "string" && typeof params.itemId === "string") {
      const previous = this.items.find((item) => item.id === params.itemId);
      this.upsert({ id: params.itemId, role: "assistant", text: (previous?.text ?? "") + params.delta, paths: [] });
    } else if (method === "serverRequest/resolved") {
      this.requests = this.requests.filter((request) => request.id !== params.requestId);
      this.status = this.requests.length ? "En attente de votre r\xE9ponse" : this.busy ? "Codex travaille\u2026" : "Pr\xEAt";
    } else if (method === "error") {
      this.status = String(object(params.error).message ?? "Erreur Codex.");
    }
    this.changed();
  }
  upsert(item) {
    const index = this.items.findIndex((previous) => previous.id === item.id);
    if (index === -1) this.items.push(item);
    else this.items[index] = item;
  }
};
function toChatItem(item) {
  if (typeof item.id !== "string") return null;
  const base = { id: item.id, paths: [] };
  if (item.type === "userMessage" && Array.isArray(item.content)) {
    return { ...base, role: "user", text: item.content.map(object).filter((part) => part.type === "text").map((part) => String(part.text ?? "")).join("\n") };
  }
  if (item.type === "agentMessage") return { ...base, role: "assistant", text: String(item.text ?? "") };
  if (item.type === "commandExecution") {
    const actions = Array.isArray(item.commandActions) ? item.commandActions.map(object) : [];
    return {
      ...base,
      role: "activity",
      text: `Commande \xB7 ${item.status ?? "en cours"}
${item.command ?? ""}`,
      paths: actions.filter((action) => typeof action.path === "string").map((action) => String(action.path))
    };
  }
  if (item.type === "fileChange" && Array.isArray(item.changes)) {
    return {
      ...base,
      role: "activity",
      text: item.status === "completed" ? "Fichier enregistr\xE9" : `Modification \xB7 ${item.status ?? "en cours"}`,
      paths: item.changes.map(object).filter((change) => typeof change.path === "string").map((change) => String(change.path))
    };
  }
  if (item.type === "mcpToolCall") return { ...base, role: "activity", text: `Outil \xB7 ${item.server}/${item.tool} \xB7 ${item.status}` };
  return null;
}

// plugin/src/settings-tab.ts
var import_obsidian2 = require("obsidian");

// plugin/src/chat-view.ts
var import_obsidian = require("obsidian");
var VIEW_TYPE = "orelius-chat";
var OreliusView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.timer = null;
    this.rendered = /* @__PURE__ */ new Map();
    this.requestKey = "";
    this.active = false;
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Orelius";
  }
  getIcon() {
    return "messages-square";
  }
  async onOpen() {
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
    this.connectButton.onclick = () => {
      void this.run(() => this.plugin.connect());
    };
    this.newButton = actions.createEl("button", { text: "Nouvelle conversation" });
    this.newButton.onclick = () => {
      void this.run(() => this.plugin.session.newConversation());
    };
    this.messagesEl = root.createDiv({ cls: "orelius-messages", attr: { role: "log", "aria-label": "Conversation avec Codex" } });
    this.requestsEl = root.createDiv({ cls: "orelius-requests" });
    const composer = root.createDiv({ cls: "orelius-composer" });
    this.notice = composer.createDiv({ cls: "orelius-error", attr: { role: "alert" } });
    const label = composer.createEl("label", { text: "Votre message" });
    this.input = label.createEl("textarea", { attr: { rows: "4", placeholder: "\xC9crire \xE0 Codex\u2026" } });
    this.input.value = this.plugin.draft;
    this.input.oninput = () => {
      this.plugin.draft = this.input.value;
      this.update();
    };
    this.input.onkeydown = (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing) {
        event.preventDefault();
        void this.send();
      }
    };
    const buttons = composer.createDiv({ cls: "orelius-actions" });
    this.sendButton = buttons.createEl("button", { text: "Envoyer", cls: "mod-cta" });
    this.sendButton.onclick = () => {
      void this.send();
    };
    this.stopButton = buttons.createEl("button", { text: "Arr\xEAter" });
    this.stopButton.onclick = () => {
      void this.run(() => this.plugin.session.interrupt());
    };
    composer.createEl("small", { text: "\u2318/Ctrl + Entr\xE9e pour envoyer \xB7 originaux archiv\xE9s avant modification" });
    this.plugin.attach(this);
    this.render();
    if (this.plugin.settings.threadId && !this.plugin.session.connected && !this.plugin.session.busy) {
      void this.run(() => this.plugin.connect());
    }
  }
  async onClose() {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.clearMessages();
    this.plugin.detach(this);
    this.contentEl.removeClass("orelius-chat");
  }
  update() {
    if (!this.active) return;
    if (!this.timer) this.timer = setTimeout(() => {
      this.timer = null;
      this.render();
    }, 60);
  }
  async run(action) {
    this.notice?.setText("");
    try {
      await action();
    } catch (error) {
      this.notice?.setText(errorText(error));
    }
    this.update();
  }
  async send() {
    const text = this.input.value;
    if (!text.trim() || this.plugin.session.busy) return;
    await this.run(async () => {
      await this.plugin.send(text);
      this.input.value = "";
    });
  }
  render() {
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
      this.messagesEl.createEl("p", { cls: "orelius-empty", text: `Posez une question ou demandez une modification. Les originaux des fichiers modifi\xE9s sont conserv\xE9s dans ${this.plugin.settings.archiveFolder} \xE0 la racine du projet.` });
    } else {
      this.messagesEl.querySelector(".orelius-empty")?.remove();
      const visibleIds = new Set(session.items.map((item) => item.id));
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
  renderItem(item) {
    let rendered = this.rendered.get(item.id);
    const paths = JSON.stringify(item.paths);
    if (rendered?.text === item.text && rendered.paths === paths) return;
    if (rendered) {
      this.removeChild(rendered.component);
      rendered.element.empty();
    } else {
      const element2 = this.messagesEl.createEl("article", { cls: `orelius-message orelius-${item.role}` });
      rendered = { text: "", paths: "", element: element2, component: new import_obsidian.Component() };
      this.rendered.set(item.id, rendered);
    }
    const component = new import_obsidian.Component();
    rendered.component = component;
    rendered.text = item.text;
    rendered.paths = paths;
    this.addChild(component);
    const element = rendered.element;
    element.createEl("strong", { cls: "orelius-role", text: item.role === "user" ? "Vous" : item.role === "assistant" ? "Codex" : "Activit\xE9" });
    const body = element.createDiv({ cls: "orelius-message-body" });
    if (item.role === "activity") body.createEl("pre", { text: item.text });
    else {
      const folder = this.plugin.settings.folder;
      void import_obsidian.MarkdownRenderer.render(this.app, item.text, body, `${folder ? `${folder}/` : ""}.orelius-chat.md`, component).catch((error) => {
        body.setText(item.text);
        console.error("Orelius : rendu Markdown", error);
      });
    }
    for (const path of item.paths) {
      const button = element.createEl("button", { text: path, cls: "orelius-file" });
      button.onclick = () => {
        void this.run(() => this.plugin.openFile(path));
      };
    }
  }
  renderRequest(request) {
    const card = this.requestsEl.createDiv({ cls: "orelius-request" });
    const respond = (result) => {
      void this.run(async () => this.plugin.session.respond(request.id, result));
    };
    if (request.method === "item/tool/requestUserInput" && Array.isArray(request.params.questions)) {
      const inputs = /* @__PURE__ */ new Map();
      for (const value of request.params.questions) {
        const question = object(value);
        const label = card.createEl("label", { text: String(question.question ?? "Question de Codex") });
        if (Array.isArray(question.options)) {
          for (const option of question.options.map(object)) {
            const button = label.createEl("button", { text: String(option.label ?? "") });
            button.onclick = () => {
              const input2 = inputs.get(String(question.id));
              if (input2) input2.value = String(option.label);
            };
          }
        }
        const input = label.createEl("input", { type: question.isSecret === true ? "password" : "text" });
        inputs.set(String(question.id), input);
      }
      card.createEl("button", { text: "R\xE9pondre" }).onclick = () => {
        const answers = Object.fromEntries([...inputs].map(([id, input]) => [id, { answers: [input.value] }]));
        respond({ answers });
      };
      return;
    }
    card.createEl("strong", { text: "Autorisation demand\xE9e" });
    const params = request.params;
    if (typeof params.reason === "string") card.createEl("p", { text: params.reason });
    if (typeof params.message === "string") card.createEl("p", { text: params.message });
    if (typeof params.command === "string") card.createEl("pre", { text: params.command });
    if (typeof params.cwd === "string") card.createEl("p", { text: `Dossier : ${params.cwd}` });
    if (typeof params.grantRoot === "string") card.createEl("p", { text: `\xC9criture : ${params.grantRoot}` });
    const permissions = object(params.permissions);
    const fileSystem = object(permissions.fileSystem);
    for (const [key, label] of [["read", "Lecture"], ["write", "\xC9criture"]]) {
      const paths = fileSystem[key];
      if (Array.isArray(paths)) for (const path of paths) card.createEl("p", { text: `${label} : ${String(path)}` });
    }
    if (permissions.network) card.createEl("p", { text: "Acc\xE8s au r\xE9seau demand\xE9." });
    card.createEl("p", { text: "Les modifications passent par l\u2019archivage automatique d\u2019Orelius. Les commandes d\u2019\xE9criture et les extensions de permissions sont refus\xE9es." });
    card.createEl("button", { text: "Refuser et poursuivre" }).onclick = () => {
      respond(request.method === "item/permissions/requestApproval" ? { permissions: {}, scope: "turn" } : request.method === "mcpServer/elicitation/request" ? { action: "decline", content: null } : { decision: "decline" });
    };
  }
  clearMessages() {
    for (const item of this.rendered.values()) this.removeChild(item.component);
    this.rendered.clear();
    this.messagesEl.empty();
  }
};

// plugin/src/settings-tab.ts
var FolderPicker = class extends import_obsidian2.FuzzySuggestModal {
  constructor(plugin, choose) {
    super(plugin.app);
    this.choose = choose;
    this.setPlaceholder("Choisir le dossier de travail\u2026");
  }
  getItems() {
    return ["", ...this.app.vault.getAllLoadedFiles().filter((file) => file instanceof import_obsidian2.TFolder && !file.isRoot()).map((folder) => folder.path).sort((a, b) => a.localeCompare(b, "fr"))];
  }
  getItemText(folder) {
    return folder || "Racine du coffre";
  }
  onChooseItem(folder) {
    this.choose(folder);
  }
};
var OreliusSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(plugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian2.Setting(containerEl).setName("Codex").setHeading();
    const installationEl = containerEl.createDiv();
    new import_obsidian2.Setting(installationEl).setName("Installation").setDesc("D\xE9tection de Codex\u2026");
    let detectedPath = null;
    let testButton;
    new import_obsidian2.Setting(containerEl).setName("Connexion").setDesc("Utilise l\u2019authentification existante de Codex.").addButton((button) => {
      testButton = button;
      button.setButtonText("Tester Codex").setDisabled(true).onClick(async () => {
        button.setDisabled(true);
        codexStatus.setText("Connexion \xE0 Codex\u2026");
        try {
          const version = await this.plugin.testCodex();
          codexStatus.setText(`Codex ${version} connect\xE9. Authentification disponible.`);
        } catch (error) {
          codexStatus.setText(errorText(error));
        } finally {
          button.setDisabled(!detectedPath);
        }
      });
    });
    const codexStatus = containerEl.createEl("p", { attr: { role: "status" } });
    const showCodex = (path, manual = false) => {
      detectedPath = path;
      installationEl.empty();
      const installation = new import_obsidian2.Setting(installationEl).setName("Installation").setDesc(path ? `Codex d\xE9tect\xE9 : ${path}` : "Codex n\u2019a pas \xE9t\xE9 d\xE9tect\xE9.");
      testButton.setDisabled(!path);
      if (!path) installation.addButton((button) => button.setButtonText("Rechercher Codex").onClick(async () => {
        button.setDisabled(true);
        codexStatus.setText("Recherche de Codex\u2026");
        let found;
        try {
          found = await findCodex("", true);
        } catch {
          showCodex(null, true);
          codexStatus.setText("Codex introuvable. Indiquez le chemin de son ex\xE9cutable.");
          return;
        }
        try {
          await this.plugin.saveSettings({ codexPath: found });
          showCodex(found);
          codexStatus.setText("");
        } catch (error) {
          codexStatus.setText(errorText(error));
          button.setDisabled(false);
        }
      }));
      if (manual) new import_obsidian2.Setting(installationEl).setName("Chemin de Codex").setDesc("Chemin absolu de l\u2019ex\xE9cutable Codex.").addText((text) => {
        let saving = Promise.resolve();
        text.setPlaceholder("/chemin/vers/codex").setValue(this.plugin.settings.codexPath).onChange((value) => {
          codexStatus.setText("");
          saving = this.plugin.saveSettings({ codexPath: value.trim() });
          void saving.catch((error) => codexStatus.setText(errorText(error)));
        });
        text.inputEl.onblur = async () => {
          try {
            await saving;
            const found = await findCodex(this.plugin.settings.codexPath);
            showCodex(found);
            codexStatus.setText("");
          } catch (error) {
            codexStatus.setText(errorText(error));
          }
        };
      });
    };
    void findCodex(this.plugin.settings.codexPath).then((path) => showCodex(path)).catch(() => showCodex(null));
    new import_obsidian2.Setting(containerEl).setName("Dossier de travail").setHeading();
    let selectedFolder;
    const folderSetting = new import_obsidian2.Setting(containerEl).setName("Dossier s\xE9lectionn\xE9").addText((text) => {
      text.setValue(this.plugin.settings.folder || "Racine du coffre");
      selectedFolder = text.inputEl;
      selectedFolder.readOnly = true;
      selectedFolder.setAttribute("aria-label", "Dossier de travail s\xE9lectionn\xE9");
    });
    folderSetting.addButton((button) => button.setButtonText("Parcourir\u2026").onClick(() => {
      if (this.plugin.session.busy) {
        folderStatus.setText("Arr\xEAtez la t\xE2che Codex avant de changer de dossier.");
        return;
      }
      new FolderPicker(this.plugin, (folder) => {
        button.setDisabled(true);
        void this.plugin.saveSettings({ folder }).then(async () => {
          selectedFolder.value = this.plugin.settings.folder || "Racine du coffre";
          folderStatus.setText(`Dossier s\xE9lectionn\xE9 : ${selectedFolder.value}`);
          if (this.plugin.settings.threadId && this.app.workspace.getLeavesOfType(VIEW_TYPE).length) {
            await this.plugin.connect();
          }
        }).catch((error) => folderStatus.setText(errorText(error))).finally(() => button.setDisabled(false));
      }).open();
    }));
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Chaque dossier conserve sa conversation Codex. Les r\xE9glages sont enregistr\xE9s automatiquement."
    });
    const folderStatus = containerEl.createEl("p", { attr: { role: "status" } });
    new import_obsidian2.Setting(containerEl).setName("Organisation du projet").setHeading();
    const labels = { archiveFolder: "Dossier des archives", manuscriptFolder: "Dossier du manuscrit", bibleFolder: "Dossier de la bible" };
    const layoutStatus = containerEl.createEl("p", { attr: { role: "status" } });
    for (const key of PROJECT_FOLDER_KEYS) {
      new import_obsidian2.Setting(containerEl).setName(labels[key]).setDesc(`Par d\xE9faut : ${DEFAULT_PROJECT_FOLDERS[key]}.`).addText((text) => {
        let saving = Promise.resolve();
        text.setPlaceholder(DEFAULT_PROJECT_FOLDERS[key]).setValue(this.plugin.settings[key]).onChange((value) => {
          layoutStatus.setText("");
          saving = this.plugin.saveSettings({ [key]: value.trim() });
          void saving.catch((error) => layoutStatus.setText(errorText(error)));
        });
        text.inputEl.onblur = async () => {
          try {
            await saving;
            await this.plugin.prepareProject();
            layoutStatus.setText("");
          } catch (error) {
            layoutStatus.setText(errorText(error));
          }
        };
      });
    }
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Le manuscrit contient Chapitres, Personnages, Plan et Resume. Les archives reproduisent les chemins du manuscrit et de la bible. Les dossiers existants sont conserv\xE9s."
    });
  }
};

// generate-agent.ts
var import_node_crypto2 = require("node:crypto");
var import_node_fs3 = require("node:fs");
var import_promises4 = require("node:fs/promises");
var import_node_path3 = require("node:path");
var START = "<!-- orelius:agent:start -->";
var END = "<!-- orelius:agent:end -->";
function renderAgent(template, settings) {
  validateProjectFolders(settings);
  const variables = {
    folder: settings.folder || ".",
    archiveFolder: settings.archiveFolder,
    manuscriptFolder: settings.manuscriptFolder,
    bibleFolder: settings.bibleFolder
  };
  const result = template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_match, key) => {
    if (!Object.prototype.hasOwnProperty.call(variables, key)) throw new Error(`Variable d\u2019agent inconnue : {${key}}.`);
    return variables[key];
  }).trimEnd();
  if (!result.trim() || result.includes(START) || result.includes(END)) throw new Error("Mod\xE8le d\u2019agent vide ou contenant des marqueurs r\xE9serv\xE9s.");
  return result;
}
function updateAgent(original, instructions) {
  const block = `${START}
${instructions}
${END}`;
  const start = original.indexOf(START);
  const end = original.indexOf(END);
  if (start === -1 && end === -1) {
    const separator = original ? original.endsWith("\n") ? "\n" : "\n\n" : "";
    return `${original}${separator}${block}
`;
  }
  if (start === -1 || end < start || start !== original.lastIndexOf(START) || end !== original.lastIndexOf(END)) {
    throw new Error("Les marqueurs Orelius de AGENTS.md sont incomplets ou dupliqu\xE9s. Le fichier a \xE9t\xE9 conserv\xE9.");
  }
  return original.slice(0, start) + block + original.slice(end + END.length);
}
async function readAgent(path) {
  let source;
  try {
    source = await (0, import_promises4.open)(path, import_node_fs3.constants.O_RDONLY | import_node_fs3.constants.O_NOFOLLOW);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const stat2 = await source.stat();
    if (!stat2.isFile() || stat2.nlink !== 1) throw new Error("AGENTS.md doit \xEAtre un fichier ordinaire sans lien.");
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await source.readFile());
    return { text, stat: stat2 };
  } finally {
    await source.close();
  }
}
async function generateAgent(cwd, settings, template) {
  const instructions = renderAgent(template, settings);
  const root = await (0, import_promises4.realpath)(cwd);
  const target = (0, import_node_path3.join)(root, "AGENTS.md");
  const previous = await readAgent(target);
  const content = updateAgent(previous?.text ?? "", instructions);
  if (content === previous?.text) return;
  if (previous) {
    await archiveChanges(root, [{ path: "AGENTS.md", kind: { type: "update" } }], void 0, settings.archiveFolder);
  }
  const temporary = (0, import_node_path3.join)(root, `.orelius-agent-${(0, import_node_crypto2.randomUUID)()}.tmp`);
  const output = await (0, import_promises4.open)(temporary, "wx", previous ? previous.stat.mode & 511 : 384);
  try {
    try {
      await output.writeFile(content);
      await output.sync();
    } finally {
      await output.close();
    }
    if (previous) {
      const current = await readAgent(target);
      if (!current || current.text !== previous.text || current.stat.ino !== previous.stat.ino || current.stat.dev !== previous.stat.dev || current.stat.mtimeMs !== previous.stat.mtimeMs || current.stat.ctimeMs !== previous.stat.ctimeMs) {
        throw new Error("AGENTS.md a chang\xE9 pendant la g\xE9n\xE9ration. Le fichier a \xE9t\xE9 conserv\xE9.");
      }
      await (0, import_promises4.rename)(temporary, target);
    } else {
      await (0, import_promises4.link)(temporary, target);
    }
  } finally {
    await (0, import_promises4.rm)(temporary, { force: true });
  }
}

// prompts/agent.md
var agent_default = "# Agent d\u2019\xE9criture du projet\n\n## Dossiers\n\nLes chemins suivants sont relatifs \xE0 la racine du projet `{folder}`.\n\n- `{manuscriptFolder}/` : manuscrit, organis\xE9 en `Chapitres`, `Personnages`, `Plan` et `Resume`.\n- `{bibleFolder}/` : bible du projet, r\xE9f\xE9rences et \xE9l\xE9ments de continuit\xE9.\n- `{archiveFolder}/` : versions originales conserv\xE9es avant les modifications, avec la m\xEAme arborescence que les documents du projet.\n\n## R\xF4le\n\nTu es Orelius, l\u2019assistant d\u2019\xE9criture de l\u2019auteur pour ce projet. Aide-le \xE0 \xE9crire, structurer et r\xE9viser son manuscrit en respectant ses intentions, sa voix et les informations \xE9tablies dans la bible. Lis les documents utiles \xE0 la demande avant de proposer ou d\u2019appliquer une modification. Signale les incoh\xE9rences et les informations manquantes ; distingue clairement les faits du projet de tes suggestions.\n\nR\xE9alise uniquement le travail demand\xE9. Une r\xE9ponse dans le chat ne doit pas cr\xE9er de fichier \xE0 elle seule. Ne lance aucune analyse litt\xE9raire en arri\xE8re-plan sans demande de l\u2019auteur.\n\n## Modifications\n\nUtilise `apply_patch` pour cr\xE9er ou modifier les documents. Orelius conserve l\u2019original dans `{archiveFolder}/` avant d\u2019autoriser chaque modification. Ne modifie pas les archives et ne contourne pas ce m\xE9canisme par une commande ou un autre outil. Si une \xE9criture est refus\xE9e, indique-le et arr\xEAte cette modification.\n\nNe supprime et ne d\xE9place aucun fichier. Pr\xE9serve les modifications de l\u2019auteur. Cette section d\u2019agent est g\xE9r\xE9e depuis le mod\xE8le du plugin ; conserve les consignes personnelles pr\xE9sentes dans le reste de ce fichier.\n";

// plugin/src/main.ts
var OreliusPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.settings = loadSettings(void 0);
    this.draft = "";
    this.views = /* @__PURE__ */ new Set();
    this.settingsWrite = Promise.resolve();
    this.projectWrite = Promise.resolve();
    this.navigation = Promise.resolve();
    this.connecting = null;
    this.sending = false;
    this.openedFile = null;
    this.unloaded = false;
    this.codexTest = null;
  }
  async onload() {
    this.settings = loadSettings(await this.loadData());
    this.session = new ChatSession(
      () => {
        for (const view of this.views) view.update();
      },
      (threadId, cwd) => this.saveSettings({ threadId, threadCwd: cwd }),
      (cwd, changes) => archiveChanges(cwd, changes, (path, content) => {
        const vaultPath = this.settings.folder ? `${this.settings.folder}/${path}` : path;
        this.app.workspace.iterateAllLeaves((leaf) => {
          const view = leaf.view;
          if (view instanceof import_obsidian3.MarkdownView && view.file?.path === vaultPath && view.getViewData() !== content) {
            throw new Error(`La note ${path} a des modifications dans l\u2019\xE9diteur. Attendez leur enregistrement, puis relancez la demande.`);
          }
        });
      }, this.settings.archiveFolder),
      () => ({ ...this.settings, agentInstructions: renderAgent(agent_default, this.settings) })
    );
    this.registerView(VIEW_TYPE, (leaf) => new OreliusView(leaf, this));
    this.addSettingTab(new OreliusSettingTab(this));
    this.addCommand({ id: "open-chat", name: "Ouvrir le chat", callback: () => {
      void this.openChat();
    } });
    this.addRibbonIcon("messages-square", "Ouvrir Orelius", () => {
      void this.openChat();
    });
    this.openedFile = this.app.workspace.getActiveFile()?.path ?? null;
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (file && file.path !== this.openedFile) {
        this.openedFile = file.path;
        this.navigate(file.path);
      }
    }));
    this.registerDomEvent(this.app.workspace.containerEl, "click", (event) => {
      if (!(event.target instanceof Element)) return;
      const title = event.target.closest(".nav-folder-title, .nav-file-title");
      if (!title?.closest('.workspace-leaf-content[data-type="file-explorer"]')) return;
      const path = title.getAttribute("data-path");
      if (path === null) return;
      this.navigate(path === "/" ? "" : path);
    }, { capture: true });
  }
  navigate(path) {
    this.navigation = this.navigation.then(async () => {
      await this.settingsWrite;
      if (this.unloaded) return;
      const folder = visibleFolder(this.settings, path, Boolean(this.session.busy || this.connecting || this.sending));
      if (folder === void 0) {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) leaf.detach();
        return;
      }
      if (folder !== this.settings.folder) await this.saveSettings({ folder });
      if (this.unloaded) return;
      await this.openChat(false);
      if (!this.unloaded && this.settings.threadId && !this.session.connected && !this.session.busy) {
        void this.connect().catch((error) => {
          if (!this.unloaded) new import_obsidian3.Notice(errorText(error));
        });
      }
    }).catch((error) => {
      if (!this.unloaded) new import_obsidian3.Notice(errorText(error));
    });
  }
  onunload() {
    this.unloaded = true;
    this.codexTest?.stop();
    this.codexTest = null;
    this.session.disconnect();
  }
  async openChat(focus = true) {
    try {
      await this.settingsWrite;
      if (this.unloaded) return;
      await this.prepareProject();
      const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0] ?? this.app.workspace.getRightLeaf(false);
      if (!leaf) throw new Error("Impossible d\u2019ouvrir un panneau lat\xE9ral.");
      await leaf.setViewState({ type: VIEW_TYPE, active: focus });
      await this.app.workspace.revealLeaf(leaf);
    } catch (error) {
      new import_obsidian3.Notice(errorText(error));
    }
  }
  attach(view) {
    this.views.add(view);
  }
  detach(view) {
    this.views.delete(view);
  }
  saveSettings(changes) {
    const write = this.settingsWrite.then(async () => {
      const previous = this.settings;
      const changedFolder = changes.folder !== void 0 && changes.folder !== previous.folder;
      const changedLayout = PROJECT_FOLDER_KEYS.some((key) => changes[key] !== void 0 && changes[key] !== previous[key]);
      const changedConnection = changedFolder || changedLayout || changes.codexPath !== void 0 && changes.codexPath !== previous.codexPath;
      if (changedConnection && (this.session.busy || this.connecting || this.sending)) {
        throw new Error("Arr\xEAtez la t\xE2che Codex avant de changer de dossier ou de connexion.");
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
    this.settingsWrite = write.catch(() => {
    });
    return write;
  }
  async testCodex() {
    if (this.codexTest) throw new Error("Un test de connexion est d\xE9j\xE0 en cours.");
    const client = new CodexClient({
      notification() {
      },
      request: (request) => client.rejectRequest(request.id),
      exit() {
      }
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
  async workingDirectory(folder = this.settings.folder) {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof import_obsidian3.FileSystemAdapter)) throw new Error("Orelius n\xE9cessite un coffre local sur Obsidian desktop.");
    if ((0, import_node_path4.isAbsolute)(folder) || folder.split(/[\\/]/).includes("..")) throw new Error("Choisissez un dossier relatif au coffre.");
    const entry = folder ? this.app.vault.getAbstractFileByPath(folder) : this.app.vault.getRoot();
    if (!(entry instanceof import_obsidian3.TFolder)) throw new Error(`Dossier introuvable : ${folder}. Corrigez le dossier dans R\xE9glages \u2192 Orelius.`);
    const root = await (0, import_promises5.realpath)(adapter.getBasePath());
    const cwd = await (0, import_promises5.realpath)((0, import_node_path4.resolve)(root, folder));
    const location = (0, import_node_path4.relative)(root, cwd);
    if (location === ".." || location.startsWith("../") || (0, import_node_path4.isAbsolute)(location)) throw new Error("Le dossier doit rester dans le coffre.");
    return cwd;
  }
  async prepareProject(folder = this.settings.folder, folders = this.settings) {
    const preparation = this.projectWrite.then(async () => {
      const cwd = await this.workingDirectory(folder);
      await prepareProject(cwd, folders);
      await generateAgent(cwd, { ...folders, folder }, agent_default);
      return cwd;
    });
    this.projectWrite = preparation.then(() => {
    }, () => {
    });
    return preparation;
  }
  async connect() {
    if (this.connecting) return this.connecting;
    if (this.sending) return;
    this.connecting = (async () => {
      await this.settingsWrite;
      const cwd = await this.prepareProject();
      if (this.unloaded) return;
      this.checkSavedDirectory(cwd);
      await this.session.connect(this.settings.codexPath, cwd, this.settings.threadId);
    })();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }
  async send(text) {
    await this.settingsWrite;
    if (this.sending || this.connecting || this.session.busy) throw new Error("Attendez la fin de la t\xE2che ou utilisez Arr\xEAter.");
    this.sending = true;
    try {
      const cwd = await this.prepareProject();
      this.checkSavedDirectory(cwd);
      await this.session.send(text, this.settings.codexPath, cwd, this.settings.threadId);
      this.draft = "";
      for (const view of this.views) view.update();
    } finally {
      this.sending = false;
    }
  }
  checkSavedDirectory(cwd) {
    if (this.settings.threadId && this.settings.threadCwd !== cwd) {
      throw new Error("Le dossier de la conversation a chang\xE9. Cr\xE9ez une nouvelle conversation pour ce dossier.");
    }
  }
  async openFile(path) {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof import_obsidian3.FileSystemAdapter)) return;
    const cwd = await this.workingDirectory();
    const root = await (0, import_promises5.realpath)(adapter.getBasePath());
    const target = await (0, import_promises5.realpath)((0, import_node_path4.resolve)(cwd, path));
    const location = (0, import_node_path4.relative)(root, target);
    if (location === ".." || location.startsWith("../") || (0, import_node_path4.isAbsolute)(location)) throw new Error("Ce fichier est ext\xE9rieur au coffre.");
    const file = this.app.vault.getAbstractFileByPath(location);
    if (!(file instanceof import_obsidian3.TFile)) throw new Error(`Fichier introuvable dans Obsidian : ${location}`);
    await this.app.workspace.getLeaf(false).openFile(file);
  }
};
