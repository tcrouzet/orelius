import type { App } from "obsidian";
import { errorText } from "./codex.ts";
import { t } from "./i18n.ts";
import { modelProject, type OreliusSettings } from "./settings.ts";

export class ExplorerActions {
  private observers = new Map<HTMLElement, MutationObserver>();
  private frame: number | null = null;
  private generation = 0;
  private readonly app: App;
  private readonly settings: () => OreliusSettings;
  private readonly busy: (folder: string) => boolean;
  private readonly hasNewSources: (folder: string) => Promise<boolean>;
  private readonly populate: (folder: string) => void;
  constructor(app: App, settings: () => OreliusSettings, busy: (folder: string) => boolean,
    hasNewSources: (folder: string) => Promise<boolean>, populate: (folder: string) => void) {
    this.app = app;
    this.settings = settings;
    this.busy = busy;
    this.hasNewSources = hasNewSources;
    this.populate = populate;
  }

  refresh = (): void => {
    if (this.frame !== null) return;
    this.frame = window.requestAnimationFrame(() => { this.frame = null; this.render(); });
  };
  private render(): void {
    const generation = ++this.generation;
    const availability = new Map<string, Promise<{ hasNew: boolean; error: string }>>();
    const roots = new Set(this.app.workspace.getLeavesOfType("file-explorer").map(leaf => leaf.view.containerEl));
    for (const [root, observer] of this.observers) if (!roots.has(root)) {
      observer.disconnect();
      root.querySelectorAll(".orelius-populate").forEach(button => button.remove());
      this.observers.delete(root);
    }
    for (const root of roots) {
      if (!this.observers.has(root)) {
        const observer = new MutationObserver(this.refresh);
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-path"] });
        this.observers.set(root, observer);
      }
      for (const row of Array.from(root.querySelectorAll<HTMLElement>(".nav-folder-title[data-path]"))) {
        const folder = modelProject(this.settings(), row.getAttribute("data-path") ?? "");
        let button = row.querySelector<HTMLButtonElement>(".orelius-populate");
        if (folder === undefined) { button?.remove(); continue; }
        if (!button) {
          button = row.createEl("button", { cls: "orelius-populate", attr: { type: "button" } });
          row.querySelector(".nav-folder-title-content")?.after(button);
          button.onpointerdown = event => event.stopPropagation();
          button.onmousedown = event => event.stopPropagation();
          button.ondblclick = event => event.stopPropagation();
          button.onkeydown = event => event.stopPropagation();
        }
        const label = t("populate");
        if (button.textContent !== label) button.setText(label);
        button.disabled = true;
        button.title = "";
        if (!availability.has(folder)) availability.set(folder, this.hasNewSources(folder).then(hasNew => ({ hasNew, error: "" }), error => ({ hasNew: false, error: errorText(error) })));
        const currentButton = button;
        void availability.get(folder)!.then(({ hasNew, error }) => {
          if (generation !== this.generation) return;
          currentButton.disabled = this.busy(folder) || !hasNew;
          currentButton.title = error || (hasNew ? "" : t("noNewPopulateDocuments"));
        });
        button.onclick = event => { event.preventDefault(); event.stopPropagation(); this.populate(folder); };
      }
    }
  }
  destroy(): void {
    this.generation++;
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    for (const [root, observer] of this.observers) {
      observer.disconnect();
      root.querySelectorAll(".orelius-populate").forEach(button => button.remove());
    }
    this.observers.clear();
  }
}
