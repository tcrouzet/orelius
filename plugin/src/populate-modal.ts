import { FuzzySuggestModal, Modal, Setting, TFile, TFolder, type App } from "obsidian";
import { errorText } from "./codex";
import { t } from "./i18n.ts";
import { populateBrief, isModelNote } from "./populate-brief";

class DescriptionPicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private readonly modelPath: string, private readonly choose: (file: TFile) => void) { super(app); this.setPlaceholder(t("populateDescriptionNote")); }
  getItems(): TFile[] {
    const root = this.app.vault.getAbstractFileByPath(this.modelPath);
    const files: TFile[] = [];
    const visit = (folder: TFolder): void => {
      for (const child of folder.children) {
        if (child instanceof TFolder) visit(child);
        else if (child instanceof TFile && isModelNote(child.path, this.modelPath)) files.push(child);
      }
    };
    if (root instanceof TFolder) visit(root);
    return files;
  }
  getItemText(file: TFile): string { return file.path; }
  onChooseItem(file: TFile): void { this.choose(file); }
}

export class PopulateModal extends Modal {
  private result: string | null = null;
  constructor(app: App, private readonly modelPath: string, private readonly done: (brief: string | null) => void) { super(app); }
  onOpen(): void {
    this.setTitle(t("populate"));
    this.contentEl.createEl("p", { text: t("populateDescriptionHelp") });
    let description = "";
    let selected: TFile | undefined;
    new Setting(this.contentEl).setName(t("populateProjectDescription")).addTextArea(input => {
      input.inputEl.rows = 7;
      input.inputEl.cols = 50;
      input.setPlaceholder(t("populateDescriptionPlaceholder")).onChange(value => { description = value; });
      input.inputEl.focus();
    });
    const note = new Setting(this.contentEl).setName(t("populateDescriptionNote"));
    note.addButton(button => button.setButtonText(t("browse")).onClick(() => {
      new DescriptionPicker(this.app, this.modelPath, file => { selected = file; note.setDesc(file.path); }).open();
    })).addButton(button => button.setButtonText(t("populateRemoveNote")).onClick(() => { selected = undefined; note.setDesc(""); }));
    const error = this.contentEl.createEl("p", { attr: { role: "alert" } });
    new Setting(this.contentEl).addButton(button => button.setButtonText(t("cancel")).onClick(() => this.close()))
      .addButton(button => button.setButtonText(t("populate")).setCta().onClick(async () => {
        button.setDisabled(true);
        try {
          if (selected && !isModelNote(selected.path, this.modelPath)) throw new Error(t("populateNoteOutsideModel"));
          const brief = populateBrief(description, selected ? { path: selected.path, content: await this.app.vault.read(selected) } : undefined);
          if (!this.contentEl.isConnected) return;
          this.result = brief;
          this.close();
        } catch (failure) { error.setText(errorText(failure)); button.setDisabled(false); }
      }));
  }
  onClose(): void { this.contentEl.empty(); this.done(this.result); }
}
