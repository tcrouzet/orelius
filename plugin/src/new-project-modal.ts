import { t } from "./i18n.ts";
import { FuzzySuggestModal, Modal, Setting, TFolder, type App } from "obsidian";
import { errorText } from "./codex";

class ProjectFolderPicker extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private readonly choose: (folder: TFolder) => void) {
    super(app);
    this.setPlaceholder(t("chooseProjectLocation"));
  }
  getItems(): TFolder[] { return [this.app.vault.getRoot(), ...this.app.vault.getAllFolders(false)]; }
  getItemText(folder: TFolder): string { return folder === this.app.vault.getRoot() ? t("vaultRoot") : folder.path; }
  onChooseItem(folder: TFolder): void { this.choose(folder); }
}

export class NewProjectModal extends Modal {
  constructor(app: App, private parent: string, private readonly modelFolder: string,
    private readonly create: (name: string, parent: string) => Promise<void>) { super(app); }

  onOpen(): void {
    this.setTitle(t("newOreliusProject"));
    const location = new Setting(this.contentEl).setName(t("projectLocation")).setDesc(this.parent || t("vaultRoot"));
    location.addButton(button => button.setButtonText(t("browse")).onClick(() => {
      new ProjectFolderPicker(this.app, folder => {
        this.parent = folder === this.app.vault.getRoot() ? "" : folder.path;
        location.setDesc(this.parent || t("vaultRoot"));
      }).open();
    }));
    let name = "";
    new Setting(this.contentEl).setName(t("projectName")).addText(input => {
      input.setPlaceholder(t("myNovel")).onChange(value => { name = value; });
      input.inputEl.focus();
    });
    this.contentEl.createEl("p", { text: t("afterCreationCopyAllAvailableMaterialIntoTextsDrafts", { value1: this.modelFolder, value2: this.modelFolder }) });
    const error = this.contentEl.createEl("p", { attr: { role: "alert" } });
    new Setting(this.contentEl).addButton(button => button.setButtonText(t("cancel")).onClick(() => this.close()))
      .addButton(button => button.setButtonText(t("create")).setCta().onClick(() => {
        button.setDisabled(true);
        void this.create(name.trim(), this.parent).then(() => this.close(), failure => {
          error.setText(errorText(failure));
          button.setDisabled(false);
        });
      }));
  }
  onClose(): void { this.contentEl.empty(); }
}
