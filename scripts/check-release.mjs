import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export function checkRelease() {
  const parsed = spawnSync("ruby", ["-rjson", "-ryaml", "-e", "print JSON.generate(YAML.safe_load(File.read(ARGV.fetch(0))))", join(root, ".github/workflows/release.yml")], { encoding: "utf8" });
  assert.ifError(parsed.error);
  assert.equal(parsed.status, 0, parsed.stderr);
  const workflow = JSON.parse(parsed.stdout);
  assert.equal(workflow.jobs.release["runs-on"], "ubuntu-24.04");
  assert.deepEqual((workflow.on ?? workflow.true).push.tags, ["[0-9]*"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(workflow.jobs.release.permissions, { contents: "write", "id-token": "write", attestations: "write" });
  const steps = workflow.jobs.release.steps;
  for (const step of steps.filter(step => step.uses)) assert.match(step.uses, /^[^@]+@[a-f0-9]{40}$/);
  assert.equal(steps.find(step => step.uses?.startsWith("actions/checkout@"))?.with["persist-credentials"], false);
  assert.equal(steps.find(step => step.uses?.startsWith("actions/setup-node@"))?.with["node-version"], "24");
  const attestation = steps.find(step => step.uses?.startsWith("actions/attest@"));
  assert.ok(attestation);
  assert.deepEqual(attestation.with["subject-path"].trim().split("\n"), ["main.js", "manifest.json", "styles.css"]);
  const publication = steps.find(step => step.name === "Publish plugin");
  assert.ok(steps.indexOf(attestation) > steps.findIndex(step => step.name === "Validate and build"));
  assert.ok(steps.indexOf(attestation) < steps.indexOf(publication));
  assert.equal(publication.env.GH_TOKEN, "${{ secrets.GITHUB_TOKEN }}");
  assert.equal(publication.env.RELEASE_TAG, "${{ github.ref_name }}");
  for (const step of steps.filter(step => step.run)) assert.equal(spawnSync("bash", ["-n", "-c", step.run]).status, 0);

  const directory = mkdtempSync(join(tmpdir(), "orelius-release-test-"));
  const scenarios = ["ok", "dirty", "arguments", "wrong-branch", "invalid-version", "check-failure", "build-failure", "push-failure", "release-push-failure", "mismatch", "collision", "tag-push-failure"];
  try {
    for (const scenario of scenarios) {
      const base = join(directory, scenario), repository = join(base, "plugin avec espaces"), remote = join(base, "remote.git"), bin = join(base, "bin");
      mkdirSync(join(repository, "plugin"), { recursive: true });
      mkdirSync(bin);
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, GIT_TERMINAL_PROMPT: "0",
        TMPDIR: base, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", RELEASE_SCENARIO: scenario,
        RELEASE_TEST_REMOTE: remote, RELEASE_TEST_CALLS: join(base, "calls"), RELEASE_TEST_ASSETS: join(base, "assets.json") };
      delete env.RELEASE_TAG;
      const run = (command, args, expected = 0, options = {}) => {
        const result = spawnSync(command, args, { cwd: repository, env, encoding: "utf8", timeout: 30000, ...options });
        assert.ifError(result.error);
        assert.equal(result.status, expected, `${scenario}: ${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
        return result.stdout.trim();
      };
      copyFileSync(join(root, "release.sh"), join(repository, "release.sh"));
      const manifest = { id: "fixture", version: scenario === "invalid-version" ? "1.2.3-rc.1" : "1.2.3", minAppVersion: "1.6.0", description: "Fixture." };
      for (const path of ["manifest.json", "plugin/manifest.json"]) writeFileSync(join(repository, path), `${JSON.stringify(manifest, null, 2)}\n`);
      writeFileSync(join(repository, "package.json"), JSON.stringify({ name: "release-fixture", version: "1.2.3", type: "module", private: true,
        scripts: { check: "node -e \"if (process.env.RELEASE_SCENARIO === 'check-failure') process.exit(1)\"", build: "node build.mjs" } }));
      writeFileSync(join(repository, "package-lock.json"), JSON.stringify({ name: "release-fixture", version: "1.2.3", lockfileVersion: 3,
        packages: { "": { name: "release-fixture", version: "1.2.3" } } }));
      writeFileSync(join(repository, "versions.json"), '{"1.2.3":"1.6.0"}\n');
      writeFileSync(join(repository, "styles.css"), "body {}\n");
      writeFileSync(join(repository, "main.js"), "module.exports = {};\n");
      copyFileSync(join(repository, "main.js"), join(repository, "plugin/main.js"));
      writeFileSync(join(repository, "build.mjs"), 'import { writeFileSync, copyFileSync } from "node:fs"; if (process.env.RELEASE_SCENARIO === "build-failure") process.exit(1); writeFileSync("main.js", "module.exports = {};\\n"); copyFileSync("main.js", "plugin/main.js"); copyFileSync("plugin/manifest.json", "manifest.json");\n');
      writeFileSync(join(bin, "gh"), `#!${process.execPath}
const fs = require("node:fs"), cp = require("node:child_process");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.RELEASE_TEST_CALLS, args.join(" ")+"\\n");
if (args[0] === "repo" && args[1] === "view") console.log(JSON.stringify({ nameWithOwner: "fixture/plugin", defaultBranchRef: { name: "main" } }));
else if (args[0] === "api") {
  const text = cp.execFileSync("git", ["--git-dir", process.env.RELEASE_TEST_REMOTE, "show", "main:manifest.json"], {encoding:"utf8"});
  const manifest = JSON.parse(text);
  if (process.env.RELEASE_SCENARIO === "mismatch") manifest.description = "Different.";
  console.log(JSON.stringify(manifest));
} else if (args[0] === "release" && args[1] === "create") {
  fs.writeFileSync(process.env.RELEASE_TEST_ASSETS, JSON.stringify({args, manifest: JSON.parse(fs.readFileSync("manifest.json", "utf8"))}));
} else process.exit(99);
`, { mode: 0o755 });
      run("git", ["init", "--bare", remote]);
      run("git", ["init", "-b", "main"]);
      run("git", ["config", "user.name", "Release fixture"]);
      run("git", ["config", "user.email", "release@example.invalid"]);
      run("git", ["add", "."]);
      run("git", ["commit", "-m", "Initial fixture"]);
      run("git", ["remote", "add", "origin", remote]);
      run("git", ["push", "origin", "main"]);
      if (["dirty", "push-failure"].includes(scenario)) writeFileSync(join(repository, "new.md"), "À conserver.\n");
      if (scenario === "wrong-branch") run("git", ["checkout", "-b", "feature"]);
      if (scenario === "collision") { run("git", ["tag", "1.2.4"]); run("git", ["push", "origin", "1.2.4"]); }
      const initial = run("git", ["rev-parse", "HEAD"]);
      const hook = join(remote, "hooks/pre-receive");
      if (scenario === "push-failure") writeFileSync(hook, "#!/bin/bash\nexit 1\n", { mode: 0o755 });
      if (scenario === "tag-push-failure") writeFileSync(hook, '#!/bin/bash\nwhile read -r old new ref; do if [[ "$ref" == refs/tags/* ]]; then exit 1; fi; done\n', { mode: 0o755 });
      if (scenario === "release-push-failure") writeFileSync(hook, '#!/bin/bash\nwhile read -r old new ref; do if [[ "$ref" == refs/heads/main ]] && git show "$new:manifest.json" | jq -e \'.version == "1.2.4"\' >/dev/null; then exit 1; fi; done\n', { mode: 0o755 });
      const succeeds = ["ok", "dirty"].includes(scenario);
      run("bash", [join(repository, "release.sh"), ...(scenario === "arguments" ? ["--dry-run"] : [])], succeeds ? 0 : scenario === "collision" ? 128 : 1, { cwd: base });
      const bumped = ["ok", "dirty", "release-push-failure", "mismatch", "collision", "tag-push-failure"].includes(scenario);
      const read = path => JSON.parse(readFileSync(join(repository, path), "utf8"));
      assert.equal(read("manifest.json").version, bumped ? "1.2.4" : manifest.version);
      assert.deepEqual(read("manifest.json"), read("plugin/manifest.json"));
      for (const path of ["package.json", "package-lock.json"]) assert.equal(read(path).version, bumped ? "1.2.4" : "1.2.3");
      assert.equal(read("package-lock.json").packages[""].version, bumped ? "1.2.4" : "1.2.3");
      assert.equal(read("versions.json")["1.2.3"], "1.6.0");
      assert.equal(read("versions.json")["1.2.4"], bumped ? "1.6.0" : undefined);
      assert.equal(run("git", ["rev-list", "--count", "HEAD"]), scenario === "dirty" ? "3" : bumped || scenario === "push-failure" ? "2" : "1");
      if (bumped) assert.equal(run("git", ["log", "-1", "--pretty=%s"]), "Release 1.2.4");
      if (["dirty", "push-failure"].includes(scenario)) {
        assert.match(run("git", ["log", "--format=%s"]), /^Sync before release /m);
        assert.equal(run("git", ["show", "HEAD:new.md"]), "À conserver.");
      }
      const remoteVersion = JSON.parse(run("git", ["--git-dir", remote, "show", "main:manifest.json"])).version;
      assert.equal(remoteVersion, bumped && scenario !== "release-push-failure" ? "1.2.4" : manifest.version);
      const remoteTag = spawnSync("git", ["--git-dir", remote, "rev-parse", "--verify", "refs/tags/1.2.4"], { env, encoding: "utf8" });
      assert.equal(remoteTag.status === 0, succeeds || scenario === "collision");
      if (scenario === "collision") assert.equal(remoteTag.stdout.trim(), initial);
      if (scenario === "arguments") assert.equal(readdirSync(base).includes("calls"), false);
      assert.equal(readdirSync(base).some(path => path.startsWith("orelius-release.")), false);
      if (succeeds) {
        assert.equal(remoteTag.stdout.trim(), run("git", ["rev-parse", "HEAD"]));
        assert.equal(run("git", ["status", "--porcelain"]), "");
        if (scenario === "dirty") assert.equal(run("git", ["--git-dir", remote, "show", "main:new.md"]), "À conserver.");
        const validation = steps.find(step => step.name === "Validate and build").run.split("\n").find(line => line.startsWith("node -e "));
        assert.ok(validation);
        run("bash", ["-euo", "pipefail", "-c", validation], 0, { env: { ...env, RELEASE_TAG: "1.2.4" } });
        run("bash", ["-euo", "pipefail", "-c", validation], 1, { env: { ...env, RELEASE_TAG: "9.0.0" } });
        assert.equal(readFileSync(env.RELEASE_TEST_CALLS, "utf8").includes("release create"), false);
        run("bash", ["-euo", "pipefail", "-c", publication.run], 0, { env: { ...env, RELEASE_TAG: "1.2.4" } });
        const published = JSON.parse(readFileSync(env.RELEASE_TEST_ASSETS, "utf8"));
        assert.deepEqual(published.args.slice(0, 6), ["release", "create", "1.2.4", "main.js", "manifest.json", "styles.css"]);
        assert.ok(published.args.includes("--verify-tag"));
        assert.deepEqual(published.manifest, JSON.parse(run("git", ["--git-dir", remote, "show", "main:manifest.json"])));
      }

    }
    console.log(`Release : ${scenarios.length} scénarios avec dépôts Git locaux, commits automatiques, échecs et publication simulée : OK.`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkRelease();
