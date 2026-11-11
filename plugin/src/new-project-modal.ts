import { t } from "./i18n.ts";
import { FuzzySuggestModal, Modal, Setting, TFolder, type App } from "obsidian";
import { errorText } from "./codex";

class ProjectFolderPicker extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private readonly choose: (folder: TFolder) => void, private readonly allowVaultRoot = false) {
    super(app);
    this.setPlaceholder(t("chooseProjectLocation"));
  }
  getItems(): TFolder[] { return [...(this.allowVaultRoot ? [this.app.vault.getRoot()] : []), ...this.app.vault.getAllFolders(false)]; }
  getItemText(folder: TFolder): string { return folder === this.app.vault.getRoot() ? t("vaultRoot") : folder.path; }
  onChooseItem(folder: TFolder): void { this.choose(folder); }
}

export class NewProjectModal extends Modal {
  private error!: HTMLElement;
  private submitting = false;
  constructor(app: App, private readonly folder: string, private readonly modelFolder: string,
    private readonly create: (name: string | null, folder: string) => Promise<void>) { super(app); }

  onOpen(): void {
    this.contentEl.empty();
    this.setTitle(t("newOreliusProject"));
    new Setting(this.contentEl).setName(t("currentProjectFolder")).setDesc(this.folder || t("vaultRoot"))
      .addButton(button => button.setButtonText(t("useProjectFolder")).setDisabled(!this.folder).setCta().onClick(() => { void this.submit(null, this.folder); }));
    new Setting(this.contentEl).setName(t("createNewProjectFolder"))
      .addButton(button => button.setButtonText(t("create")).onClick(() => this.newFolder()));
    new Setting(this.contentEl).setName(t("openExistingProjectFolder"))
      .addButton(button => button.setButtonText(t("browse")).onClick(() => {
        new ProjectFolderPicker(this.app, folder => { void this.submit(null, folder === this.app.vault.getRoot() ? "" : folder.path); }).open();
      }));
    this.error = this.contentEl.createEl("p", { attr: { role: "alert" } });
    new Setting(this.contentEl).addButton(button => button.setButtonText(t("cancel")).onClick(() => this.close()));
  }

  private newFolder(): void {
    this.contentEl.empty();
    this.setTitle(t("createNewProjectFolder"));
    let parent = this.folder;
    const location = new Setting(this.contentEl).setName(t("projectLocation")).setDesc(parent || t("vaultRoot"));
    location.addButton(button => button.setButtonText(t("browse")).onClick(() => {
      new ProjectFolderPicker(this.app, folder => {
        parent = folder === this.app.vault.getRoot() ? "" : folder.path;
        location.setDesc(parent || t("vaultRoot"));
      }, true).open();
    }));
    let name = "";
    new Setting(this.contentEl).setName(t("projectFolderName")).addText(input => {
      input.setPlaceholder(t("myNovel")).onChange(value => { name = value; });
      input.inputEl.focus();
    });
    this.contentEl.createEl("p", { text: t("afterCreationCopyAllAvailableMaterialIntoTextsDrafts", { value1: this.modelFolder, value2: this.modelFolder }) });
    this.error = this.contentEl.createEl("p", { attr: { role: "alert" } });
    new Setting(this.contentEl).addButton(button => button.setButtonText(t("back")).onClick(() => this.onOpen()))
      .addButton(button => button.setButtonText(t("create")).setCta().onClick(() => { void this.submit(name.trim(), parent); }));
  }

  private async submit(name: string | null, folder: string): Promise<void> {
    if (this.submitting) return;
    this.submitting = true;
    this.error.setText("");
    const buttons = Array.from(this.contentEl.querySelectorAll("button"), button => ({ button, disabled: button.disabled }));
    for (const { button } of buttons) button.disabled = true;
    try { await this.create(name, folder); this.close(); }
    catch (failure) {
      this.error.setText(errorText(failure));
      this.submitting = false;
      for (const { button, disabled } of buttons) button.disabled = disabled;
    }
  }
  onClose(): void { this.contentEl.empty(); }
}
