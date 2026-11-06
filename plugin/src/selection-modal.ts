import { t } from "./i18n.ts";
import { Modal, Setting, type App } from "obsidian";
import { errorText } from "./codex";
import { SELECTION_ACTIONS, type SelectionAction } from "./selection-actions";

export class SelectionModal extends Modal {
  constructor(app: App, action: SelectionAction, selected: string, submit: (details: string, target: string) => Promise<void>) {
    super(app);
    this.action = action; this.selected = selected; this.submit = submit;
  }
  private readonly action: SelectionAction;
  private readonly selected: string;
  private readonly submit: (details: string, target: string) => Promise<void>;
  onOpen(): void {
    const action = SELECTION_ACTIONS.find(item => item.id === this.action)!;
    this.setTitle(action.label);
    this.contentEl.createEl("p", { text: this.selected.length > 400 ? this.selected.slice(0, 400) + t("formattedText6") : this.selected });
    let target = "", details = "";
    if (this.action === "point-de-vue") new Setting(this.contentEl).setName(t("desiredPointOfView")).addText(input => input.setPlaceholder(t("characterFirstOrThirdPerson")).onChange(value => { target = value; }));
    new Setting(this.contentEl).setName(t("additionalInstructionsOptional")).addTextArea(input => input.setPlaceholder(t("desiredEffectLengthTone")).onChange(value => { details = value; }));
    this.contentEl.createEl("p", { text: this.action === "variantes" ? t("alternativesWillBeAvailableInCompareVersionsTheManuscript") : t("onlyTheSelectedPassageMayBeReplacedAfterReview") });
    const error = this.contentEl.createEl("p", { attr: { role: "alert" } });
    new Setting(this.contentEl).addButton(button => button.setButtonText(t("cancel")).onClick(() => this.close()))
      .addButton(button => button.setButtonText(t("send")).setCta().onClick(() => {
        button.setDisabled(true);
        void this.submit(details, target).then(() => this.close(), failure => { error.setText(errorText(failure)); button.setDisabled(false); });
      }));
  }
  onClose(): void { this.contentEl.empty(); }
}
