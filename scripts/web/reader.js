import { DEFAULT_FONT, readingState } from "./reader-config.js";

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
const format = document.getElementById("reading-format");
const smaller = document.getElementById("smaller");
const larger = document.getElementById("larger");
const sizeLabel = document.getElementById("font-size");
const previousPage = document.getElementById("previous-page");
const nextPage = document.getElementById("next-page");
let storage;
try { storage = window.localStorage; } catch { /* Browser storage can be unavailable. */ }
const state = readingState(storage, new URL(".", document.baseURI).pathname);
const preferences = state.loadPreferences([...font.options].map(option => option.value));
font.value = preferences.fontFamily;
format.value = preferences.format;
let book = null;
let rendition = null;
let generation = 0;
let fontSize = preferences.fontSize;
let turningPage = false;

function savePreferences() {
  state.savePreferences({ fontFamily: font.value, fontSize, format: format.value });
}

function updatePageControls(location = rendition?.location) {
  const paginated = format.value === "paginated";
  reader.dataset.format = format.value;
  previousPage.hidden = nextPage.hidden = !paginated;
  previousPage.disabled = !rendition || !location || turningPage || Boolean(location.atStart);
  nextPage.disabled = !rendition || !location || turningPage || Boolean(location.atEnd);
}

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
  format.disabled = !rendition;
  updatePageControls();
}

async function turnPage(forward) {
  const current = generation;
  if (!rendition || turningPage || format.value !== "paginated" || menu.open
    || (forward ? nextPage.disabled : previousPage.disabled)) return;
  turningPage = true;
  updatePageControls();
  try { await rendition[forward ? "next" : "prev"](); }
  catch { if (current === generation) report("Cette page n’a pas pu être affichée. Réessaie.", true); }
  finally { turningPage = false; if (current === generation) updatePageControls(); }
}

function navigateWithKeyboard(event) {
  if (reader.hidden || menu.open || format.value !== "paginated" || event.defaultPrevented
    || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    || ![menuButton, previousPage, nextPage].includes(event.target) && event.target?.closest?.("input, textarea, select, button, a, [contenteditable]")) return;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const rtl = book?.package?.metadata?.direction === "rtl";
  void turnPage((event.key === "ArrowRight") !== rtl);
}

function navigateAtEdge(event) {
  if (event.defaultPrevented || event.detail > 1 || event.view?.getSelection()?.isCollapsed === false
    || event.target?.closest?.("a, button, input, textarea, select, [contenteditable]")) return;
  const frame = event.view?.frameElement;
  if (!frame) return;
  const bounds = viewer.getBoundingClientRect();
  const x = event.clientX + frame.getBoundingClientRect().left;
  if (x > bounds.left + 48 && x < bounds.right - 48) return;
  const rtl = book?.package?.metadata?.direction === "rtl";
  void turnPage((x >= bounds.left + bounds.width / 2) !== rtl);
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
  window.location.assign(new URL(".", document.baseURI).href);
}

async function openBook(entry) {
  const current = ++generation;
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
    reader.dir = metadata.direction === "rtl" ? "rtl" : "ltr";
    document.title = `${title.textContent} — Orelius`;
    const display = opening.renderTo(viewer, {
      width: "100%", height: "100%", manager: "continuous", flow: format.value,
      spread: format.value === "paginated" ? "auto" : "none", snap: true, allowScriptedContent: false,
      stylesheet: new URL("ia-writer-duo.css", document.baseURI).href,
    });
    rendition = display;
    display.hooks.content.register(async contents => {
      if (font.value === DEFAULT_FONT && contents.document.fonts) {
        await contents.document.fonts.load('16px "iA Writer Duo V"');
        contents.resizeCheck();
      }
    });
    const position = state.position(url.href);
    let restored = false;
    display.on("relocated", location => {
      if (current !== generation) return;
      updatePageControls(location);
      if (restored) state.savePosition(url.href, location.start?.cfi);
    });
    display.on("keydown", navigateWithKeyboard);
    display.on("click", navigateAtEdge);
    display.on("displayerror", () => { if (current === generation) report("Ce passage n’a pas pu être affiché. Réessaie.", true); });
    applyTypography();
    let positionLost = false;
    try { await display.display(position); }
    catch (error) {
      if (!position || current !== generation) throw error;
      await display.display();
      positionLost = true;
    }
    if (current !== generation) return;
    restored = true;
    state.savePosition(url.href, display.location?.start?.cfi);
    updatePageControls();
    report(positionLost ? "La position enregistrée n’est plus disponible. Lecture reprise au début." : "");
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
previousPage.addEventListener("click", () => { void turnPage(false); });
nextPage.addEventListener("click", () => { void turnPage(true); });
smaller.addEventListener("click", () => { fontSize = Math.max(70, fontSize - 10); applyTypography(); savePreferences(); });
larger.addEventListener("click", () => { fontSize = Math.min(200, fontSize + 10); applyTypography(); savePreferences(); });
font.addEventListener("change", () => { applyTypography(); savePreferences(); });
format.addEventListener("change", () => {
  if (!rendition) return;
  rendition.spread(format.value === "paginated" ? "auto" : "none");
  rendition.flow(format.value);
  updatePageControls();
  savePreferences();
});
document.addEventListener("keydown", navigateWithKeyboard);

async function loadLibrary() {
  try {
    const response = await fetch(new URL("books.json", document.baseURI));
    if (!response.ok) throw new Error("Catalogue indisponible.");
    const entries = await response.json();
    if (!Array.isArray(entries) || entries.some(entry => typeof entry?.title !== "string" || typeof entry?.author !== "string" || typeof entry?.path !== "string" || typeof entry?.url !== "string")) throw new Error("Catalogue invalide.");
    for (const entry of entries) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      const url = new URL(entry.url, document.baseURI);
      if (!url.href.startsWith(new URL(".", document.baseURI).href)) throw new Error("Adresse de livre invalide.");
      link.href = url.href;
      link.textContent = `${entry.title} — ${entry.author}`;
      item.append(link);
      library.append(item);
    }
    report(entries.length ? "" : "Les livres d’exemple seront bientôt disponibles.");
    const selected = document.querySelector('meta[name="orelius-book"]')?.content;
    if (selected) {
      const entry = entries.find(entry => entry.path === selected);
      if (!entry) throw new Error("Livre introuvable dans le catalogue.");
      await openBook(entry);
    }
  } catch { report("La bibliothèque n’a pas pu être chargée. Recharge la page pour réessayer.", true); }
}

applyTypography();
void loadLibrary();
