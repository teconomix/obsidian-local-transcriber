import { AbstractInputSuggest, App, Modal, Setting, SuggestModal } from "obsidian";
import { status, t } from "./i18n";
import { mmss, type Speaker } from "./transcript";

/** Sprecher auswählen (Buchstabe, Anzeigename, Zuordnung). */
export class SpeakerModal extends SuggestModal<Speaker> {
	constructor(app: App, private speakers: Speaker[], private onPick: (s: Speaker) => void) {
		super(app);
		this.setPlaceholder(t("Welcher Sprecher?", "Which speaker?"));
	}

	getSuggestions(query: string): Speaker[] {
		const q = query.toLowerCase();
		return this.speakers.filter((s) => `${s.letter} ${s.display}`.toLowerCase().includes(q));
	}

	renderSuggestion(s: Speaker, el: HTMLElement): void {
		el.createDiv({ text: `${s.letter} · ${s.display}` });
		el.createEl("small", { text: `${mmss(s.speech_s)} min · ${status(s.status)}`, cls: "local-transcriber-muted" });
	}

	onChooseSuggestion(s: Speaker): void {
		this.onPick(s);
	}
}

class NameSuggest extends AbstractInputSuggest<string> {
	constructor(app: App, private input: HTMLInputElement, private names: string[]) {
		super(app, input);
	}

	protected getSuggestions(query: string): string[] {
		const q = query.toLowerCase();
		return this.names.filter((n) => n.toLowerCase().includes(q)).slice(0, 8);
	}

	renderSuggestion(name: string, el: HTMLElement): void {
		el.setText(name);
	}

	selectSuggestion(name: string): void {
		this.input.value = name;
		this.input.dispatchEvent(new Event("input"));
		this.close();
	}
}

/** Namen eingeben, mit Vorschlägen (Termin-Teilnehmer, Personen-Notizen). */
export class NameModal extends Modal {
	private value = "";

	constructor(app: App, private speaker: Speaker, private suggestions: string[], private onSubmit: (name: string) => void) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle(t(`Sprecher ${this.speaker.letter} benennen`, `Name speaker ${this.speaker.letter}`));
		const submit = () => {
			const name = this.value.trim();
			if (!name) return;
			this.close();
			this.onSubmit(name);
		};
		new Setting(contentEl).setName(t("Name", "Name")).addText((x) => {
			x.setPlaceholder(this.speaker.name ?? "").onChange((v) => { this.value = v; });
			new NameSuggest(this.app, x.inputEl, this.suggestions);
			window.setTimeout(() => x.inputEl.focus(), 0);
		});
		new Setting(contentEl).addButton((b) => b.setButtonText(t("Benennen", "Name")).setCta().onClick(submit));
		// Eingabetaste über Obsidians Tastenbereich des Fensters: verbraucht den Tastendruck vollständig. Ein eigener
		// keydown-Handler schloss das Fenster, und das Zeichen landete danach als Leerzeile im Editor dahinter (vor der
		// Eigenschaften-Zeile „---“, die dann nicht mehr erkannt wurde). Vorschläge haben ihren eigenen Bereich darüber.
		this.scope.register([], "Enter", (e) => {
			e.preventDefault();
			submit();
			return false;
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export interface Template { id: string; name: string; description: string; custom: boolean }

/** Vorlage für die Zusammenfassung wählen (aus `transcriber summarize --templates --json`). */
export class TemplateModal extends SuggestModal<Template> {
	constructor(app: App, private templates: Template[], private onPick: (t: Template) => void) {
		super(app);
		this.setPlaceholder(t("Welche Vorlage?", "Which template?"));
	}

	getSuggestions(query: string): Template[] {
		const q = query.toLowerCase();
		return this.templates.filter((x) => `${x.name} ${x.description}`.toLowerCase().includes(q));
	}

	renderSuggestion(x: Template, el: HTMLElement): void {
		el.createDiv({ text: x.name });
		el.createEl("small", { text: x.description, cls: "local-transcriber-muted" });
	}

	onChooseSuggestion(x: Template): void {
		this.onPick(x);
	}
}
