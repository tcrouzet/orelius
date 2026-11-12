import { t } from "./i18n.ts";
import { Notice, PluginSettingTab, Setting, type ButtonComponent, type SettingDefinitionItem } from "obsidian";
import type OreliusPlugin from "./main";
import { errorText, findCodex } from "./codex";
import { DEFAULT_PROJECT_FOLDERS, PROJECT_FOLDER_KEYS } from "./settings";

export class OreliusSettingTab extends PluginSettingTab {
  override icon = "orelius";

  constructor(private readonly plugin: OreliusPlugin) { super(plugin.app, plugin); }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [{ name: t("codexAndWritingProject"), aliases: [t("installation"), t("connection"), t("testCodex"), t("codexPath"),
      t("projectOrganization"), t("debugMode"),
      t("archives"), t("manuscript"), t("model2"), t("bible"), t("manuscriptFolder"), t("sourceTextsFolder"), t("archivesFolder"), t("bibleFolder")],
    render: setting => {
      setting.settingEl.removeClass("setting-item");
      this.renderSettings(setting.settingEl);
    } }];
  }

  private renderSettings(containerEl: HTMLElement): void {
    containerEl.empty();
    new Setting(containerEl).setName(t("codex")).setHeading();
    const installationEl = containerEl.createDiv();
    let detectedPath: string | null = null;
    let testButton!: ButtonComponent;
    new Setting(containerEl).setName(t("connection"))
      .setDesc(t("usesTheExistingCodexAuthentication"))
      .addButton(button => {
        testButton = button;
        button.setButtonText(t("testCodex")).setDisabled(true).onClick(async () => {
          button.setDisabled(true);
          codexStatus.setText(t("connectingToCodex"));
          try {
            const version = await this.plugin.testCodex();
            codexStatus.setText(t("codexConnectedAuthenticationAvailable", { value1: version }));
          } catch (error) { codexStatus.setText(errorText(error)); }
          finally { button.setDisabled(!detectedPath); }
        });
      });
    const codexStatus = containerEl.createEl("p", { attr: { role: "status" } });
    const showCodex = (path: string | null, manual = false, searched = true) => {
      detectedPath = path;
      installationEl.empty();
      const installation = new Setting(installationEl).setName(t("installation"))
        .setDesc(path ? t("codexDetected", { value1: path }) : t(searched ? "codexWasNotDetected" : "codexDetectionOnDemand"));
      testButton.setDisabled(!path);
      if (!path) installation.addButton(button => button.setButtonText(t("findCodex")).onClick(async () => {
        button.setDisabled(true);
        codexStatus.setText(t("searchingForCodex"));
        let found: string;
        try { found = await findCodex("", true); }
        catch {
          showCodex(null, true);
          codexStatus.setText(t("codexNotFoundEnterThePathToItsExecutable"));
          return;
        }
        try {
          await this.plugin.saveSettings({ codexPath: found });
          showCodex(found);
          codexStatus.setText("");
        } catch (error) { codexStatus.setText(errorText(error)); button.setDisabled(false); }
      }));
      if (manual) new Setting(installationEl).setName(t("codexPath"))
        .setDesc(t("absolutePathToTheCodexExecutable"))
        .addText(text => {
          let saving = Promise.resolve();
          text.setPlaceholder(t("pathToCodex")).setValue(this.plugin.settings.codexPath)
            .onChange(value => {
              codexStatus.setText("");
              saving = this.plugin.saveSettings({ codexPath: value.trim() });
              void saving.catch(error => codexStatus.setText(errorText(error)));
            });
          text.inputEl.onblur = async () => {
            try {
              await saving;
              const found = await findCodex(this.plugin.settings.codexPath);
              showCodex(found);
              codexStatus.setText("");
            } catch (error) { codexStatus.setText(errorText(error)); }
          };
        });
    };
    showCodex(null, false, false);

    new Setting(containerEl).setName(t("projectOrganization")).setHeading();
    const labels = { archiveFolder: t("archivesFolder"), manuscriptFolder: t("manuscriptFolder"), modelFolder: t("sourceTextsFolder"), bibleFolder: t("bibleFolder") };
    const layoutStatus = containerEl.createEl("p", { attr: { role: "status" } });
    for (const key of PROJECT_FOLDER_KEYS) {
      new Setting(containerEl).setName(labels[key]).setDesc(t("default", { value1: DEFAULT_PROJECT_FOLDERS[key] }))
        .addText(text => {
          let saving = Promise.resolve();
          text.setPlaceholder(DEFAULT_PROJECT_FOLDERS[key]).setValue(this.plugin.settings[key]).onChange(value => {
            layoutStatus.setText("");
            saving = this.plugin.saveSettings({ [key]: value.trim() });
            void saving.catch(error => layoutStatus.setText(errorText(error)));
          });
          text.inputEl.onblur = async () => {
            try {
              await saving;
              layoutStatus.setText("");
            } catch (error) { layoutStatus.setText(errorText(error)); }
          };
        });
    }
    containerEl.createEl("p", { cls: "setting-item-description",
      text: t("theManuscriptContainsChaptersCharactersPlanSummariesAndWorkshop") });
    new Setting(containerEl).setName(t("debugMode")).setDesc(t("debugModeDescription"))
      .addToggle(toggle => toggle.setValue(this.plugin.settings.debugMode).onChange(async value => {
        try { await this.plugin.saveSettings({ debugMode: value }); }
        catch (error) { new Notice(errorText(error)); }
      }));
  }
}
