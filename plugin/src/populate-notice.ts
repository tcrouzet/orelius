import { Modal, Setting, type App } from "obsidian";
import { t } from "./i18n.ts";

export class PopulateNotice extends Modal {
  constructor(app: App, private readonly folder: string) { super(app); }
  onOpen(): void {
    this.setTitle(t("noNewPopulateDocuments"));
    this.contentEl.createEl("p", { text: t("noNewPopulateDocumentsDescription", { folder: this.folder }) });
    new Setting(this.contentEl).addButton(button => button.setButtonText(t("close")).setCta().onClick(() => this.close()));
  }
  onClose(): void { this.contentEl.empty(); }
}
