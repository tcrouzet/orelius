import type { NarrativeState } from "./narrative-context.ts";

export function resolveTimeline(states: NarrativeState[]): { id: string; start: number; end: number; anchor: string }[] {
  const moments = new Map<string, NarrativeState["moments"][number] & { chapter: string }>(states.flatMap(state => state.moments.map(moment => [`${state.chapter}#${moment.id}`, { ...moment, chapter: state.chapter }] as const)));
  const resolved = new Map<string, { id: string; start: number; end: number; anchor: string }>();
  const visiting = new Set<string>();
  const units = { seconds: 1, minutes: 60, hours: 3600, days: 86400 };
  const visit = (id: string): { id: string; start: number; end: number; anchor: string } => {
    const cached = resolved.get(id);
    if (cached) return cached;
    if (visiting.has(id)) throw new Error(`Cycle chronologique : ${id}`);
    const moment = moments.get(id);
    if (!moment) throw new Error(`Moment de référence absent : ${id}`);
    visiting.add(id);
    const factor = units[moment.unit ?? "seconds"];
    const parent = moment.after ? visit(moment.after.includes("#") ? moment.after : `${moment.chapter}#${moment.after}`) : undefined;
    const start = parent ? parent.start + (moment.offset ?? 0) * factor : (moment.at ?? 0) * factor;
    if (parent && moment.at !== undefined && moment.at * factor !== start) throw new Error(`Dates contradictoires : ${id}`);
    const end = start + (moment.duration ?? 0) * factor;
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error("Chronologie hors limites numériques.");
    const result = { id, start, end, anchor: parent?.anchor ?? (moment.at === undefined ? id : "origine explicite") };
    visiting.delete(id);
    resolved.set(id, result);
    return result;
  };
  return [...moments.keys()].map(visit);
}
