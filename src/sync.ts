// Abgleich: <name>.transcript.json (außerhalb oder innerhalb der Vault) → je eine Notiz im Notizen-Ordner.
// Zuordnung über die job_id des Kerns (Eigenschaft „transcriber-id“), damit umbenannte Aufnahmen dieselbe Notiz behalten.
//
// Was der Nutzer in der Notiz tut, hat Vorrang (README „Your edits“):
// - Text außerhalb des erzeugten Abschnitts wird nie angefasst.
// - Ist der Abschnitt von Hand geändert (Fingerabdruck weicht ab) oder sind die Markierungen entfernt, bleibt er stehen;
//   nur der Befehl „Transkript neu schreiben“ verwirft Änderungen.
// - Eigenschaften werden beim Anlegen gesetzt; danach kommen nur neue Teilnehmer dazu (und der technische Pfad).
// - Umbenannt wird die Notiz nur, wenn die Aufnahme umbenannt wurde; verschobene/umbenannte Notizen werden gefunden.
// - Gelöschte Notizen werden nicht wieder angelegt (außer beim Befehl „Transkribieren“).
import { App, FileSystemAdapter, MarkdownView, normalizePath, TFile } from "obsidian";
import { promises as fs } from "fs";
import * as path from "path";
import { expand } from "./cli";
import { status, t } from "./i18n";
import type { Settings } from "./settings";
import {
	decide, fingerprint, knownNames, mergeParticipants, noteName, recordingDate, RENDER_VERSION, renderBlock, TranscriptDoc,
} from "./transcript";

const ID = "transcriber-id";
const SKIP_DIRS = new Set(["cache", "node_modules"]);

export interface SyncOptions {
	/** Gelöschte Notiz wieder anlegen (Befehl „Transkribieren“). */
	recreate?: boolean;
	/** Von Hand geänderten Abschnitt überschreiben (Befehl „Transkript neu schreiben“). */
	discard?: boolean;
	/** Auch ohne Änderung am Transkript neu schreiben (neues Aussehen nach Plugin-Update). */
	rerender?: boolean;
}

export type SyncResult = "created" | "updated" | "unchanged" | "edited" | "no-markers" | "skipped";

export async function findTranscripts(root: string): Promise<string[]> {
	const out: string[] = [];
	const walk = async (dir: string, depth: number) => {
		if (depth > 6) return;
		let entries;
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (e.name.startsWith(".")) continue;
			const p = path.join(dir, e.name);
			if (e.isDirectory() && !SKIP_DIRS.has(e.name)) await walk(p, depth + 1);
			else if (e.isFile() && e.name.endsWith(".transcript.json")) out.push(p);
		}
	};
	await walk(root, 0);
	return out;
}

export async function readDoc(json: string): Promise<TranscriptDoc> {
	return JSON.parse(await fs.readFile(json, "utf8")) as TranscriptDoc;
}

export class Syncer {
	private running: Promise<{ changed: number; edited: string[] }> | null = null;

	constructor(private app: App, private settings: () => Settings, private save: () => Promise<void>) {}

	private vaultBase(): string | null {
		const a = this.app.vault.adapter;
		return a instanceof FileSystemAdapter ? a.getBasePath() : null;
	}

	/** Alle Transkripte abgleichen; gleichzeitige Aufrufe teilen sich einen Lauf. Liefert die Zahl geschriebener Notizen
	 *  und die Notizen, deren Transkript neu wäre, aber von Hand geändert ist. */
	syncAll(): Promise<{ changed: number; edited: string[] }> {
		this.running ??= this.doSyncAll().finally(() => { this.running = null; });
		return this.running;
	}

	private async doSyncAll(): Promise<{ changed: number; edited: string[] }> {
		const s = this.settings();
		const found = new Set(await findTranscripts(expand(s.sourceFolder)));
		const base = this.vaultBase();                                  // per Befehl transkribiertes Audio in der Vault
		if (base) for (const j of await findTranscripts(base)) found.add(j);
		for (const v of Object.values(s.synced)) found.add(v.json);
		let changed = 0;
		const edited: string[] = [];
		const rerender = s.renderVersion !== RENDER_VERSION;          // neues Aussehen nach Plugin-Update: alle neu schreiben
		for (const json of found) {
			try {
				const [r, note] = await this.syncOne(json, { rerender });
				if (r === "created" || r === "updated") changed++;
				if (r === "edited" && !rerender) edited.push(note);
			} catch (e) {
				console.error("Local Transcriber:", json, e);
			}
		}
		if (rerender) s.renderVersion = RENDER_VERSION;
		await this.save();
		return { changed, edited };
	}

