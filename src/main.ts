import { debounce, Menu, Notice, Plugin, TAbstractFile, TFile } from "obsidian";
import { watch, FSWatcher } from "fs";
import { expand, runTranscriber, TranscriberMissing } from "./cli";
import { de, t } from "./i18n";
import { NameModal, SpeakerModal, TemplateModal, type Template } from "./modals";
import { defaults, LocalTranscriberSettingTab, Settings } from "./settings";
import { readDoc, Syncer } from "./sync";
import type { Speaker } from "./transcript";

const AUDIO = new Set(["m4a", "mp3", "wav", "aac", "caf", "aiff", "flac", "ogg", "opus", "webm", "mp4", "mov"]);

export default class LocalTranscriberPlugin extends Plugin {
	settings: Settings = defaults();
	private syncer!: Syncer;
	private watcher: FSWatcher | null = null;
	private statusEl!: HTMLElement;

	async onload(): Promise<void> {
		this.settings = Object.assign(defaults(), (await this.loadData()) as Partial<Settings> | null);
		this.syncer = new Syncer(this.app, () => this.settings, () => this.saveSettings());
		this.statusEl = this.addStatusBarItem();
		this.addSettingTab(new LocalTranscriberSettingTab(this.app, this));

		this.addRibbonIcon("audio-lines", t("Transkripte abgleichen", "Sync transcripts"), () => void this.syncNow(true));
		this.addCommand({ id: "sync", name: t("Transkripte abgleichen", "Sync transcripts"), callback: () => void this.syncNow(true) });
		this.addCommand({
			id: "name-speaker",
			name: t("Sprecher benennen", "Name a speaker"),
			checkCallback: (checking) => {
				const json = this.activeTranscript();
				if (!json) return false;
				if (!checking) void this.nameSpeaker(json);
				return true;
			},
		});
		this.addCommand({
			id: "confirm-speakers",
			name: t("Alle Zuordnungen bestätigen", "Confirm all speaker matches"),
			checkCallback: (checking) => {
				const json = this.activeTranscript();
				if (!json) return false;
				if (!checking) void this.cli(["confirm", json], json, t("Zuordnungen bestätigt", "Matches confirmed"));
				return true;
			},
		});
		this.addCommand({
			id: "summarize",
			name: t("Zusammenfassen (Vorlage wählen)", "Summarize (choose template)"),
			checkCallback: (checking) => {
				const json = this.activeTranscript();
				if (!json) return false;
				if (!checking) void this.summarize(json);
				return true;
			},
		});
		this.addCommand({
			id: "rewrite-transcript",
			name: t("Transkript neu schreiben (Änderungen im Transkript verwerfen)", "Rewrite transcript (discard changes to the transcript)"),
			checkCallback: (checking) => {
				const json = this.activeTranscript();
				if (!json) return false;
				if (!checking) void this.rewrite(json);
				return true;
			},
		});
		this.addCommand({
			id: "transcribe-file",
			name: t("Audiodatei transkribieren", "Transcribe audio file"),
			checkCallback: (checking) => {
				const f = this.app.workspace.getActiveFile();
				if (!f || !AUDIO.has(f.extension.toLowerCase())) return false;
				if (!checking) void this.transcribe(f);
				return true;
			},
		});
		this.registerEvent(this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
			if (file instanceof TFile && AUDIO.has(file.extension.toLowerCase())) {
				menu.addItem((i) => i.setTitle(t("Transkribieren", "Transcribe")).setIcon("audio-lines").onClick(() => void this.transcribe(file)));
			}
		}));

		this.app.workspace.onLayoutReady(() => {
			if (this.settings.autoSync) void this.syncNow(false);
			this.restartWatcher();
		});
	}

	onunload(): void {
		this.watcher?.close();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Ordner beobachten (macOS: rekursiv). Änderungen kommen gebündelt – Transcriber schreibt mehrere Dateien. */
	restartWatcher(): void {
		this.watcher?.close();
		this.watcher = null;
		if (!this.settings.autoSync) return;
		const later = debounce(() => void this.syncNow(false), 4000, true);
		try {
			this.watcher = watch(expand(this.settings.sourceFolder), { recursive: true }, (_e, name) => {
				if (name && /\.(transcript\.json|summary\.md)$/.test(String(name))) later();
			});
		} catch (e) {
			console.error("Local Transcriber: folder not watchable", e);
		}
	}

	private async syncNow(loud: boolean): Promise<void> {
		this.statusEl.setText(t("Transkripte: Abgleich …", "Transcripts: syncing …"));
		try {
			const { changed: n, edited } = await this.syncer.syncAll();
			if (loud || n) new Notice(n ? t(`${n} Transkript-Notiz(en) aktualisiert`, `${n} transcript note(s) updated`)
				: t("Transkripte sind aktuell", "Transcripts are up to date"));
			for (const note of edited) this.editedNotice(note);
		} finally {
			this.statusEl.setText("");
		}
	}

	/** Transkript (JSON) der aktiven Notiz aus der Eigenschaft „transcript“. */
	private activeTranscript(): string | null {
		const f = this.app.workspace.getActiveFile();
		const v: unknown = f ? this.app.metadataCache.getFileCache(f)?.frontmatter?.["transcript"] : null;
		return typeof v === "string" && v.endsWith(".transcript.json") ? v : null;
	}

	private async nameSpeaker(json: string): Promise<void> {
		const doc = await readDoc(json);
		new SpeakerModal(this.app, doc.speakers, (sp: Speaker) => {
			new NameModal(this.app, sp, this.nameSuggestions(doc.event?.attendees?.map((a) => a.name) ?? []), (name) => {
				void this.cli(["name", json, sp.letter, name], json, t(`${sp.letter} heißt jetzt ${name}`, `${sp.letter} is now ${name}`));
			}).open();
		}).open();
	}

	/** Termin-Teilnehmer zuerst, dann Notizen im Personen-Ordner. */
	private nameSuggestions(attendees: string[]): string[] {
		const out = new Set(attendees.filter(Boolean));
		const folder = this.settings.peopleFolder && this.app.vault.getFolderByPath(this.settings.peopleFolder);
		if (folder) for (const f of this.app.vault.getMarkdownFiles()) if (f.path.startsWith(folder.path + "/")) out.add(f.basename);
		return [...out];
	}

	private editedNotice(note: string): void {
		new Notice(t(`Das Transkript in „${note}“ wurde von Hand geändert und deshalb nicht überschrieben. Neue Fassung: Befehl „Transkript neu schreiben“.`,
			`The transcript in “${note}” was edited by hand and was not overwritten. New version: command “Rewrite transcript”.`), 12000);
	}

	private async rewrite(json: string): Promise<void> {
		const [r] = await this.syncer.syncOne(json, { discard: true });
		await this.saveSettings();
		new Notice(r === "updated" ? t("Transkript neu geschrieben", "Transcript rewritten") : t("Transkript ist aktuell", "Transcript is up to date"));
	}

	private async cli(args: string[], json: string, done: string): Promise<void> {
		try {
			await runTranscriber(this.settings.command, args, de() ? "de" : "en");
			const [r, note] = await this.syncer.syncOne(json);
			await this.saveSettings();
			new Notice(done);
			if (r === "edited") this.editedNotice(note);
		} catch (e) {
			this.fail(e);
		}
	}

	/** Vorlage wählen → `transcriber summarize` mit dem Modell aus Local Transcriber (Einstellungen › KI). */
	private async summarize(json: string): Promise<void> {
		let templates: Template[];
		try {
			templates = JSON.parse(await runTranscriber(this.settings.command, ["summarize", "--templates", "--json"], de() ? "de" : "en")) as Template[];
		} catch (e) {
			this.fail(e);
			return;
		}
		new TemplateModal(this.app, templates, (tpl) => void (async () => {
			const notice = new Notice(t(`${tpl.name} wird erstellt …`, `Creating ${tpl.name} …`), 0);
			try {
				await runTranscriber(this.settings.command, ["summarize", json, "--template", tpl.id], de() ? "de" : "en");
				const [r, note] = await this.syncer.syncOne(json);
				await this.saveSettings();
				new Notice(t(`${tpl.name} ist in „${note}“`, `${tpl.name} is in “${note}”`));
				if (r === "edited") this.editedNotice(note);
			} catch (e) {
				this.fail(e);
			} finally {
				notice.hide();
			}
		})()).open();
	}

	private async transcribe(file: TFile): Promise<void> {
		const abs = this.syncer.absolute(file);
		if (!abs) return;
		const notice = new Notice(t(`Transkribiere „${file.name}“ …`, `Transcribing “${file.name}” …`), 0);
		try {
			await runTranscriber(this.settings.command, ["transcribe", abs], de() ? "de" : "en");
			const json = abs.replace(/\.[^.]+$/, ".transcript.json");
			await this.syncer.syncOne(json, { recreate: true });
			await this.saveSettings();
			new Notice(t(`„${file.basename}“ ist transkribiert`, `“${file.basename}” is transcribed`));
		} catch (e) {
			this.fail(e);
		} finally {
			notice.hide();
		}
	}

	private fail(e: unknown): void {
		if (e instanceof TranscriberMissing) {
			new Notice(t(`Local Transcriber nicht gefunden (${e.message}). Installation: transcriber.teconomix.net`,
				`Local Transcriber not found (${e.message}). Install: transcriber.teconomix.net`), 10000);
		} else {
			new Notice(t("Local Transcriber: ", "Local Transcriber: ") + (e instanceof Error ? e.message : String(e)), 10000);
		}
	}
}
