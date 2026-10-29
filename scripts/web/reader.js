"use strict";

const library = document.getElementById("books");
const title = document.getElementById("book-title");
const author = document.getElementById("book-author");
const status = document.getElementById("status");
const viewer = document.getElementById("viewer");
const previous = document.getElementById("previous");
const next = document.getElementById("next");
const chapters = document.getElementById("chapters");
let book = null;
let rendition = null;
let generation = 0;

function report(message, error = false) {
  status.textContent = message;
  status.classList.toggle("is-error", error);
}

function addChapters(items, depth = 0) {
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.href;
    option.textContent = `${"— ".repeat(depth)}${item.label.trim()}`;
    chapters.append(option);
    if (item.subitems?.length) addChapters(item.subitems, depth + 1);
  }
}

async function openBook(entry, button) {
  const current = ++generation;
  try {
    book?.destroy();
    book = null;
    rendition = null;
    viewer.replaceChildren();
    chapters.replaceChildren();
    chapters.disabled = previous.disabled = next.disabled = true;
    title.textContent = entry.title;
    author.textContent = "";
    viewer.setAttribute("aria-busy", "true");
    for (const item of library.querySelectorAll("button")) item.setAttribute("aria-pressed", String(item === button));
    report("Ouverture du livre…");
    if (typeof window.ePub !== "function") throw new Error("Le lecteur n’a pas pu se charger. Recharge la page.");
    const url = new URL(entry.path, document.baseURI);
    const samples = new URL("samples/", document.baseURI);
    if (!url.href.startsWith(samples.href)) throw new Error("Ce livre ne fait pas partie de la bibliothèque.");
    const opening = window.ePub();
    book = opening;
    await opening.open(url.href, "epub");
    if (current !== generation) return;
    const metadata = await opening.loaded.metadata;
    if (current !== generation) return;
    title.textContent = metadata.title || entry.title;
    author.textContent = metadata.creator || "";
    document.title = `${title.textContent} — Orelius`;
    const display = opening.renderTo(viewer, { width: "100%", height: "100%", spread: "auto", allowScriptedContent: false });
    rendition = display;
    display.on("relocated", location => {
      if (current !== generation) return;
      previous.disabled = location.atStart;
      next.disabled = location.atEnd;
      const href = location.start.href.split("#")[0];
      const option = [...chapters.options].find(option => option.value.split("#")[0] === href);
      if (option) chapters.value = option.value;
    });
    display.on("keyup", navigateWithKeyboard);
    await display.display();
    if (current !== generation) return;
    report("");
    const navigation = await opening.loaded.navigation;
    if (current !== generation) return;
    addChapters(navigation.toc);
    chapters.disabled = !chapters.options.length;
  } catch (error) {
    if (current === generation) report(`Impossible d’ouvrir ce livre. ${error instanceof Error ? error.message : "Réessaie dans un instant."}`, true);
  } finally {
    if (current === generation) viewer.setAttribute("aria-busy", "false");
  }
}

async function move(direction) {
  const current = generation;
  try { await rendition?.[direction](); }
  catch { if (current === generation) report("Cette page n’a pas pu être affichée. Réessaie.", true); }
}

function navigateWithKeyboard(event) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    || event.target?.closest?.("input, textarea, select, button, a, [contenteditable]")) return;
  const rtl = book?.package?.metadata?.direction === "rtl";
  const direction = event.key === "ArrowLeft" ? (rtl ? "next" : "prev")
    : event.key === "ArrowRight" ? (rtl ? "prev" : "next") : null;
  if (direction) { event.preventDefault(); void move(direction); }
}

previous.addEventListener("click", () => { void move("prev"); });
next.addEventListener("click", () => { void move("next"); });
document.addEventListener("keyup", navigateWithKeyboard);
chapters.addEventListener("change", () => {
  const current = generation;
  void rendition?.display(chapters.value).catch(() => {
    if (current === generation) report("Ce chapitre n’a pas pu être affiché. Réessaie.", true);
  });
});

async function loadLibrary() {
  try {
    const response = await fetch("books.json");
    if (!response.ok) throw new Error("Catalogue indisponible.");
    const entries = await response.json();
    if (!Array.isArray(entries) || entries.some(entry => typeof entry?.title !== "string" || typeof entry?.path !== "string")) {
      throw new Error("Catalogue invalide.");
    }
    for (const entry of entries) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = entry.title;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => { void openBook(entry, button); });
      item.append(button);
      library.append(item);
    }
    if (entries.length) await openBook(entries[0], library.querySelector("button"));
    else report("Les livres d’exemple seront bientôt disponibles.");
  } catch {
    report("La bibliothèque n’a pas pu être chargée. Recharge la page pour réessayer.", true);
  }
}

void loadLibrary();
