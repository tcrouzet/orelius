import { Modal, Setting, type App } from "obsidian";
import { errorText } from "./codex";
import type { ContextChoice } from "./request-context";

export interface ContextNote { path: string; selected: boolean; reason: string; characters: number; required: boolean }
export interface ContextPreview { notes: ContextNote[]; characters: number; budget?: number; warnings?: string[] }
export class ContextModal extends Modal {
  private filter = "";
  private pending = false;
  private closed = false;
  private result: ContextPreview | null = null;
  constructor(app: App, private choice: ContextChoice, private preview: (choice: ContextChoice) => Promise<ContextPreview>, private apply: (choice: ContextChoice) => void) { super(app); }
  onOpen(): void { this.setTitle("Contexte de la prochaine demande"); this.modalEl.addClass("orelius-context-picker"); void this.refresh(this.choice, false); }
  private async refresh(choice: ContextChoice, save: boolean): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    this.contentEl.querySelectorAll("input, button").forEach(element => { (element as HTMLInputElement).disabled = true; });
    try {
      const result = await this.preview(choice);
      if (save) this.apply(choice);
      this.choice = choice; this.result = result;
      if (!this.closed) this.render();
    } catch (error) {
      if (!this.closed) { this.render(); this.contentEl.createEl("p", { text: errorText(error), attr: { role: "alert" } }); }
    } finally { this.pending = false; }
  }
  private render(): void {
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: this.choice.chapter ? `Chapitre : ${this.choice.chapter}` : "Échange sans chapitre ciblé." });
    this.contentEl.createEl("p", { text: "Cochez les notes à ajouter, décochez celles à retirer pour le prochain envoi. Les choix sont enregistrés à la volée. L’historique déjà transmis à Codex reste dans la conversation." });
    const result = this.result;
    if (result) this.contentEl.createEl("p", { text: `${result.characters.toLocaleString("fr")} caractères dans le dossier${result.budget === undefined ? "" : ` / budget ${result.budget.toLocaleString("fr")}${result.characters > result.budget ? " — trop volumineux pour l’envoi" : ""}`}. Cette mesure ne compte pas l’historique du chat ni les consignes système.` });
    for (const warning of result?.warnings ?? []) this.contentEl.createEl("p", { text: warning, attr: { role: "alert" } });
    new Setting(this.contentEl).setName("Rechercher une note").addSearch(input => input.setValue(this.filter).onChange(value => { this.filter = value; renderNotes(); }));
    new Setting(this.contentEl).addButton(button => button.setButtonText("Revenir au choix automatique").onClick(() => { void this.refresh({ ...this.choice, include: [], exclude: [] }, true); }))
      .addButton(button => button.setButtonText("Actualiser l’aperçu").onClick(() => { void this.refresh(this.choice, false); }))
      .addButton(button => button.setButtonText("Fermer").onClick(() => this.close()));
    const notes = this.contentEl.createDiv({ cls: "orelius-context-notes" });
    const renderNotes = () => {
      notes.empty();
      for (const note of result?.notes ?? []) {
        if (this.filter && !note.path.toLocaleLowerCase("fr").includes(this.filter.toLocaleLowerCase("fr"))) continue;
        new Setting(notes).setName(note.path).setDesc(`${note.required ? "Indispensable. " : ""}${note.reason}${note.selected ? ` — ${note.characters.toLocaleString("fr")} caractères` : ""}`)
          .addToggle(toggle => toggle.setValue(note.selected).setDisabled(note.required).onChange(value => {
            const choice = { ...this.choice, include: this.choice.include.filter(path => path !== note.path), exclude: this.choice.exclude.filter(path => path !== note.path) };
            choice[value ? "include" : "exclude"].push(note.path);
            void this.refresh(choice, true);
          }));
      }
      if (!notes.childElementCount) notes.createEl("p", { text: "Aucune note correspondante." });
    };
    renderNotes();
  }
  onClose(): void { this.closed = true; this.contentEl.empty(); }
}
