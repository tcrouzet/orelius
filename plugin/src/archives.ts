import { t } from "./i18n.ts";
import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rmdir, rm } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { object } from "./codex.ts";
import { DEFAULT_PROJECT_FOLDERS, projectPaths, validateFolderName, type ProjectFolders } from "./settings.ts";

export async function recoverTemporaryLink(target: string, stat: Stats): Promise<void> {
  if (!stat.isFile() || stat.nlink !== 2) return;
  for (const name of await readdir(dirname(target))) {
    if (!/^\.orelius-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/.test(name)) continue;
    const temporary = join(dirname(target), name);
    if (temporary === target) continue;
    let candidate;
    try { candidate = await lstat(temporary); }
    catch (error) { if (object(error).code === "ENOENT") continue; throw error; }
    if (candidate.isFile() && candidate.dev === stat.dev && candidate.ino === stat.ino && candidate.nlink === 2) {
      await rm(temporary, { force: true });
      return;
    }
  }
}

export async function checkPath(root: string, path: string, configDir?: string): Promise<void> {
  const location = relative(root, path);
  if (location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location)) throw new Error(t("theFileMustStayInsideTheProject"));
  if (configDir) {
    const requested = resolve(root, configDir);
    let ancestor = requested;
    let configuration: string;
    while (true) {
      try { configuration = resolve(await realpath(ancestor), relative(ancestor, requested)); break; }
      catch (error) {
        if (object(error).code !== "ENOENT" || dirname(ancestor) === ancestor) throw error;
        ancestor = dirname(ancestor);
      }
    }
    const configured = relative(configuration.normalize("NFC").toLowerCase(), path.normalize("NFC").toLowerCase());
    if (!configured || configured !== ".." && !configured.startsWith(`..${sep}`) && !isAbsolute(configured)) {
      throw new Error(t("writingToTheObsidianConfigurationFolderIsNotAllowed"));
    }
  }
  let current = root;
  for (const part of relative(root, path).split(sep)) {
    current = join(current, part);
    let info;
    try { info = await lstat(current); }
    catch (error) {
      if (object(error).code === "ENOENT") return;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error(t("symbolicLinksCannotBeModifiedOrUsedAsArchives"));
  }
}

export async function prepareProject(cwd: string, folders: ProjectFolders, configDir?: string): Promise<void> {
  const paths = projectPaths(folders);
  const root = await realpath(cwd);
  const legacy = join(root, "context", folders.manuscriptFolder, "Chapters");
  const destination = join(root, "Tracking");
  await checkPath(root, legacy, configDir);
  let legacyExists = false;
  try { legacyExists = (await lstat(legacy)).isDirectory(); }
  catch (error) { if (object(error).code !== "ENOENT") throw error; }
  if (legacyExists) {
    await checkPath(root, destination, configDir);
    let destinationExists = false;
    try { await lstat(destination); destinationExists = true; }
    catch (error) { if (object(error).code !== "ENOENT") throw error; }
    const legacyRoot = join(root, "context");
    const sameRoot = destinationExists && await realpath(destination) === await realpath(legacyRoot);
    if (destinationExists && (!sameRoot || (await readdir(legacyRoot)).some(name => name !== folders.manuscriptFolder)
      || (await readdir(dirname(legacy))).some(name => name !== "Chapters"))) {
      throw new Error(t("bothContextChaptersAndContextExistNoContextWas", { value1: folders.manuscriptFolder, value2: folders.manuscriptFolder }));
    }
    const inspect = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error(t("theContextToMoveContainsASymbolicLinkNo"));
        if (entry.isDirectory()) await inspect(join(directory, entry.name));
      }
    };
    await inspect(legacy);
    await mkdir(dirname(destination), { recursive: true });
    await checkPath(root, destination, configDir);
    const temporary = sameRoot ? join(root, `.orelius-context-${randomUUID()}`) : destination;
    await rename(legacy, temporary);
    for (const empty of [dirname(legacy), join(root, "context")]) {
      try { await rmdir(empty); }
      catch (error) { if (!["ENOTEMPTY", "EEXIST", "ENOENT"].includes(String(object(error).code))) throw error; }
    }
    if (sameRoot) await rename(temporary, destination);
  }
  for (const path of paths) {
    const target = join(root, path);
    await checkPath(root, target, configDir);
    try { await mkdir(target); }
    catch (error) { if (object(error).code !== "EEXIST") throw error; }
    if (!(await lstat(target)).isDirectory()) throw new Error(t("aFileOccupiesTheFolderPath", { value1: path }));
    await checkPath(root, target);
  }
}

