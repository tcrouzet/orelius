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
    const configModule = new URL("./reader-config.js", import.meta.url).href;
    const storageArguments = ["--experimental-webstorage", `--localstorage-file=${join(directory, "reader-storage")}`, "--input-type=module", "--eval"];
    const setup = `import assert from "node:assert/strict";
      const { DEFAULT_FONT, readingState } = await import(${JSON.stringify(configModule)});
      assert.equal(DEFAULT_FONT, "'iA Writer Duo V', monospace");
      const fonts = [DEFAULT_FONT, "Georgia, serif", ""];
      const state = readingState(localStorage, "/orelius/");`;
    execFileSync(process.execPath, [...storageArguments, `${setup}
      assert.deepEqual(state.loadPreferences(fonts), { fontFamily: DEFAULT_FONT, fontSize: 100, format: "paginated" });
      state.savePreferences({ fontFamily: "Georgia, serif", fontSize: 130, format: "scrolled" });
      state.savePosition("livre-1", "epubcfi(/6/2!/4/2/1:42)");
      state.savePosition("livre-2", "epubcfi(/6/4!/4/2/1:15)");
    `], { stdio: ["ignore", "pipe", "pipe"] });
    execFileSync(process.execPath, [...storageArguments, `${setup}
      assert.deepEqual(state.loadPreferences(fonts), { fontFamily: "Georgia, serif", fontSize: 130, format: "scrolled" });
      assert.equal(state.position("livre-1"), "epubcfi(/6/2!/4/2/1:42)");
      assert.equal(state.position("livre-2"), "epubcfi(/6/4!/4/2/1:15)");
      assert.equal(state.position("autre-livre"), undefined);
      assert.equal(readingState(localStorage, "/autre-site/").position("livre-1"), undefined);
      state.savePosition("livre-1", "https://example.org/");
      state.savePosition("livre-1", "epubcfi(" + "x".repeat(4096) + ")");
      assert.equal(state.position("livre-1"), "epubcfi(/6/2!/4/2/1:42)");
      state.savePreferences({ fontFamily: "police inconnue", fontSize: 900, format: "inconnu" });
      assert.deepEqual(state.loadPreferences(fonts), { fontFamily: DEFAULT_FONT, fontSize: 100, format: "paginated" });
      localStorage.setItem("orelius:reader:/orelius/:config", "JSON cassé");
      assert.deepEqual(state.loadPreferences(fonts), { fontFamily: DEFAULT_FONT, fontSize: 100, format: "paginated" });
      const unavailable = readingState(undefined, "/orelius/");
      unavailable.savePreferences({ fontSize: 150 });
      unavailable.savePosition("livre-1", "epubcfi(/6/2!/4/2/1:0)");
      assert.equal(unavailable.position("livre-1"), undefined);
      assert.equal(unavailable.loadPreferences(fonts).fontFamily, DEFAULT_FONT);
    `], { stdio: ["ignore", "pipe", "pipe"] });
    await mkdir(samples);
    assert.deepEqual(await buildWeb(samples, output), []);
    await mkdir(join(samples, "Romans"));
    const first = "Lecture #1 — été.epub", second = "Romans/Autre livre.EPUB";
    execFileSync("python3", ["-c", `
import json, sys, zipfile
for path, metadata in json.load(sys.stdin):
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("mimetype", "application/epub+zip")
        archive.writestr("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="Contenu/livre.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        archive.writestr("Contenu/livre.opf", '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:d="http://purl.org/dc/elements/1.1/"><d:identifier id="id">urn:uuid:example</d:identifier><d:language>fr</d:language>' + metadata + '</metadata><manifest><item id="texte" href="texte.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="texte"/></spine></package>')
        archive.writestr("Contenu/texte.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Exemple</title></head><body><p>Texte.</p></body></html>')
`], { input: JSON.stringify([
      [join(samples, first), '<d:title>  Un autre\n titre &amp; récit </d:title><d:title>Sous-titre</d:title><d:creator>Alice &#201;tienne</d:creator><d:creator><![CDATA[Bob & Cie]]></d:creator>'],
      [join(samples, second), '<d:title> </d:title>'],
    ]) });
    await writeFile(join(samples, "notes-privees.md"), "Ne pas publier.");
    await writeFile(join(directory, "data.json"), "Ne pas publier.");
    const books = await buildWeb(samples, output);
    assert.equal(books.length, 2);
    assert.deepEqual(JSON.parse(await readFile(join(output, "books.json"), "utf8")), books);
    const firstBook = books.find(book => book.path === `samples/${encodeURIComponent(first)}`);
    assert.equal(firstBook.title, "Un autre titre & récit");
    assert.equal(firstBook.author, "Alice Étienne, Bob & Cie");
    const secondBook = books.find(book => book.path !== firstBook.path);
    assert.equal(secondBook.title, "Sans titre");
    assert.equal(secondBook.author, "Auteur non renseigné");
    const base = new URL("https://example.org/orelius/");
    for (const book of books) {
      assert.equal(book.url, `${book.path.slice("samples/".length).replace(/\.epub$/i, "")}/`);
      const page = await readFile(join(output, decodeURIComponent(book.url), "index.html"), "utf8");
      const pageUrl = new URL(book.url, base);
      const pageBase = new URL(page.match(/<base href="([^"]+)">/)?.[1] ?? "", pageUrl);
      assert.equal(pageBase.href, base.href, "Les ressources doivent rester à la racine du site, même dans un sous-dossier.");
      assert.equal(page.match(/<meta name="orelius-book" content="([^"]+)">/)?.[1], book.path);
      for (const asset of ["reader.js", "reader-config.js", "styles.css", "ia-writer-duo.css", "books.json", book.path]) {
        const url = new URL(asset, pageBase);
        assert.ok(url.href.startsWith(base.href));
        await readFile(join(output, decodeURIComponent(url.pathname.slice(base.pathname.length))));
      }
    }
    for (const path of [first, second]) assert.deepEqual(await readFile(join(output, "samples", path)), await readFile(join(samples, path)));
    assert.deepEqual((await readdir(output)).sort(), ["Lecture #1 — été", "Romans", "books.json", "index.html", "reader.js", "reader-config.js", "samples", "styles.css", "ia-writer-duo.css"].sort());
    assert.deepEqual((await readdir(join(output, "samples"))).sort(), [first, "Romans"].sort());
    const html = await readFile(join(output, "index.html"), "utf8");
    const script = await readFile(join(output, "reader.js"), "utf8");
    const fontCss = await readFile(join(output, "ia-writer-duo.css"), "utf8");
    assert.equal(fontCss, await readFile(join(source, "ia-writer-duo.css"), "utf8"));
    assert.ok(fontCss.includes("SIL OPEN FONT LICENSE Version 1.1"));
    assert.ok(fontCss.includes('font-family: "iA Writer Duo V"'));
    const embeddedFonts = [...fontCss.matchAll(/data:font\/ttf;base64,([A-Za-z0-9+/=]+)/g)];
    assert.equal(embeddedFonts.length, 2);
    for (const match of embeddedFonts) assert.equal(Buffer.from(match[1], "base64").readUInt32BE(0), 0x00010000);
    for (const match of script.matchAll(/document\.getElementById\("([^"]+)"\)/g)) assert.ok(html.includes(`id="${match[1]}"`), match[1]);
    for (const match of html.matchAll(/<script[^>]+src="https:[^"]+"[^>]*>/g)) {
      assert.match(match[0], /@\d+\.\d+\.\d+\//);
      assert.match(match[0], /integrity="sha384-[^"]+"/);
      assert.match(match[0], /crossorigin="anonymous"/);
    }
    execFileSync(process.execPath, ["--check", join(output, "reader.js")]);
    for (const book of books) assert.ok(new URL(book.path, base).href.startsWith(`${base.href}samples/`));
    const before = await readFile(join(output, "books.json"), "utf8");
    await writeFile(join(samples, "invalide.epub"), "Ceci n’est pas un EPUB.");
    await assert.rejects(buildWeb(samples, output), /invalide\.epub/);
    assert.equal(await readFile(join(output, "books.json"), "utf8"), before);
    await rm(join(samples, "invalide.epub"));
    await symlink(join(directory, "data.json"), join(samples, "prive.epub"));
    await assert.rejects(buildWeb(samples, output), /symboliques/);
    assert.equal(await readFile(join(output, "books.json"), "utf8"), before);
    await rm(join(samples, "prive.epub"));
    await rm(join(samples, first));
    await buildWeb(samples, output);
    assert.deepEqual(await readdir(join(output, "samples")), ["Romans"]);
    await assert.rejects(readFile(join(output, first.slice(0, -5), "index.html")), { code: "ENOENT" });
    console.log("Web : catalogue, URLs directes, réglages et positions persistés entre processus, police intégrée, ressources GitHub Pages et fichiers privés exclus : OK.");
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkWeb();
