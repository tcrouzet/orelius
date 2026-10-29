import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildWeb } from "./build.mjs";

const source = dirname(fileURLToPath(import.meta.url));

export async function checkWeb() {
  const workflow = JSON.parse(execFileSync("ruby", ["-rjson", "-ryaml", "-e", "print JSON.generate(YAML.safe_load(File.read(ARGV.fetch(0))))", join(source, "../../.github/workflows/pages.yml")], { encoding: "utf8" }));
  assert.deepEqual((workflow.on ?? workflow.true).push.branches, ["main"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.jobs.build["runs-on"], "ubuntu-24.04");
  assert.equal(workflow.jobs.deploy["runs-on"], "ubuntu-24.04");
  assert.deepEqual(workflow.jobs.build.permissions, { contents: "read", pages: "read" });
  assert.deepEqual(workflow.jobs.deploy.permissions, { pages: "write", "id-token": "write" });
  assert.equal(workflow.jobs.deploy.needs, "build");
  assert.equal(workflow.jobs.deploy.environment.name, "github-pages");
  const steps = [...workflow.jobs.build.steps, ...workflow.jobs.deploy.steps];
  for (const step of steps.filter(step => step.uses)) assert.match(step.uses, /^[^@]+@[a-f0-9]{40}$/);
  assert.equal(steps.find(step => step.uses?.startsWith("actions/upload-pages-artifact@"))?.with.path, "_site");
  const directory = await mkdtemp(join(tmpdir(), "orelius-web-"));
  const samples = join(directory, "samples"), output = join(directory, "site");
  try {
    await mkdir(samples);
    assert.deepEqual(await buildWeb(samples, output), []);
    await mkdir(join(samples, "Romans"));
    const first = "Lecture #1 — été.epub", second = "Romans/Autre livre.EPUB";
    await writeFile(join(samples, first), "Premier livre : octets à conserver.");
    await writeFile(join(samples, second), "Second livre.");
    await writeFile(join(samples, "notes-privees.md"), "Ne pas publier.");
    await writeFile(join(directory, "data.json"), "Ne pas publier.");
    const books = await buildWeb(samples, output);
    assert.equal(books.length, 2);
    assert.deepEqual(JSON.parse(await readFile(join(output, "books.json"), "utf8")), books);
    assert.equal(books.find(book => book.title === first.slice(0, -5)).path, `samples/${encodeURIComponent(first)}`);
    for (const path of [first, second]) assert.deepEqual(await readFile(join(output, "samples", path)), await readFile(join(samples, path)));
    assert.deepEqual((await readdir(output)).sort(), ["books.json", "index.html", "reader.js", "samples", "styles.css"]);
    assert.deepEqual((await readdir(join(output, "samples"))).sort(), [first, "Romans"].sort());
    const html = await readFile(join(output, "index.html"), "utf8");
    const script = await readFile(join(output, "reader.js"), "utf8");
    for (const match of script.matchAll(/document\.getElementById\("([^"]+)"\)/g)) assert.ok(html.includes(`id="${match[1]}"`), match[1]);
    for (const match of html.matchAll(/<script[^>]+src="https:[^"]+"[^>]*>/g)) {
      assert.match(match[0], /@\d+\.\d+\.\d+\//);
      assert.match(match[0], /integrity="sha384-[^"]+"/);
      assert.match(match[0], /crossorigin="anonymous"/);
    }
    execFileSync(process.execPath, ["--check", join(output, "reader.js")]);
    const base = new URL("https://example.org/orelius/");
    for (const book of books) assert.ok(new URL(book.path, base).href.startsWith(`${base.href}samples/`));
    const before = await readFile(join(output, "books.json"), "utf8");
    await symlink(join(directory, "data.json"), join(samples, "prive.epub"));
    await assert.rejects(buildWeb(samples, output), /symboliques/);
    assert.equal(await readFile(join(output, "books.json"), "utf8"), before);
    await rm(join(samples, "prive.epub"));
    await rm(join(samples, first));
    await buildWeb(samples, output);
    assert.deepEqual(await readdir(join(output, "samples")), ["Romans"]);
    console.log("Web : catalogue, chemins GitHub Pages, copie exacte, retrait des livres et fichiers privés exclus : OK.");
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkWeb();
