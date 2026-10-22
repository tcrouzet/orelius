import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, writeFile, copyFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";

const root = await mkdtemp("/private/tmp/orelius-ui-");
const vault = `${root}/vault`;
const profile = `${root}/profile`;
const plugin = `${vault}/.obsidian/plugins/orelius`;
await mkdir(plugin, { recursive: true });
await mkdir(profile);
for (const file of ["main.js", "manifest.json", "styles.css"]) {
  await copyFile(`${process.cwd()}/plugin/${file}`, `${plugin}/${file}`);
}
await writeFile(`${profile}/obsidian.json`, JSON.stringify({ vaults: { orelius: { path: vault, ts: Date.now(), open: true } } }));
await writeFile(`${vault}/.obsidian/community-plugins.json`, JSON.stringify(["orelius"]));
await writeFile(`${vault}/.obsidian/app.json`, JSON.stringify({ safeMode: false }));
console.log("TEST_ROOT", root);

const portProbe = createServer();
await new Promise(resolve => portProbe.listen(0, "127.0.0.1", resolve));
const debugPort = portProbe.address().port;
await new Promise(resolve => portProbe.close(resolve));
const child = spawn("/Applications/Obsidian.app/Contents/MacOS/Obsidian", [
  `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, "--no-first-run",
], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
child.stdout.on("data", chunk => { logs = (logs + chunk).slice(-10000); });
child.stderr.on("data", chunk => { logs = (logs + chunk).slice(-10000); });
let socket;
let nextId = 0;
const pending = new Map();

async function until(condition, milliseconds = 20000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const value = await condition();
    if (value) return value;
    await wait(100);
  }
  throw new Error("La condition attendue n’a pas été satisfaite.");
}

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP ne répond pas à ${method}`));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result?.value;
}

async function click(selector) {
  assert.equal(await evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button || button.disabled) return false;
    button.focus();
    return document.activeElement === button;
  })()`), true);
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
}

try {
  const target = await until(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
      return (await response.json()).find(target => target.type === "page");
    } catch { return false; }
  });
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const response = JSON.parse(event.data);
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    clearTimeout(request.timer);
    if (response.error) request.reject(new Error(JSON.stringify(response.error)));
    else request.resolve(response.result);
  };
  await until(() => evaluate('typeof app !== "undefined" && !!app.vault && !!app.workspace'));
  assert.equal(await evaluate("app.vault.adapter.getBasePath()"), vault);
  const trust = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(button =>
      button.textContent === "Faites confiance à l'auteur et activez les modules" ||
      button.textContent === "Faites confiance à l’auteur et activez les modules");
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  if (trust) {
    await call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...trust });
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...trust });
  }
  await until(() => evaluate('!document.body.innerText.includes("Faites-vous confiance à l")'));
  await evaluate('(async () => { if (!app.plugins.plugins.orelius) await app.plugins.enablePlugin("orelius"); })()');
  await until(() => evaluate('!!app.commands.commands["orelius:open-chat"]'), 30000);
  assert.equal(await evaluate('app.commands.executeCommandById("orelius:open-chat")'), true);
  await until(() => evaluate('!!document.querySelector(".orelius-chat textarea")'));
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".orelius-chat button")].map(button => button.textContent)'),
    ["Connecter", "Nouvelle conversation", "Envoyer", "Arrêter"]);
  console.log("OK panneau latéral et commande");

  await evaluate('app.setting.open(); app.setting.openTabById("orelius"); true');
  assert.equal(await evaluate('document.querySelector(".vertical-tab-content").textContent.includes("Tester Codex")'), true);
  assert.equal(await evaluate('document.querySelector(".vertical-tab-content").textContent.includes("Dossier de travail")'), true);
  await evaluate("app.setting.close()");
  await until(() => evaluate('!document.querySelector(".modal-container")'));
  console.log("OK réglages élémentaires");

  await click(".orelius-header button");
  await until(() => evaluate('app.plugins.plugins.orelius.session.connected && !document.querySelector(".orelius-chat textarea").disabled'), 40000);
  assert.equal(await evaluate("app.plugins.plugins.orelius.session.disconnect(); !app.plugins.plugins.orelius.session.connected"), true);
  await until(() => evaluate('!document.querySelector(".orelius-header button").disabled'));
  await click(".orelius-header button");
  await until(() => evaluate('app.plugins.plugins.orelius.session.connected && !document.querySelector(".orelius-chat textarea").disabled'), 40000);
  console.log("OK connexion, arrêt des minuteurs et reconnexion dans Obsidian");

  assert.equal(await evaluate('document.querySelector(".orelius-chat textarea").focus(); document.activeElement.matches(".orelius-chat textarea")'), true);
  await call("Input.insertText", { text: "Réponds uniquement ORELIUS_UI_OK, sans utiliser aucun outil." });
  await until(() => evaluate('!document.querySelector(".orelius-composer .mod-cta").disabled'));
  await click(".orelius-composer .mod-cta");
  await until(() => evaluate('app.plugins.plugins.orelius.session.items.some(item => item.role === "assistant" && item.text.includes("ORELIUS_UI_OK")) && !app.plugins.plugins.orelius.session.busy'), 120000);
  await until(() => evaluate('document.querySelector(".orelius-assistant")?.textContent.includes("ORELIUS_UI_OK")'));
  const threadId = await evaluate("app.plugins.plugins.orelius.settings.threadId");
  assert.ok(threadId);
  console.log("OK envoi et réponse rendue dans le chat");

  await evaluate('(async () => { await app.plugins.disablePlugin("orelius"); await app.plugins.enablePlugin("orelius"); await app.plugins.plugins.orelius.openChat(); })()');
  await until(() => evaluate('app.plugins.plugins.orelius.session.connected && !app.plugins.plugins.orelius.session.busy'), 40000);
  assert.equal(await evaluate("app.plugins.plugins.orelius.settings.threadId"), threadId);
  await until(() => evaluate('document.querySelector(".orelius-assistant")?.textContent.includes("ORELIUS_UI_OK") && document.querySelector(".orelius-status")?.textContent.includes("Prêt")'));
  console.log("OK reprise de la conversation après rechargement du plugin");
  const screenshot = await call("Page.captureScreenshot", { format: "png" });
  await writeFile(`${root}/chat.png`, Buffer.from(screenshot.data, "base64"));
  await evaluate('app.plugins.disablePlugin("orelius")');
  console.log("SCREENSHOT", `${root}/chat.png`);
  console.log("UI_CHECK_PASS");
} catch (error) {
  console.error(error.stack);
  if (socket?.readyState === 1) {
    try {
      console.error("PAGE", await evaluate("document.body.innerText.slice(0,5000)"));
      const shot = await call("Page.captureScreenshot", { format: "png" });
      await writeFile(`${root}/failure.png`, Buffer.from(shot.data, "base64"));
      console.error("SCREENSHOT", `${root}/failure.png`);
      await evaluate('app.plugins.disablePlugin("orelius")');
    } catch {}
  }
  console.error("APP_LOG", logs);
  process.exitCode = 1;
} finally {
  socket?.close();
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error("Test fermé"));
  }
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
  setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 1500);
}
