import { App, PluginSettingTab, Setting } from "obsidian";
import type LocalTranscriberPlugin from "./main";
import { t } from "./i18n";

/** Standard-Datenordner von Local Transcriber (Pfad, kein UI-Text). */
export const DEFAULT_SOURCE = "~/Transcriber";
/** Standard-Ordner für die Notizen: gleich in allen Sprachen, erkennbar als Ordner der App (Björn, 2026-10-17). */
export const DEFAULT_NOTES = "Transcriber";

export interface Settings {
	/** Ordner außerhalb der Vault, in dem Transcriber Aufnahmen und Transkripte ablegt (rekursiv). */
	sourceFolder: string;
	/** Vault-Ordner für die Notizen. */
	notesFolder: string;
	/** Optionaler Vault-Ordner mit Personen-Notizen – Namensvorschläge beim Benennen. */
	peopleFolder: string;
	/** Pfad zur Transcriber-Kommandozeile. */
	command: string;
	autoSync: boolean;
	/** Darstellungsversion der zuletzt geschriebenen Notizen (transcript.ts RENDER_VERSION). Intern. */
	renderVersion: number;
	/** Abgleich-Stand je Transkript (job_id → Pfad, Änderungszeit, Notiz). Intern. */
	synced: Record<string, { json: string; mtime: number; note: string; hash?: string; name?: string; people?: string[] }>;
}

export const defaults = (): Settings => ({
	sourceFolder: DEFAULT_SOURCE,
	notesFolder: DEFAULT_NOTES,
	peopleFolder: "",
	command: "~/.local/bin/transcriber",
	autoSync: true,
	renderVersion: 0,
	synced: {},
});

export class LocalTranscriberSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: LocalTranscriberPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = async () => this.plugin.saveSettings();

		new Setting(containerEl)
			.setName(t("Transkript-Ordner", "Transcript folder"))
			.setDesc(t("Wo Local Transcriber Aufnahmen und Transkripte ablegt (mit Unterordnern). Liegt außerhalb der Vault.",
				"Where Local Transcriber stores recordings and transcripts (including subfolders). Outside the vault."))
			.addText((x) => x.setPlaceholder(DEFAULT_SOURCE).setValue(s.sourceFolder)
				.onChange(async (v) => { s.sourceFolder = v.trim() || DEFAULT_SOURCE; await save(); }));
		new Setting(containerEl)
			.setName(t("Ordner für Notizen", "Notes folder"))
			.setDesc(t("Vault-Ordner, in dem je Transkript eine Notiz entsteht.", "Vault folder where a note is created for each transcript."))
			.addText((x) => x.setValue(s.notesFolder)
				.onChange(async (v) => { s.notesFolder = v.trim() || DEFAULT_NOTES; await save(); }));
		new Setting(containerEl)
			.setName(t("Ordner mit Personen", "People folder"))
			.setDesc(t("Optional: Namen der Notizen dort werden beim Benennen von Sprechern vorgeschlagen.",
				"Optional: note names from this folder are suggested when naming speakers."))
			.addText((x) => x.setPlaceholder("People").setValue(s.peopleFolder)
				.onChange(async (v) => { s.peopleFolder = v.trim(); await save(); }));
		new Setting(containerEl)
			.setName(t("Automatisch abgleichen", "Sync automatically"))
			.setDesc(t("Beim Start und sobald sich im Transkript-Ordner etwas ändert.", "On startup and whenever the transcript folder changes."))
			.addToggle((x) => x.setValue(s.autoSync)
				.onChange(async (v) => { s.autoSync = v; await save(); this.plugin.restartWatcher(); }));

		new Setting(containerEl).setName(t("Erweitert", "Advanced")).setHeading();
		new Setting(containerEl)
			.setName(t("Transcriber-Befehl", "Transcriber command"))
			.setDesc(t("Pfad zur Kommandozeile, die der Installer anlegt.", "Path to the command line tool the installer sets up."))
			.addText((x) => x.setPlaceholder("~/.local/bin/transcriber").setValue(s.command)
				.onChange(async (v) => { s.command = v.trim() || "~/.local/bin/transcriber"; await save(); }));
	}
}
