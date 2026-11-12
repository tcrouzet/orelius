import { Modal, Setting, type App } from "obsidian";
import { t } from "./i18n.ts";
import type { ProjectFolders } from "./settings.ts";

export class ResetProjectModal extends Modal {
  private confirmed = false;
  private resolve!: (confirmed: boolean) => void;
  readonly result = new Promise<boolean>(resolve => { this.resolve = resolve; });

  constructor(app: App, private readonly project: string, private readonly folders: ProjectFolders) { super(app); }

  onOpen(): void {
    this.setTitle(t("resetProjectTitle", { project: this.project }));
    this.contentEl.createEl("p", { text: t("resetProjectWarning", {
      bible: this.folders.bibleFolder, manuscript: this.folders.manuscriptFolder,
      model: this.folders.modelFolder, archive: this.folders.archiveFolder,
    }) });
    new Setting(this.contentEl)
      .addButton(button => {
        button.setButtonText(t("cancel")).onClick(() => this.close());
        button.buttonEl.focus();
      })
      .addButton(button => button.setButtonText(t("reset")).setDestructive().setCta().onClick(() => {
        this.confirmed = true;
        this.close();
      }));
  }

  onClose(): void {
    this.resolve(this.confirmed);
    this.contentEl.empty();
  }
}
