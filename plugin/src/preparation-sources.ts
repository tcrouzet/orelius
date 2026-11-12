import { t } from "./i18n.ts";
import type { SceneContext, SceneSource } from "./scene-context.ts";

export interface PreparationSource {
  url: string;
  statut: "consultee" | "indisponible" | "hors-sujet";
  raison: string;
  extrait: string;
  publication: string;
  usage?: "personnage" | "contexte-auteur";
}

export const DOCUMENTATION_SCHEMA = {
  type: "array", description: "Sources externes examinées. Chaque lien fourni dans le cadrage, la demande ou les références doit être consulté ou justifié comme indisponible/hors-sujet. Ajouter les sources découvertes par recherche. Une URL seule ne prouve pas une lecture.",
  items: { type: "object", additionalProperties: false, required: ["url", "statut", "raison", "extrait", "publication"], properties: {
    url: { type: "string" }, statut: { type: "string", enum: ["consultee", "indisponible", "hors-sujet"] },
    raison: { type: "string", description: "Apport précis pour cette scène, ou motif de non-consultation." },
    extrait: { type: "string", description: "Court extrait exact de la source réellement lue ; vide si non consultée." },
    publication: { type: "string", description: "Date de publication trouvée dans la source au format AAAA-MM-JJ, ou inconnue. Métadonnée distincte de la période décrite ; elle n’exclut pas une source rétrospective." },
    usage: { type: "string", enum: ["personnage", "contexte-auteur"], description: "Usage de l’information pour le personnage ou contexte réservé au travail d’auteur. La date de publication ne détermine pas cet usage et ne prouve pas une lecture du personnage." },
  } },
};

export function suppliedLinks(context: Pick<SceneContext, "sources">): string[] {
  const roles = ["project-brief", "author-request", "character-reference", "world-reference", "manual-reference"];
  return [...new Set(context.sources.filter(source => roles.includes(source.role)).flatMap(source =>
    [...source.content.matchAll(/https?:\/\/[^\s<>"\])]+/g)].map(match => match[0].replace(/[.,;!?]+$/, ""))))];
}

export function preparationSources(value: unknown, context: SceneContext): PreparationSource[] {
  const fail = (): never => { throw new Error(t("preparationSourcesInvalid")); };
  if (!Array.isArray(value)) return fail();
  const seen = new Set<string>();
  const result = value.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail();
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some(key => !["url", "statut", "raison", "extrait", "publication", "usage"].includes(key))
      || ["url", "statut", "raison", "extrait", "publication"].some(key => typeof row[key] !== "string")
      || row.usage !== undefined && !["personnage", "contexte-auteur"].includes(String(row.usage))
      || !String(row.raison).trim() || !String(row.publication).trim()) return fail();
    const source = row as unknown as PreparationSource;
    try { const url = new URL(source.url); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return fail(); } catch { return fail(); }
    if (seen.has(source.url) || !["consultee", "indisponible", "hors-sujet"].includes(source.statut)
      || (source.statut === "consultee" ? !source.extrait.trim() : !!source.extrait.trim())) return fail();
    seen.add(source.url);
    return source;
  });
  if (suppliedLinks(context).some(url => !seen.has(url))) throw new Error(t("preparationLinksMissing"));
  return result;
}

export function documentationSources(sources: PreparationSource[]): SceneSource[] {
  return sources.filter(source => source.statut === "consultee").map(source => ({
    path: source.url, role: source.usage === "contexte-auteur" ? "documentary-background-not-character-knowledge" : "external-documentation", content: `Publication : ${source.publication}\n\n${source.extrait}`,
    reason: `Apport déclaré : ${source.raison}. Consultation déclarée par le rédacteur ; ne prouve ni un événement fictif ni la connaissance d’un personnage.`,
  }));
}
