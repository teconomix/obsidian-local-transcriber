// Transkript (<name>.transcript.json des Transcriber-Kerns) → Inhalt einer Obsidian-Notiz. Reine Funktionen ohne
// Obsidian-API, damit sie sich mit Node testen lassen (test/run.mjs).

export interface Word { w: string; start: number; end: number; speaker?: string }
export interface Speaker {
	label: string; letter: string; display: string; name?: string | null; status: string; speech_s: number; score?: number | null;
}
export interface Attendee { name: string; me?: boolean; status?: string; type?: string }
export interface TranscriptDoc {
	job_id: string; source: string; duration: number; created: string; model: string; tracks: number;
	speakers: Speaker[]; words: Word[]; overlaps?: [number, number][];
	event?: { title?: string; attendees?: Attendee[] } | null;
}
export interface Turn { who: string; start: number; end: number; text: string }

export const START = "%% local-transcriber:start %%";
export const END = "%% local-transcriber:end %%";
/** Eigener Abschnitt für die Zusammenfassung (<name>.summary.md des Kerns), über dem Transkript. Getrennt geschützt:
 *  Wer dort Aufgaben abhakt, hält damit nicht auch das Transkript an. */
export const SUM_START = "%% local-transcriber:summary:start %%";
export const SUM_END = "%% local-transcriber:summary:end %%";
export interface Markers { start: string; end: string }
const TRANSCRIPT: Markers = { start: START, end: END };
export const SUMMARY: Markers = { start: SUM_START, end: SUM_END };
/** Darstellungsversion: ändert sich das Aussehen der Notizen, schreibt der nächste Abgleich alle neu. */
export const RENDER_VERSION = 2;

/** Redebeiträge wie transcriber/render.py `_turns`: aufeinanderfolgende Wörter derselben Person (Lücke < 5 s) bilden
 *  einen Beitrag; in Bereichen gleichzeitigen Sprechens (overlaps) je Person ein zusammenhängender Beitrag. */
export function turns(doc: TranscriptDoc, unclear: string): Turn[] {
	const names = new Map(doc.speakers.map((c) => [c.label, c.display] as const));
	const regions = doc.overlaps ?? [];
	const region = (w: Word): number | null => {
		const mid = (w.start + w.end) / 2;
		const i = regions.findIndex(([s, e]) => s <= mid && mid < e);
		return i < 0 ? null : i;
	};
	const out: Turn[] = [];
	const current = new Map<string, Turn>();
	for (const w of doc.words) {
		const who = (w.speaker !== undefined ? names.get(w.speaker) : undefined) ?? unclear;
		const r = region(w);
		const key = `${who}\u0000${r}`;
		const open = r !== null ? current.get(key) : undefined;
		if (open) {
			open.text += " " + w.w; open.end = w.end;
			continue;
		}
		const last = out[out.length - 1];
		if (last && last.who === who && w.start - last.end < 5) {
			last.text += " " + w.w; last.end = w.end;
		} else {
			out.push({ who, start: w.start, end: w.end, text: w.w });
		}
		if (r !== null) current.set(key, out[out.length - 1]!);
	}
	return out;
}

export function ts(x: number): string {
	const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), s = Math.floor(x % 60);
	return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export function mmss(x: number): string {
	return `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`;
}

/** Sicher zugeordnete Personen (für Links und Eigenschaften); „vermutlich“ und unbekannte bleiben außen vor. */
export function knownNames(doc: TranscriptDoc): string[] {
	return doc.speakers
		.filter((c) => c.name && (c.status === "sicher" || c.status === "bestätigt"))
		.sort((a, b) => b.speech_s - a.speech_s)
		.map((c) => c.name as string);
}

/** Datum der Aufnahme: aus dem Dateinamen („2026-10-14 16-00 …“), sonst aus dem Erstellzeitpunkt des Transkripts. */
export function recordingDate(doc: TranscriptDoc): string | null {
	const base = doc.source.split("/").pop() ?? "";
	const m = /(\d{4}-\d{2}-\d{2})/.exec(base) ?? /(\d{4}-\d{2}-\d{2})/.exec(doc.created ?? "");
	return m ? m[1]! : null;
}

export interface Labels {
	unclear: string; speakers: string; minutes: string; openAudio: string; generated: string;
	status: (code: string) => string;
}

/** Der automatisch erzeugte Abschnitt der Notiz (zwischen START und END). audioLink: Markdown für die Audiodatei
 *  (Einbettung bei Audio in der Vault, sonst Link). */
export function renderBlock(doc: TranscriptDoc, audioLink: string, L: Labels): string {
	const known = new Set(knownNames(doc));
	const who = doc.speakers
		.slice()
		.sort((a, b) => b.speech_s - a.speech_s)
		.map((c) => {
			const label = c.name && known.has(c.name) ? `[[${c.name}]]` : c.display;
			const extra = c.name && known.has(c.name) ? "" : `, ${L.status(c.status)}`;
			return `${label} (${mmss(c.speech_s)} ${L.minutes}${extra})`;
		})
		.join(" · ");
	const lines = [START, `> ${L.generated}`, "", `**${L.speakers}:** ${who}`, "", audioLink, ""];
	for (const u of turns(doc, L.unclear)) lines.push(`**[${ts(u.start)}] ${u.who}:** ${u.text}`, "");
	lines.push(END);
	return lines.join("\n");
}

