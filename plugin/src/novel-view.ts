import { ItemView, Setting, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import type OreliusPlugin from "./main";
import { errorText } from "./codex";
import { SCENE_STATUSES, type OutlineAction, type NovelOutline } from "./novel-outline";
import type { StoryNode, StoryStructure } from "./story-structure";

export const NOVEL_VIEW = "orelius-novel";
export class NovelView extends ItemView {
  projectFolder: string;
  private data: StoryStructure | null = null;
  private pending = false;
  private closed = false;
  private collapsed = new Set<string>();
  private expandedScenes = new Set<string>();
  constructor(leaf: WorkspaceLeaf, private plugin: OreliusPlugin) { super(leaf); this.projectFolder = plugin.settings.folder; }
  getViewType(): string { return NOVEL_VIEW; }
  getDisplayText(): string { return "Vue d’ensemble du roman"; }
  getIcon(): string { return "list-tree"; }
  getState(): Record<string, unknown> { return { folder: this.projectFolder }; }
  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    if (state && typeof state === "object" && "folder" in state && typeof state.folder === "string") this.projectFolder = state.folder;
    await super.setState(state, result);
    await this.refresh();
  }
  async onOpen(): Promise<void> { this.closed = false; this.render(); }
  async onClose(): Promise<void> { this.closed = true; this.contentEl.empty(); }
  async refresh(action?: OutlineAction): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    this.contentEl.querySelectorAll("button, input, select").forEach(element => { (element as HTMLInputElement).disabled = true; });
    try {
      this.data = await this.plugin.loadNovel(this.projectFolder, action && this.data ? { expected: JSON.stringify(this.data), action } : undefined);
      if (!this.closed) this.render();
    } catch (error) {
      if (!this.closed) {
        this.render();
        this.contentEl.createEl("p", { text: errorText(error), attr: { role: "alert" } });
      }
    } finally { this.pending = false; }
  }
  private render(): void {
    this.contentEl.empty(); this.contentEl.addClass("orelius-novel");
    this.contentEl.createEl("h2", { text: "Vue d’ensemble du roman" });
    this.contentEl.createEl("p", { text: "Déplacez les scènes dans le plan. Les passages déjà écrits restent en place ; leurs liens permettent de repérer les raccords à reprendre." });
    new Setting(this.contentEl).addButton(button => button.setButtonText("Actualiser").onClick(() => { void this.refresh(); }));
    const data = this.data;
    if (!data?.outline) return;
    let title = "";
    new Setting(this.contentEl).setName("Nouvel acte").addText(input => input.setPlaceholder("Titre de l’acte").onChange(value => { title = value; }))
      .addButton(button => button.setButtonText("Ajouter l’acte").onClick(() => { void this.refresh({ type: "act", title }); }));
    const node = (id: string) => data.nodes.find(item => item.id === id)!;
    const label = (item: StoryNode) => item.path.split("/").pop()!.replace(/\.md$/i, "") + (item.missing ? " (fichier absent)" : "");
    const open = (container: HTMLElement, item: StoryNode) => {
      const button = container.createEl("button", { text: label(item), cls: "orelius-novel-note" });
      button.disabled = item.missing;
      button.title = item.path;
      button.onclick = () => {
        if (this.projectFolder !== this.plugin.settings.folder) { this.contentEl.createEl("p", { text: "Le dossier de travail a changé. Rouvrez la vue du roman.", attr: { role: "alert" } }); return; }
        void this.plugin.openFile(item.path, true).catch(error => { this.contentEl.createEl("p", { text: errorText(error), attr: { role: "alert" } }); });
      };
    };
    const section = (container: HTMLElement, id: string, title: string) => {
      const details = container.createEl("details"); details.open = !this.collapsed.has(id);
      details.createEl("summary", { text: title });
      details.ontoggle = () => { if (details.open) this.collapsed.delete(id); else this.collapsed.add(id); };
      return details;
    };
    const renderScenes = (container: HTMLElement, chapter: string | null) => {
      const scenes = data.outline!.scenes.filter(item => item.chapter === chapter);
      if (!scenes.length) container.createEl("p", { text: "Aucune scène." });
      scenes.forEach((scene, index) => {
        const item = node(scene.id), card = container.createDiv({ cls: "orelius-novel-scene" });
        open(card, item);
        card.createEl("span", { text: ` — ${SCENE_STATUSES[scene.status]} · ${scene.pov || "Point de vue non précisé"}` });
        const edit = (change: Partial<NovelOutline["scenes"][number]>, before: string | null = scenes[index + 1]?.id ?? null) => {
          void this.refresh({ type: "scene", ...scene, ...change, before });
        };
        if (!item.missing) {
          const controls = card.createEl("details");
          controls.createEl("summary", { text: "Organiser cette scène" });
          controls.open = this.expandedScenes.has(scene.id);
          controls.ontoggle = () => { if (controls.open) this.expandedScenes.add(scene.id); else this.expandedScenes.delete(scene.id); };
          new Setting(controls).setName("Chapitre").addDropdown(dropdown => {
            dropdown.addOption("", "Scène non affectée");
            for (const chapter of data.outline!.chapters) if (!node(chapter.id).missing || chapter.id === scene.chapter) dropdown.addOption(chapter.id, label(node(chapter.id)));
            dropdown.setValue(scene.chapter ?? "").onChange(value => edit({ chapter: value || null }, null));
          }).addButton(button => button.setButtonText("Monter").setDisabled(index === 0).onClick(() => edit({}, scenes[index - 1].id)))
            .addButton(button => button.setButtonText("Descendre").setDisabled(index === scenes.length - 1).onClick(() => edit({}, scenes[index + 2]?.id ?? null)));
          new Setting(controls).setName("Point de vue").addText(input => {
            input.setValue(scene.pov).setPlaceholder("Personnage ou narrateur");
            input.inputEl.maxLength = 200;
            input.inputEl.onchange = () => edit({ pov: input.getValue() });
          });
          new Setting(controls).setName("Statut").addDropdown(dropdown => {
            for (const [value, title] of Object.entries(SCENE_STATUSES)) dropdown.addOption(value, title);
            dropdown.setValue(scene.status).onChange(value => edit({ status: value as keyof typeof SCENE_STATUSES }));
          });
        }
        for (const [title, kinds] of [["Personnages", ["personnage"]], ["Fils narratifs", ["intrigue", "arc"]], ["Plan", ["plan"]]] as const) {
          const related = data.links.filter(link => link.to === scene.id && kinds.some(kind => node(link.from).kind === kind));
          const row = card.createDiv({ cls: "orelius-novel-relations" }); row.createEl("strong", { text: `${title} : ` });
          if (!related.length) row.createSpan({ text: "Aucun lien renseigné" });
          for (const link of related) {
            open(row, node(link.from));
            if (link.fromHash !== node(link.from).hash || link.toHash !== item.hash) row.createSpan({ text: " (à revalider)" });
          }
        }
        const written = data.links.filter(link => link.from === scene.id && link.relation === "realise");
        for (const link of written) {
          const row = card.createDiv(); row.createSpan({ text: link.to === chapter ? "Passage lié dans : " : "Raccord à vérifier, passage lié dans : " }); open(row, node(link.to));
        }
      });
    };
    for (const act of [...data.outline.acts, { id: null, title: "Chapitres sans acte" }]) {
      const actGroup = section(this.contentEl, act.id ?? "unassigned", act.title);
      if (act.id) new Setting(actGroup).setName("Titre de l’acte").addText(input => {
        input.setValue(act.title); input.inputEl.maxLength = 200;
        input.inputEl.onchange = () => { void this.refresh({ type: "act", id: act.id!, title: input.getValue() }); };
      });
      const chapters = data.outline.chapters.filter(chapter => chapter.act === act.id);
      if (!chapters.length) actGroup.createEl("p", { text: "Aucun chapitre." });
      for (const chapter of chapters) {
        const item = node(chapter.id), group = section(actGroup, chapter.id, label(item));
        open(group, item);
        if (!item.missing) new Setting(group).setName("Acte").addDropdown(dropdown => {
          dropdown.addOption("", "Sans acte"); for (const act of data.outline!.acts) dropdown.addOption(act.id, act.title);
          dropdown.setValue(chapter.act ?? "").onChange(value => { void this.refresh({ type: "chapter", id: chapter.id, act: value || null }); });
        });
        renderScenes(group, chapter.id);
      }
    }
    renderScenes(section(this.contentEl, "unassigned-scenes", "Scènes non affectées"), null);
  }
}
