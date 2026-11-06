import { t } from "./i18n.ts";
import { Modal, Setting, type App } from "obsidian";
import { errorText } from "./codex";
import { diffToGroups } from "./diff";
import { mergeComparison, type ComparisonVersion } from "./comparison";

export class ComparisonModal extends Modal {
  constructor(app: App, private versions: ComparisonVersion[], private submit: (content: string, description: string) => Promise<void>) { super(app); }
  onOpen(): void {
    this.setTitle(t("compareVersions"));
    this.modalEl.addClass("orelius-comparison");
    let left = 0, right = Math.min(1, this.versions.length - 1), pending = false;
    const selectors = this.contentEl.createDiv();
    const body = this.contentEl.createDiv();
    const render = () => {
      body.empty();
      const before = this.versions[left], after = this.versions[right];
      const stale = [before, after].some(version => version.base !== undefined && version.base !== this.versions[0].text);
      body.createEl("p", { text: t("theResultStartsWithTheLeftVersionSelectChanges") });
      const columns = body.createDiv({ cls: "orelius-comparison-columns" });
      for (const version of [before, after]) {
        const column = columns.createDiv();
        column.createEl("h3", { text: version.label });
        column.createEl("pre", { text: version.text });
      }
      const error = body.createEl("p", { attr: { role: "alert" } });
      if (stale) error.setText(t("theseProposalsReferToAnOlderChapterVersionYou"));
      let changes: ReturnType<typeof diffToGroups>;
      try { changes = diffToGroups(before.text, after.text); } catch (failure) { error.setText(errorText(failure)); return; }
      const selected = new Set<number>();
      const choices = body.createDiv();
      const preview = body.createEl("details");
      preview.createEl("summary", { text: t("fullResultPreview") });
      const output = preview.createEl("pre", { text: before.text });
      const update = () => { output.setText(mergeComparison(before.text, after.text, selected)); };
      changes.forEach((change, index) => {
        const label = choices.createEl("label", { cls: "orelius-comparison-change" });
        const input = label.createEl("input", { type: "checkbox" });
        label.createEl("span", { text: t("formattedText2", { value1: index + 1, value2: change.delText || "(insertion)", value3: change.insText || "(suppression)" }) });
        input.onchange = () => { if (input.checked) selected.add(index); else selected.delete(index); update(); };
      });
      if (!changes.length) choices.createEl("p", { text: t("theseVersionsAreIdentical") });
      const apply = async (content: string, description: string) => {
        if (pending) return;
        pending = true;
        this.contentEl.querySelectorAll("button, input, select").forEach(element => { (element as HTMLInputElement).disabled = true; });
        try { await this.submit(content, description); this.close(); }
        catch (failure) { pending = false; selectors.querySelectorAll("select").forEach(element => { element.disabled = false; }); render(); body.querySelector('[role="alert"]')?.setText(errorText(failure)); }
      };
      new Setting(body).addButton(button => button.setButtonText(t("applyResult")).setCta().setDisabled(stale)
        .onClick(() => { void apply(mergeComparison(before.text, after.text, selected), t("selectedChanges", { value1: before.label, value2: after.label })); }))
        .addButton(button => button.setButtonText(t("cancel")).onClick(() => this.close()));
      if (after.archive) new Setting(body).setName(t("restoreTheRightHandArchive")).setDesc(t("replaceTheEntireChapterWithThisArchiveTheCurrent"))
        .addButton(button => button.setButtonText(t("restoreThisArchive")).onClick(() => { void apply(after.text, t("restoration", { value1: after.archive })); }));
    };
    for (const side of ["left", "right"] as const) new Setting(selectors).setName(side === "left" ? t("startingVersion") : t("comparedVersion"))
      .addDropdown(dropdown => {
        this.versions.forEach((version, index) => dropdown.addOption(String(index), version.label));
        dropdown.setValue(String(side === "left" ? left : right)).onChange(value => { if (side === "left") left = Number(value); else right = Number(value); render(); });
      });
    render();
  }
  onClose(): void { this.contentEl.empty(); }
}