/** Lage des erzeugten Abschnitts (Start- bis Ende-Markierung, einschließlich) oder null, wenn eine Markierung fehlt. */
export function findBlock(content: string, m: Markers = TRANSCRIPT): { from: number; to: number; text: string } | null {
	const s = content.indexOf(m.start);
	if (s < 0) return null;
	const e = content.indexOf(m.end, s + m.start.length);
	if (e < 0) return null;
	return { from: s, to: e + m.end.length, text: content.slice(s, e + m.end.length) };
}

/** Zusammenfassung (Inhalt von <name>.summary.md) → Abschnitt der Notiz. Die erste Zeile der Datei ist die
 *  Kennzeichenzeile des Kerns (JSON im HTML-Kommentar) – daraus Name der Vorlage und lokal/Cloud. null = keine. */
export function renderSummary(file: string, L: { summary: string; local: string; cloud: string }): string | null {
	const nl = file.indexOf("\n");
	const first = nl < 0 ? file : file.slice(0, nl);
	const mark = "<!-- transcriber-summary ";
	if (!first.startsWith(mark)) return null;
	let meta: { name?: string; local?: boolean; model?: string } = {};
	try {
		meta = JSON.parse(first.slice(mark.length, first.lastIndexOf("-->"))) as typeof meta;
	} catch {
		return null;
	}
	const body = (nl < 0 ? "" : file.slice(nl + 1)).trim();
	const head = `**${L.summary}${meta.name ? ` · ${meta.name}` : ""}** (${meta.local === false ? L.cloud : L.local}${meta.model ? ` · ${meta.model}` : ""})`;
	return [SUM_START, head, "", body, SUM_END].join("\n");
}

/** Wo der Zusammenfassungs-Abschnitt hinkommt. Vorhanden → wie decide. Fehlt er: einfügen vor dem Transkript-
 *  Abschnitt – außer das Plugin hatte schon einmal einen geschrieben (lastHash gesetzt), dann hat der Nutzer ihn
 *  gelöscht und er bleibt weg (außer discard). Ohne Transkript-Abschnitt: nichts (Notiz gehört dem Nutzer). */
export function placeSummary(content: string, block: string, lastHash: string | undefined, discard: boolean): Decision {
	if (findBlock(content, SUMMARY)) return decide(content, block, lastHash, discard, SUMMARY);
	const tr = findBlock(content);
	if (!tr || (lastHash !== undefined && !discard)) return { kind: "no-markers" };
	const insert = block + "\n\n";
	return { kind: "write", content: content.slice(0, tr.from) + insert + content.slice(tr.from), from: tr.from, to: tr.from, insert };
}

/** Fingerabdruck eines Abschnitts (FNV-1a, 32 bit): erkennt Änderungen von Hand. Zeilenenden/Leerraum am Zeilenende
 *  zählen nicht, damit ein Editor, der sie anpasst, nicht als „von Hand geändert“ gilt. */
export function fingerprint(text: string): string {
	const norm = text.replace(/\r\n/g, "\n").split("\n").map((l) => l.trimEnd()).join("\n").trim();
	let h = 0x811c9dc5;
	for (let i = 0; i < norm.length; i++) {
		h ^= norm.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, "0");
}

export type Decision =
	| { kind: "write"; content: string; from: number; to: number; insert: string }   // [from, to) im alten Inhalt durch insert
	| { kind: "unchanged" }                                          // steht schon so da
	| { kind: "edited" }                                             // von Hand geändert → nicht überschreiben
	| { kind: "no-markers" };                                        // Markierungen entfernt → Notiz gehört dem Nutzer

/** Was mit einer vorhandenen Notiz geschieht. lastHash: Fingerabdruck dessen, was das Plugin zuletzt geschrieben hat
 *  (undefined bei Notizen ohne gemerkten Stand). discard: ausdrücklicher Befehl „neu schreiben, Änderungen verwerfen“. */
export function decide(content: string, block: string, lastHash: string | undefined, discard: boolean,
	m: Markers = TRANSCRIPT): Decision {
	const found = findBlock(content, m);
	if (!found) {
		if (!discard) return { kind: "no-markers" };
		const head = content.replace(/\s*$/, "");
		const sep = head ? "\n\n" : "";
		const insert = sep + block + "\n";
		return { kind: "write", content: head + insert, from: head.length, to: content.length, insert };
	}
	if (!discard && lastHash !== undefined && fingerprint(found.text) !== lastHash) return { kind: "edited" };
	if (found.text === block) return { kind: "unchanged" };
	return { kind: "write", content: content.slice(0, found.from) + block + content.slice(found.to), from: found.from, to: found.to, insert: block };
}

/** Teilnehmer abgleichen: Einträge, die das Plugin selbst gesetzt hat (ours) und die nicht mehr stimmen, fallen weg;
 *  neue kommen hinten dazu; von Hand eingetragene bleiben immer, Reihenfolge bleibt. null = nichts zu ändern. */
export function mergeParticipants(existing: unknown, current: string[], ours: string[]): string[] | null {
	const old = Array.isArray(existing) ? existing.filter((x): x is string => typeof x === "string") : [];
	const kept = old.filter((x) => current.includes(x) || !ours.includes(x));
	const merged = [...kept, ...current.filter((x) => !kept.includes(x))];
	return merged.length === old.length && merged.every((x, i) => x === old[i]) ? null : merged;
}

/** Dateiname der Notiz aus dem Namen der Aufnahme; Zeichen, die Obsidian in Namen nicht mag, werden ersetzt. */
export function noteName(doc: TranscriptDoc): string {
	const base = (doc.source.split("/").pop() ?? "Transcript").replace(/\.[^.]+$/, "");
	return base.replace(/[\\/:*?"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim() || "Transcript";
}
