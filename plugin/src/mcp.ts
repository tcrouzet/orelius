import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { errorText, object, type RpcObject } from "./codex.ts";

export const STRUCTURE_TOOL = "consulter_structure";
export const LINK_TOOL = "relier_elements";

export const WORKSHOP_TOOL = "consulter_atelier";
export const FILE_TOOL = "ecrire_fichier";
export const CONTEXT_TOOL = "consulter_contexte_editorial";
export const METHOD_TOOL = "consulter_methode";
export const BATCH_TOOL = "revoir_lots";
export const WORKFLOW_TOOL = "consulter_suivi_narratif";
export const STATE_TOOL = "enregistrer_etat_narratif";

export const REVIEW_TOOL = "preparer_chapitre";

export class ProjectMcp {
  readonly token = randomBytes(32).toString("hex");
  private closed = false;
  private readonly variants?: (args: RpcObject) => Promise<string>;
  private readonly structure?: (args?: RpcObject) => Promise<string>;
  private readonly workshop?: (page: number) => Promise<string>;
  private readonly batch?: (args: RpcObject) => Promise<string>;
  private readonly workflow?: () => Promise<string>;
  private readonly method?: (args: RpcObject) => Promise<string>;
  private readonly state?: (args: RpcObject) => Promise<string>;
  private readonly write: (path: string, content: string) => Promise<string>;
  private readonly prepareChapter?: (args: RpcObject) => Promise<string>;
  private readonly readContext?: (page: number, chapter?: string) => Promise<string>;
  private server = createServer((request, response) => {
    void (async () => {
      const authorization = Buffer.from(request.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${this.token}`);
      if (request.headers.origin || authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
        response.writeHead(403).end();
        return;
      }
      if (request.url !== "/mcp") { response.writeHead(404).end(); return; }
      if (request.method !== "POST") { response.writeHead(405, { Allow: "POST" }).end(); return; }
      if (!request.headers["content-type"]?.startsWith("application/json")) { response.writeHead(415).end(); return; }
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        const data: unknown = chunk;
        if (!Buffer.isBuffer(data)) throw new Error("Corps de requête binaire attendu.");
        size += data.length;
        if (size > 16 * 1024 * 1024) { response.writeHead(413).end(); return; }
        chunks.push(data);
      }
      let message: RpcObject;
      try { message = object(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { this.reply(response, { id: null, error: { code: -32700, message: "JSON invalide." } }); return; }
      if (message.jsonrpc !== "2.0" || typeof message.method !== "string"
        || (message.id !== undefined && typeof message.id !== "string" && typeof message.id !== "number")) {
        this.reply(response, { id: null, error: { code: -32600, message: "Requête invalide." } });
        return;
      }
      if (message.id === undefined) { response.writeHead(202).end(); return; }
      const params = object(message.params);
      let result: RpcObject;
      if (message.method === "initialize") {
        const version = ["2025-03-26", "2025-06-18", "2025-11-25"].includes(String(params.protocolVersion))
          ? params.protocolVersion : "2025-11-25";
        result = { protocolVersion: version, capabilities: { tools: {} },
          serverInfo: { name: "orelius", version: "0.1.0" },
          instructions: "Create or modify project files only with ecrire_fichier. Orelius archives originals before writing. Never use shell writes or apply_patch. If a write fails, report the error; do not bypass this tool." };
      } else if (message.method === "ping") result = {};
      else if (message.method === "tools/list") {
        result = { tools: [
          ...(this.variants ? [{ name: "proposer_variantes", description: "Enregistrer deux ou trois variantes de la sélection active pour comparaison et choix par l’auteur. Ne remplace pas le chapitre.", inputSchema: { type: "object", properties: { variantes: { type: "array", minItems: 2, maxItems: 3, items: { type: "object", properties: { titre: { type: "string" }, texte: { type: "string" } }, required: ["titre", "texte"], additionalProperties: false } } }, required: ["variantes"], additionalProperties: false } }] : []),
          ...(this.structure ? [
            { name: STRUCTURE_TOOL, description: "Consulter les identifiants persistants, empreintes, décisions de l’auteur et liens entre fiches et passages. Les liens périmés doivent être revalidés ; les propositions ne sont pas des faits acquis.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
            { name: LINK_TOOL, description: "Relier des identifiants lus dans consulter_structure. developpe : graine vers plan ; planifie : plan vers scène ; implique : personnage, intrigue ou arc vers scène ; realise : scène vers chapitre avec citation exacte et position UTF-16. Fournir les empreintes actuelles. remove supprime un lien. Ne décide jamais à la place de l’auteur.", inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, relation: { type: "string", enum: ["developpe", "planifie", "implique", "realise"] }, fromHash: { type: "string" }, toHash: { type: "string" }, quote: { type: "string" }, at: { type: "integer", minimum: 0 }, remove: { type: "boolean" } }, required: ["from", "to", "relation", "fromHash", "toHash"], additionalProperties: false } }
          ] : []),
          ...(this.workshop ? [{ name: WORKSHOP_TOOL, description: "Lire l’inventaire paginé des sources actuelles de Manuscript, Model et Bible avant de peupler l’atelier. Lire page 0 puis toutes les pages. Ne modifie aucun texte.", inputSchema: { type: "object", properties: { page: { type: "integer", minimum: 0 } }, additionalProperties: false } }] : []),
          ...(this.batch ? [{ name: BATCH_TOOL, description: "Revue persistante du chapitre par lots. ouvrir reprend la même version, suivant renvoie le premier lot non terminé, terminer consigne des remarques citées. Aucun manuscrit modifié ; une nouvelle version exige ouvrir et archive la revue précédente.", inputSchema: { type: "object", properties: { action: { type: "string", enum: ["ouvrir", "suivant", "terminer"] }, lot: { type: "integer", minimum: 0 }, empreinte: { type: "string" }, remarques: { type: "array", items: { type: "object", properties: { quote: { type: "string" }, issue: { type: "string" }, suggestion: { type: "string" } }, required: ["quote", "issue", "suggestion"], additionalProperties: false } } }, required: ["action"], additionalProperties: false } }] : []),
          ...(this.workflow ? [{ name: WORKFLOW_TOOL, description: "Lister les états narratifs absents ou périmés des chapitres du projet et actualiser le registre visible. Ne rédige aucun chapitre.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] : []),
          ...(this.method ? [{ name: METHOD_TOOL, description: "Consulter une tâche d’atelier et son prompt exact : idees, synopsis, planifier, decomposer-scene, resumer, developper, reformuler, condenser, critiquer, extraire-style, adapter, actualiser-bible, decrire, continuer. Dossier du chapitre préalablement lu. Sélection début/fin UTF-16 ou lot de revue, voisinage et empreinte. La trace reste dans Context. N’élargit pas la portée d’écriture.", inputSchema: { type: "object", properties: { tache: { type: "string" }, consigne: { type: "string" }, debut: { type: "integer", minimum: 0 }, fin: { type: "integer", minimum: 0 }, lot: { type: "integer", minimum: 0 }, acteur: { type: "string" } }, required: ["tache"], additionalProperties: false } }] : []),
          ...(this.state ? [{ name: STATE_TOOL, description: "Enregistrer un résumé et les progressions du chapitre conservé. hash est le SHA-256 du texte (consulter_methode). Faits et moments exigent une citation exacte. knownBy distingue lecteur, narrateur et personnages. mode append ou replace s’applique au champ de la fiche entity (chemin Markdown). Les états périmés seront exclus du contexte.", inputSchema: { type: "object", properties: { chapter: { type: "string" }, hash: { type: "string" }, summary: { type: "string" }, facts: { type: "array", items: { type: "object", properties: { entity: { type: "string" }, field: { type: "string" }, value: { type: "string" }, quote: { type: "string" }, mode: { type: "string", enum: ["append", "replace"] }, knownBy: { type: "array", items: { type: "string" } }, at: { type: "integer", minimum: 0 } }, required: ["entity", "field", "value", "quote", "mode", "knownBy"], additionalProperties: false } }, moments: { type: "array", items: { type: "object", properties: { id: { type: "string" }, description: { type: "string" }, quote: { type: "string" }, after: { type: "string" }, offset: { type: "number" }, at: { type: "number" }, duration: { type: "number", minimum: 0 }, unit: { type: "string", enum: ["seconds", "minutes", "hours", "days"] } }, required: ["id", "description", "quote"], additionalProperties: false } } }, required: ["chapter", "hash", "summary", "facts", "moments"], additionalProperties: false } }] : []),
          { name: FILE_TOOL, description: "Créer ou remplacer un fichier UTF-8 du projet. Le plugin archive l’original et une copie du texte généré avant de publier le fichier ; un échec d’archivage empêche l’écriture. Fournir le contenu complet du fichier. Pour un chapitre, consulter son dossier puis appeler preparer_chapitre avant de rédiger la prose. Le candidat est contrôlé avant publication ; un premier refus autorise une seule reprise. Ne pas afficher les brouillons dans le chat.",
          inputSchema: { type: "object", properties: { chemin: { type: "string", description: "Chemin relatif à la racine du projet." }, contenu: { type: "string", description: "Contenu complet du fichier UTF-8." } }, required: ["chemin", "contenu"], additionalProperties: false },
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
          ...(this.prepareChapter ? [{ name: REVIEW_TOOL,
            description: "Avant de rédiger la prose, enregistrer la préparation narrative dans Manuscript/Context : situation initiale, objectif, actions causales, connaissances du narrateur/personnages/lecteur, arrivée, corrections et incertitudes. Le dossier du même chapitre doit être lu. Ni prose finale ni autoévaluation de qualité. Aucun changement du manuscrit.",
            inputSchema: { type: "object", properties: {
              chemin: { type: "string" }, situation: { type: "string" }, objectif: { type: "string" },
              actions: { type: "array", minItems: 1, items: { type: "string" } },
              connaissances: { type: "string" }, arrivee: { type: "string" }, corrections: { type: "string" }, incertitudes: { type: "string" },
            }, required: ["chemin", "situation", "objectif", "actions", "connaissances", "arrivee", "corrections", "incertitudes"], additionalProperties: false },
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }] : []),
          ...(this.readContext ? [{ name: CONTEXT_TOOL,
            description: "Lire toutes les pages avant de préparer un chapitre. Indiquer chapitre pour choisir la cible, y compris pour un nouveau chapitre. La page 0 reconstruit le dossier depuis les fichiers actuels et le conserve dans Manuscript/Context. Sources séparées : manuscrit, raccord précédent, plan prévu, personnages, voix acceptée et corrections. Les anciens résumés ne sont pas des faits acquis. Repartir de la page 0 si une source change. Sans chapitre, consultation générale du suivi.",
            inputSchema: { type: "object", properties: { page: { type: "integer", minimum: 0 }, chapitre: { type: "string", description: "Chemin relatif du chapitre ciblé. Facultatif si un chapitre est déjà actif." } }, additionalProperties: false },
            annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }] : [])] };
      } else if (message.method === "tools/call") {
        try {
          const args = object(params.arguments);
          if (this.closed) throw new Error("Connexion Orelius fermée.");
          if (params.name === "proposer_variantes" && this.variants) {
            result = { content: [{ type: "text", text: await this.variants(args) }], isError: false };
            this.reply(response, { id: message.id, result });
            return;
          }
          if ((params.name === STRUCTURE_TOOL || params.name === LINK_TOOL) && this.structure) {
            if (params.name === STRUCTURE_TOOL && Object.keys(args).length) throw new Error("Aucun argument attendu.");
            result = { content: [{ type: "text", text: await this.structure(params.name === LINK_TOOL ? args : undefined) }], isError: false };
            this.reply(response, { id: message.id, result });
            return;
          }
          if (params.name === WORKSHOP_TOOL && this.workshop) {
            const page = args.page ?? 0;
            if (Object.keys(args).some(key => key !== "page") || typeof page !== "number" || !Number.isSafeInteger(page) || page < 0) throw new Error("Page d’atelier invalide.");
            this.reply(response, { id: message.id, result: { content: [{ type: "text", text: await this.workshop(page) }], isError: false } });
            return;
          }
          if (params.name === BATCH_TOOL && this.batch || params.name === WORKFLOW_TOOL && this.workflow) {
            if (params.name === WORKFLOW_TOOL && Object.keys(args).length) throw new Error("Aucun argument attendu.");
            const text = params.name === BATCH_TOOL ? await this.batch!(args) : await this.workflow!();
            this.reply(response, { id: message.id, result: { content: [{ type: "text", text }], isError: false } });
            return;
          }
          if (params.name === METHOD_TOOL && this.method || params.name === STATE_TOOL && this.state) {
            const action = params.name === METHOD_TOOL ? this.method! : this.state!;
            result = { content: [{ type: "text", text: await action(args) }], isError: false };
            this.reply(response, { id: message.id, result });
            return;
          }
          if (params.name === REVIEW_TOOL && this.prepareChapter) {
            result = { content: [{ type: "text", text: await this.prepareChapter(args) }], isError: false };
            this.reply(response, { id: message.id, result });
            return;
          }
          if (params.name === CONTEXT_TOOL && this.readContext) {
            const page = args.page === undefined ? 0 : args.page;
            if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 0 || (args.chapitre !== undefined && typeof args.chapitre !== "string") || Object.keys(args).some(key => !["page", "chapitre"].includes(key))) {
              throw new Error("Une page entière positive ou nulle est attendue.");
            }
            result = { content: [{ type: "text", text: await this.readContext(page, typeof args.chapitre === "string" ? args.chapitre : undefined) }], isError: false };
            this.reply(response, { id: message.id, result });
            return;
          }
          if (params.name !== FILE_TOOL || typeof args.chemin !== "string" || !args.chemin || args.chemin.includes("\0")
            || typeof args.contenu !== "string" || Object.keys(args).some(key => !["chemin", "contenu"].includes(key))) {
            throw new Error("Outil ou arguments d’écriture invalides.");
          }
          const text = await this.write(args.chemin, args.contenu);
          result = { content: [{ type: "text", text }], isError: false };
        } catch (error) { result = { content: [{ type: "text", text: errorText(error) }], isError: true }; }
      } else {
        this.reply(response, { id: message.id, error: { code: -32601, message: "Méthode inconnue." } });
        return;
      }
      this.reply(response, { id: message.id, result });
    })().catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); });
  });

  constructor(write: (path: string, content: string) => Promise<string>, readContext?: (page: number, chapter?: string) => Promise<string>, prepareChapter?: (args: RpcObject) => Promise<string>, method?: (args: RpcObject) => Promise<string>, state?: (args: RpcObject) => Promise<string>, batch?: (args: RpcObject) => Promise<string>, workflow?: () => Promise<string>, workshop?: (page: number) => Promise<string>, structure?: (args?: RpcObject) => Promise<string>, variants?: (args: RpcObject) => Promise<string>) {
    this.variants = variants;
    this.structure = structure;
    this.workshop = workshop;
    this.batch = batch;
    this.workflow = workflow;
    this.method = method;
    this.state = state;
    this.write = write;
    this.readContext = readContext;
    this.prepareChapter = prepareChapter;
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => { this.server.off("error", reject); resolve(); });
    });
    if (this.closed) { await this.stop(); throw new Error("Connexion Orelius fermée."); }
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Impossible de lancer l’outil d’écriture Orelius.");
    return `http://127.0.0.1:${address.port}/mcp`;
  }

  stop(): Promise<void> {
    this.closed = true;
    return new Promise(resolve => { this.server.close(() => resolve()); this.server.closeAllConnections(); });
  }

  private reply(response: ServerResponse, message: RpcObject): void {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", ...message }));
  }
}