	/** Ein Transkript abgleichen. Liefert das Ergebnis und den Namen der Notiz. */
	async syncOne(json: string, opt: SyncOptions = {}): Promise<[SyncResult, string]> {
		let stat;
		try {
			stat = await fs.stat(json);
		} catch {
			return ["skipped", ""];                       // Transkript gelöscht oder verschoben: Notiz bleibt, wie sie ist
		}
		const s = this.settings();
		const doc = await readDoc(json);
		if (!doc.job_id || !Array.isArray(doc.words)) return ["skipped", ""];
		const prev = s.synced[doc.job_id];
		let file = this.noteFor(doc.job_id, prev?.note);
		const transcriptChanged = !prev || prev.mtime !== stat.mtimeMs || prev.json !== json;
		if (file && !transcriptChanged && !opt.rerender && !opt.discard) return ["unchanged", file.basename];
		if (!file && prev && !opt.recreate) return ["skipped", ""];       // Notiz gelöscht: nicht wieder anlegen

		const name = noteName(doc);
		const block = renderBlock(doc, this.audioLink(doc.source), {
			unclear: t("Unklar", "Unclear"), speakers: t("Sprecher", "Speakers"), minutes: "min", status,
			openAudio: t("Audio öffnen", "Open audio"),
			generated: t("Dieser Abschnitt wird von Local Transcriber aktualisiert. Eigene Notizen gehören darüber oder darunter.",
				"This section is updated by Local Transcriber. Put your own notes above or below it."),
		});
		const people = knownNames(doc).map((n) => `[[${n}]]`);
		let result: SyncResult;

		if (!file) {
			const folder = normalizePath(s.notesFolder);
			await this.ensureFolder(folder);
			file = await this.app.vault.create(this.free(normalizePath(`${folder}/${name}.md`)), block + "\n");
			await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				fm[ID] = doc.job_id;
				const date = recordingDate(doc);
				if (date) fm["date"] = date;
				fm["duration"] = Math.max(1, Math.round(doc.duration / 60));
				if (people.length) fm["participants"] = people;
				if (doc.event?.title) fm["event"] = doc.event.title;
				fm["transcript"] = json;
				fm["tags"] = ["transcript"];
			});
			result = "created";
			s.synced[doc.job_id] = { json, mtime: stat.mtimeMs, note: file.path, hash: fingerprint(block), name, people };
			return [result, file.basename];
		}

		// Aufnahme umbenannt (Name anders als beim letzten Schreiben) → Notiz mitziehen, sofern der Name frei ist.
		// Eine vom Nutzer umbenannte Notiz behält ihren Namen.
		if (prev?.name && prev.name !== name) {
			const target = normalizePath(`${file.parent?.path ?? ""}/${name}.md`);
			if (file.path !== target && !this.app.vault.getAbstractFileByPath(target)) await this.app.fileManager.renameFile(file, target);
		}

		result = await this.writeBlock(file, block, prev?.hash, !!opt.discard);
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			fm[ID] = doc.job_id;
			fm["transcript"] = json;                                    // technischer Pfad (ändert sich beim Umbenennen)
			const merged = mergeParticipants(fm["participants"], people, prev?.people ?? []);
			if (merged) {
				if (merged.length) fm["participants"] = merged; else delete fm["participants"];
			}
		});
		const hash = result === "updated" || result === "unchanged" ? fingerprint(block) : prev?.hash;
		s.synced[doc.job_id] = { json, mtime: stat.mtimeMs, note: file.path, hash, name, people };
		return [result, file.basename];
	}

	/** Abschnitt schreiben – in einer geöffneten Notiz über den Editor (Cursor/Eingaben bleiben), sonst atomar per
	 *  Vault.process. Entscheidung in transcript.ts `decide`. */
	private async writeBlock(file: TFile, block: string, lastHash: string | undefined, discard: boolean): Promise<SyncResult> {
		const view = this.openView(file);
		if (view) {
			const ed = view.editor;
			const d = decide(ed.getValue(), block, lastHash, discard);
			if (d.kind !== "write") return d.kind;
			ed.replaceRange(d.insert, ed.offsetToPos(d.from), ed.offsetToPos(d.to));
			return "updated";
		}
		let r: SyncResult = "unchanged";
		await this.app.vault.process(file, (data) => {
			const d = decide(data, block, lastHash, discard);
			r = d.kind === "write" ? "updated" : d.kind;
			return d.kind === "write" ? d.content : data;
		});
		return r;
	}

	private openView(file: TFile): MarkdownView | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (leaf.view instanceof MarkdownView && leaf.view.file === file && leaf.view.getMode() === "source") return leaf.view;
		}
		return null;
	}

	/** Notiz zu einer job_id: zuerst der gemerkte Pfad, sonst Suche über die Eigenschaft in der ganzen Vault
	 *  (verschobene oder umbenannte Notizen). */
	private noteFor(id: string, remembered?: string): TFile | null {
		const ours = (f: TFile) => this.app.metadataCache.getFileCache(f)?.frontmatter?.[ID] === id;
		if (remembered) {
			const f = this.app.vault.getFileByPath(remembered);
			if (f && ours(f)) return f;
		}
		return this.app.vault.getMarkdownFiles().find(ours) ?? null;
	}

	/** Audio in der Vault → einbetten (abspielbar); außerhalb → Link, der die Datei im Standardprogramm öffnet. */
	private audioLink(source: string): string {
		const base = this.vaultBase();
		if (base && source.startsWith(base + path.sep)) {
			return `![[${source.slice(base.length + 1)}]]`;
		}
		return `[${t("Audio öffnen", "Open audio")}](<file://${encodeURI(source)}>)`;
	}

	private free(p: string): string {
		if (!this.app.vault.getAbstractFileByPath(p)) return p;
		const stem = p.replace(/\.md$/, "");
		for (let i = 2; ; i++) if (!this.app.vault.getAbstractFileByPath(`${stem} ${i}.md`)) return `${stem} ${i}.md`;
	}

	private async ensureFolder(folder: string): Promise<void> {
		if (!this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder);
	}

	/** Absoluter Pfad einer Vault-Datei (für die Kommandozeile). */
	absolute(file: TFile): string | null {
		const base = this.vaultBase();
		return base ? path.join(base, file.path) : null;
	}
}
