// Aufruf der Transcriber-Kommandozeile (benennen, bestätigen, transkribieren). Nur Desktop (Node).
import { execFile } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";

export const expand = (p: string): string => (p.startsWith("~/") ? homedir() + p.slice(1) : p);

export class TranscriberMissing extends Error {}

/** Führt `transcriber <args>` aus; liefert stdout, wirft bei Fehler mit der letzten Zeile von stderr. */
export function runTranscriber(command: string, args: string[], language: string): Promise<string> {
	const exe = expand(command);
	if (!existsSync(exe)) return Promise.reject(new TranscriberMissing(exe));
	return new Promise((resolve, reject) => {
		execFile(exe, args, {
			env: {
				...process.env,
				TRANSCRIBER_UI_LANG: language,   // Ausgaben/Anzeigenamen in Obsidians Sprache
				// ffmpeg: vom Installer unter ~/.local/share/transcriber/bin, sonst Homebrew. Obsidian hat als Mac-App nur
				// einen minimalen PATH (wie die Transcriber-App bei Finder-Start, Jobs.swift) – sonst „ffprobe not found“.
				PATH: [`${homedir()}/.local/share/transcriber/bin`, "/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? "",
					"/usr/bin", "/bin", "/usr/sbin", "/sbin"].filter(Boolean).join(":"),
			},
			maxBuffer: 16 * 1024 * 1024,
		}, (err, stdout, stderr) => {
			if (err) {
				const last = stderr.trim().split("\n").pop() || err.message;
				reject(new Error(last));
			} else {
				resolve(stdout);
			}
		});
	});
}
