import { FuzzySuggestModal, PluginSettingTab, Setting, TFolder, type ButtonComponent } from "obsidian";
import type OreliusPlugin from "./main";
import { errorText, findCodex } from "./codex";
import { DEFAULT_PROJECT_FOLDERS, PROJECT_FOLDER_KEYS } from "./settings";
import { VIEW_TYPE } from "./chat-view";

class FolderPicker extends FuzzySuggestModal<string> {
  constructor(plugin: OreliusPlugin, private readonly choose: (folder: string) => void) {
    super(plugin.app);
    this.setPlaceholder("Choisir le dossier de travail…");
  }

  getItems(): string[] {
    return ["", ...this.app.vault.getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder && !file.isRoot())
      .map(folder => folder.path).sort((a, b) => a.localeCompare(b, "fr"))];
  }

  getItemText(folder: string): string { return folder || "Racine du coffre"; }
  onChooseItem(folder: string): void { this.choose(folder); }
}

export class OreliusSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: OreliusPlugin) { super(plugin.app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("Codex").setHeading();
    const installationEl = containerEl.createDiv();
    new Setting(installationEl).setName("Installation").setDesc("Détection de Codex…");
    let detectedPath: string | null = null;
    let testButton!: ButtonComponent;
    new Setting(containerEl).setName("Connexion")
      .setDesc("Utilise l’authentification existante de Codex.")
      .addButton(button => {
        testButton = button;
        button.setButtonText("Tester Codex").setDisabled(true).onClick(async () => {
          button.setDisabled(true);
          codexStatus.setText("Connexion à Codex…");
          try {
            const version = await this.plugin.testCodex();
            codexStatus.setText(`Codex ${version} connecté. Authentification disponible.`);
          } catch (error) { codexStatus.setText(errorText(error)); }
          finally { button.setDisabled(!detectedPath); }
        });
      });
    const codexStatus = containerEl.createEl("p", { attr: { role: "status" } });
    const showCodex = (path: string | null, manual = false) => {
      detectedPath = path;
      installationEl.empty();
      const installation = new Setting(installationEl).setName("Installation")
        .setDesc(path ? `Codex détecté : ${path}` : "Codex n’a pas été détecté.");
      testButton.setDisabled(!path);
      if (!path) installation.addButton(button => button.setButtonText("Rechercher Codex").onClick(async () => {
        button.setDisabled(true);
        codexStatus.setText("Recherche de Codex…");
        let found: string;
        try { found = await findCodex("", true); }
        catch {
          showCodex(null, true);
          codexStatus.setText("Codex introuvable. Indiquez le chemin de son exécutable.");
          return;
        }
        try {
          await this.plugin.saveSettings({ codexPath: found });
          showCodex(found);
          codexStatus.setText("");
        } catch (error) { codexStatus.setText(errorText(error)); button.setDisabled(false); }
      }));
      if (manual) new Setting(installationEl).setName("Chemin de Codex")
        .setDesc("Chemin absolu de l’exécutable Codex.")
        .addText(text => {
          let saving = Promise.resolve();
          text.setPlaceholder("/chemin/vers/codex").setValue(this.plugin.settings.codexPath)
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
    void findCodex(this.plugin.settings.codexPath).then(path => showCodex(path)).catch(() => showCodex(null));

    new Setting(containerEl).setName("Dossier de travail").setHeading();
    let selectedFolder!: HTMLInputElement;
    const folderSetting = new Setting(containerEl).setName("Dossier sélectionné")
      .addText(text => {
        text.setValue(this.plugin.settings.folder || "Racine du coffre");
        selectedFolder = text.inputEl;
        selectedFolder.readOnly = true;
        selectedFolder.setAttribute("aria-label", "Dossier de travail sélectionné");
      });
    folderSetting.addButton(button => button.setButtonText("Parcourir…").onClick(() => {
      if (this.plugin.session.busy) {
        folderStatus.setText("Arrêtez la tâche Codex avant de changer de dossier.");
        return;
      }
      new FolderPicker(this.plugin, folder => {
        button.setDisabled(true);
        void this.plugin.saveSettings({ folder }).then(async () => {
          selectedFolder.value = this.plugin.settings.folder || "Racine du coffre";
          folderStatus.setText(`Dossier sélectionné : ${selectedFolder.value}`);
          if (this.plugin.settings.threadId && this.app.workspace.getLeavesOfType(VIEW_TYPE).length) {
            await this.plugin.connect();
          }
        }).catch(error => folderStatus.setText(errorText(error)))
          .finally(() => button.setDisabled(false));
      }).open();
    }));
    containerEl.createEl("p", { cls: "setting-item-description",
      text: "Chaque dossier conserve sa conversation Codex. Les réglages sont enregistrés automatiquement." });
    const folderStatus = containerEl.createEl("p", { attr: { role: "status" } });

    new Setting(containerEl).setName("Organisation du projet").setHeading();
    const labels = { archiveFolder: "Dossier des archives", manuscriptFolder: "Dossier du manuscrit", bibleFolder: "Dossier de la bible" };
    const layoutStatus = containerEl.createEl("p", { attr: { role: "status" } });
    for (const key of PROJECT_FOLDER_KEYS) {
      new Setting(containerEl).setName(labels[key]).setDesc(`Par défaut : ${DEFAULT_PROJECT_FOLDERS[key]}.`)
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
              await this.plugin.prepareProject();
              layoutStatus.setText("");
            } catch (error) { layoutStatus.setText(errorText(error)); }
          };
        });
    }
    containerEl.createEl("p", { cls: "setting-item-description",
      text: "Le manuscrit contient Chapitres, Personnages, Plan et Resume. Les archives reproduisent les chemins du manuscrit et de la bible. Les dossiers existants sont conservés." });
  }
}
