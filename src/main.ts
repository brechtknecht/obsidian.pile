import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { PileView, VIEW_TYPE_PILE } from "./view";

interface PileSettings {
  pileFolder: string;
  pileName: string;
}

const DEFAULT_SETTINGS: PileSettings = {
  pileFolder: "Pile",
  pileName: "Journal",
};

export default class PilePlugin extends Plugin {
  settings!: PileSettings;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_PILE, (leaf) => new PileView(leaf, this));

    this.addRibbonIcon("layers", "Open Pile", () => this.activateView());
    this.addCommand({
      id: "open-pile",
      name: "Open Pile",
      callback: () => this.activateView(),
    });
    this.addSettingTab(new PileSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateView() {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_PILE);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_PILE, active: true });
    workspace.revealLeaf(leaf);
  }
}

class PileSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: PilePlugin) {
    super(app, plugin);
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Pile folder")
      .setDesc("Vault folder that stores this pile's entries.")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.pileFolder)
          .onChange(async (v) => {
            this.plugin.settings.pileFolder = v.trim() || "Pile";
            await this.plugin.saveSettings();
          })
      );
    new Setting(containerEl)
      .setName("Pile name")
      .setDesc("Display name for the pile. Reopen the view after changing.")
      .addText((t) =>
        t.setValue(this.plugin.settings.pileName).onChange(async (v) => {
          this.plugin.settings.pileName = v.trim() || "Journal";
          await this.plugin.saveSettings();
        })
      );
  }
}
