export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0,10) === value;
}

export function publicationDate(text: string): string | undefined {
  const yaml = text.match(/^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  const explicit = yaml?.match(/^(?:published|published_at|publication|date_publication):\s*["']?(\d{4}-\d{2}-\d{2})(?=[T\s"']|$)/m)?.[1];
  if (explicit && isIsoDate(explicit)) return explicit;
  const tags = text.split(/\r?\n/).filter(line => /^\s*(?:#[^\s]+\s*)+$/.test(line)).join("\n");
  const dates = [...tags.matchAll(/(?:^|\s)#(\d{4})-(\d{1,2})-(\d{1,2})-\d{1,2}h\d{2}(?=\s|$)/g)]
    .map(match => `${match[1]}-${match[2]!.padStart(2,"0")}-${match[3]!.padStart(2,"0")}`).filter(isIsoDate);
  const unique = [...new Set(dates)];
  return unique.length === 1 ? unique[0] : undefined;
}