function archiveTarget(root: string, suppliedRoot: string, requestedPath: string, archiveFolder: string): { target: string; path: string } {
  if (typeof requestedPath !== "string" || !requestedPath || requestedPath.includes("\0")) throw new Error(t("invalidFilePath"));
  const requested = resolve(suppliedRoot, requestedPath);
  // macOS can expose the same project through /var and /private/var.
  const target = requested.startsWith(`${suppliedRoot}${sep}`) ? resolve(root, relative(suppliedRoot, requested)) : requested;
  const path = relative(root, target);
  if (!path || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)
    || [archiveFolder.normalize("NFC").toLowerCase(), "_archives", ".git"]
      .includes(path.split(sep)[0].normalize("NFC").toLowerCase())) {
    throw new Error(t("writingRefusedTheFileMustBeInsideTheProject", { value1: archiveFolder }));
  }
  return { target, path };
}

async function writeArchive(root: string, path: string, content: Uint8Array, mode: number,
  archiveFolder: string, suffix: "" | "-h", configDir?: string): Promise<string> {
  const directory = join(root, archiveFolder, path.toLowerCase() === "agents.md" ? "Agents" : dirname(path));
  await checkPath(root, directory, configDir);
  await mkdir(directory, { recursive: true });
  await checkPath(root, directory);
  const extension = extname(path);
  const version = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const archive = join(directory, `${basename(path, extension)}.${version}${suffix}${extension}`);
  const copy = await open(archive, "wx", mode & 0o777);
  try { await copy.writeFile(content); await copy.sync(); }
  finally { await copy.close(); }
  return relative(root, archive).split(sep).join("/");
}

export async function archiveGenerated(cwd: string, path: string, content: string, archiveFolder: string, mode = 0o600, configDir?: string): Promise<string> {
  validateFolderName(archiveFolder);
  const root = await realpath(cwd);
  const location = archiveTarget(root, resolve(cwd), path, archiveFolder);
  await checkPath(root, location.target, configDir);
  return writeArchive(root, location.path, Buffer.from(content, "utf8"), mode, archiveFolder, "", configDir);
}

export async function archiveChanges(cwd: string, changes: unknown,
  checkEditor: (path: string, content: string) => void = () => {},
  archiveFolder: string = DEFAULT_PROJECT_FOLDERS.archiveFolder, suffix: "" | "-h" = "", configDir?: string): Promise<string[]> {
  validateFolderName(archiveFolder);
  if (!Array.isArray(changes) || !changes.length) throw new Error(t("missingListOfChangesWritingRefused"));
  const root = await realpath(cwd);
  const suppliedRoot = resolve(cwd);
  const targets = changes.map(value => {
    const change = object(value);
    const kind = object(change.kind);
    if (typeof change.path !== "string" || !change.path || change.path.includes("\0")
      || !["add", "update"].includes(String(kind.type)) || kind.move_path != null) {
      throw new Error(t("onlyFileCreationAndModificationAreSupported"));
    }
    return { ...archiveTarget(root, suppliedRoot, change.path, archiveFolder), creating: kind.type === "add" };
  });
  for (const { target } of targets) await checkPath(root, target, configDir);
  const archives: string[] = [];
  for (const { target, path, creating } of targets) {
    let source;
    try { source = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) {
      if (creating && object(error).code === "ENOENT") continue;
      throw error;
    }
    try {
      await recoverTemporaryLink(target, await source.stat());
      const before = await source.stat();
      if (!before.isFile() || before.nlink !== 1) throw new Error(t("aRegularFileWithoutLinksIsRequired", { value1: path }));
      const original = await source.readFile();
      checkEditor(path.split(sep).join("/"), original.toString("utf8"));
      const archive = await writeArchive(root, path, original, before.mode, archiveFolder, suffix, configDir);
      const after = await lstat(target);
      if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
        || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
        throw new Error(t("theFileChangedDuringArchivingRetryTheRequest", { value1: path }));
      }
      checkEditor(path.split(sep).join("/"), original.toString("utf8"));
      archives.push(archive);
    } finally { await source.close(); }
  }
  return archives;
}
