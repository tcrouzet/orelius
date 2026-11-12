import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const source = dirname(fileURLToPath(import.meta.url));

export async function buildWeb(samplesDirectory, outputDirectory) {
  if (!(await lstat(samplesDirectory)).isDirectory()) throw new Error("samples doit être un dossier ordinaire, sans lien symbolique.");
  const files = await readdir(samplesDirectory, { withFileTypes: true, recursive: true });
  if (files.some(file => file.isSymbolicLink())) throw new Error("Les liens symboliques sont refusés dans samples.");
  const stage = await mkdtemp(`${outputDirectory}.`);
  const books = [];
  try {
    for (const name of ["index.html", "reader.js", "reader-config.js", "styles.css", "ia-writer-duo.css"]) await cp(join(source, name), join(stage, name));
    const html = await readFile(join(stage, "index.html"), "utf8");
    const routes = new Set();
    const epubs = files.filter(file => file.isFile() && extname(file.name).toLowerCase() === ".epub");
    const metadata = epubs.length ? JSON.parse(execFileSync("python3", [join(source, "epub-metadata.py")], {
      input: JSON.stringify(epubs.map(file => join(file.parentPath, file.name))), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    })) : [];
    for (const [index, file] of epubs.entries()) {
      const path = relative(samplesDirectory, join(file.parentPath, file.name));
      const destination = join(stage, "samples", path);
      await mkdir(dirname(destination), { recursive: true });
      await cp(join(samplesDirectory, path), destination);
      const route = path.slice(0, -extname(path).length);
      const url = `${route.split(sep).map(encodeURIComponent).join("/")}/`;
      if (routes.has(url)) throw new Error(`Plusieurs EPUB utilisent la même URL : ${url}`);
      routes.add(url);
      const book = { ...metadata[index], path: `samples/${path.split(sep).map(encodeURIComponent).join("/")}`, url };
      const page = join(stage, route, "index.html");
      await mkdir(dirname(page), { recursive: true });
      await writeFile(page, html
        .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <base href="${"../".repeat(route.split(sep).length)}">\n  <meta name="orelius-book" content="${book.path}">`)
        .replace('id="download-epub" download hidden', `id="download-epub" href="${book.path}" download`));
      books.push(book);
    }
    books.sort((a, b) => a.title.localeCompare(b.title, "fr") || a.author.localeCompare(b.author, "fr") || a.path.localeCompare(b.path, "fr"));
    await writeFile(join(stage, "books.json"), `${JSON.stringify(books, null, 2)}\n`);
    await rm(outputDirectory, { recursive: true, force: true });
    await rename(stage, outputDirectory);
    return books;
  } finally { await rm(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(source, "../..");
  const books = await buildWeb(join(root, "samples"), join(root, "_site"));
  console.log(`Site créé dans _site : ${books.length} livre(s).`);
}
