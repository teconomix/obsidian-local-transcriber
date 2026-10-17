import { getLanguage } from "obsidian";

/** Deutsch, wenn Obsidian auf Deutsch läuft, sonst Englisch. */
export const de = (): boolean => getLanguage().startsWith("de");
export const t = (german: string, english: string): string => (de() ? german : english);

const STATUS: Record<string, [string, string]> = {
	sicher: ["sicher", "certain"],
	bestätigt: ["bestätigt", "confirmed"],
	vermutlich: ["vermutlich", "probable"],
	unbekannt: ["unbekannt", "unknown"],
};
export const status = (code: string): string => {
	const s = STATUS[code];
	return s ? t(s[0], s[1]) : code;
};
