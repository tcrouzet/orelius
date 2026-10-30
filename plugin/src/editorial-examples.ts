import { diffToGroups } from "./diff.ts";

export function acceptedChanges(before: string, accepted: string): string {
  const quote = (value: string) => value ? value.split("\n").map(line => `    ${line}`).join("\n") : "    (vide)";
  const changes = diffToGroups(before, accepted, true);
  if (!changes.length) return "";
  const passage = (text: string, from: number, to: number) => {
    if (from === to) return "";
    const start = text.lastIndexOf("\n\n", Math.max(0, from - 1));
    const end = text.indexOf("\n\n", to);
    return text.slice(start === -1 ? 0 : start + 2, end === -1 ? text.length : end);
  };
  let offset = 0;
  const pairs = changes.map(change => {
    const from = change.delFrom + offset;
    const length = change.insText?.length ?? 0;
    offset += length - (change.delTo - change.delFrom);
    if (!length) return { before: change.delText, after: "" };
    if (change.delFrom === change.delTo) return { before: "", after: change.insText ?? "" };
    return { before: passage(before, change.delFrom, change.delTo), after: passage(accepted, from, from + length) };
  });
  return `\n\n## Exemples de reprises acceptées\n\nLes paires suivantes comparent le texte avant reprise à la version effectivement acceptée, avec le contexte des paragraphes concernés. Les annotations dans l’avant sont les commentaires exacts de l’auteur. Un changement sans commentaire ne suffit pas à établir son intention ; un passage antérieur n’est pas automatiquement un contre-exemple. Les coupes sont conservées comme telles. Lire le retour explicite et le chapitre complet ci-dessus pour connaître la portée de l’acceptation.\n\n${pairs.map((pair, index) => `### Reprise ${index + 1}\n\n#### Avant la reprise\n\n${quote(pair.before)}\n\n#### Après — accepté par l’auteur\n\n${quote(pair.after)}`).join("\n\n")}`;
}
