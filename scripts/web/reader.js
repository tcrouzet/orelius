"use strict";

const home = document.getElementById("home");
const reader = document.getElementById("reader");
const library = document.getElementById("books");
const title = document.getElementById("book-title");
const status = document.getElementById("status");
const viewer = document.getElementById("viewer");
const menu = document.getElementById("reader-menu");
const menuButton = document.getElementById("menu-button");
const chapters = document.getElementById("chapters");
const contents = document.getElementById("contents");
const font = document.getElementById("font-family");
const smaller = document.getElementById("smaller");
const larger = document.getElementById("larger");
const sizeLabel = document.getElementById("font-size");
let book = null;
let rendition = null;
let generation = 0;
let fontSize = 100;
let selectedTitle = null;

function report(message, error = false) {
  status.textContent = message;
  status.classList.toggle("is-error", error);
}

function applyTypography() {
  if (rendition) {
    rendition.themes.fontSize(`${fontSize}%`);
    if (font.value) rendition.themes.font(font.value);
    else rendition.themes.removeOverride("font-family");
  }
  sizeLabel.value = `${fontSize} %`;
  smaller.disabled = !rendition || fontSize <= 70;
  larger.disabled = !rendition || fontSize >= 200;
  font.disabled = !rendition;
}

async function showChapter(href) {
  const current = generation;
  menu.close();
  try { await rendition?.display(href); }
  catch { if (current === generation) report("Ce passage n’a pas pu être affiché. Réessaie.", true); }
}

function addChapters(items, list = chapters) {
  for (const item of items) {
    const row = document.createElement("li");
    const link = document.createElement("a");
    link.href = item.href;
    link.textContent = item.label.trim();
    link.addEventListener("click", event => { event.preventDefault(); void showChapter(item.href); });
    row.append(link);
    if (item.subitems?.length) {
      const children = document.createElement("ol");
      addChapters(item.subitems, children);
      row.append(children);
    }
    list.append(row);
  }
}

function returnHome() {
  generation++;
  menu.close();
  book?.destroy();
  book = rendition = null;
  viewer.replaceChildren();
  reader.hidden = true;
  home.hidden = false;
  document.body.classList.remove("reading");
  document.title = "Livres d’exemple — Orelius";
  viewer.setAttribute("aria-busy", "false");
  report("");
  selectedTitle?.focus();
}

async function openBook(entry, button) {
  const current = ++generation;
  selectedTitle = button;
  home.hidden = true;
  reader.hidden = false;
  document.body.classList.add("reading");
  menuButton.focus();
  try {
    book?.destroy();
    book = rendition = null;
    viewer.replaceChildren();
    chapters.replaceChildren();
    contents.open = false;
    applyTypography();
    title.textContent = entry.title;
    viewer.setAttribute("aria-busy", "true");
    report("Ouverture du livre…");
    if (typeof window.ePub !== "function") throw new Error("Le lecteur n’a pas pu se charger. Recharge la page.");
    const url = new URL(entry.path, document.baseURI);
    if (!url.href.startsWith(new URL("samples/", document.baseURI).href)) throw new Error("Ce livre ne fait pas partie de la bibliothèque.");
    const opening = window.ePub();
    book = opening;
    await opening.open(url.href, "epub");
    if (current !== generation) return;
    const metadata = await opening.loaded.metadata;
    if (current !== generation) return;
    title.textContent = metadata.title || entry.title;
    document.title = `${title.textContent} — Orelius`;
    const display = opening.renderTo(viewer, {
      width: "100%", height: "100%", manager: "continuous", flow: "scrolled", spread: "none", allowScriptedContent: false,
    });
    rendition = display;
    applyTypography();
    await display.display();
    if (current !== generation) return;
    report("");
    const navigation = await opening.loaded.navigation;
    if (current !== generation) return;
    addChapters(navigation.toc);
    if (!chapters.children.length) chapters.textContent = "Ce livre n’a pas de sommaire.";
  } catch (error) {
    if (current === generation) report(`Impossible d’ouvrir ce livre. ${error instanceof Error ? error.message : "Réessaie dans un instant."}`, true);
  } finally {
    if (current === generation) viewer.setAttribute("aria-busy", "false");
  }
}

menuButton.addEventListener("click", () => {
  menu.showModal();
  menuButton.setAttribute("aria-expanded", "true");
});
menu.addEventListener("close", () => { menuButton.setAttribute("aria-expanded", "false"); });
document.getElementById("close-menu").addEventListener("click", () => menu.close());
document.getElementById("return-home").addEventListener("click", returnHome);
smaller.addEventListener("click", () => { fontSize = Math.max(70, fontSize - 10); applyTypography(); });
larger.addEventListener("click", () => { fontSize = Math.min(200, fontSize + 10); applyTypography(); });
font.addEventListener("change", applyTypography);

async function loadLibrary() {
  try {
    const response = await fetch("books.json");
    if (!response.ok) throw new Error("Catalogue indisponible.");
    const entries = await response.json();
    if (!Array.isArray(entries) || entries.some(entry => typeof entry?.title !== "string" || typeof entry?.path !== "string")) throw new Error("Catalogue invalide.");
    for (const entry of entries) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = entry.title;
      button.addEventListener("click", () => { void openBook(entry, button); });
      item.append(button);
      library.append(item);
    }
    report(entries.length ? "" : "Les livres d’exemple seront bientôt disponibles.");
  } catch { report("La bibliothèque n’a pas pu être chargée. Recharge la page pour réessayer.", true); }
}

void loadLibrary();
