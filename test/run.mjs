// Tests der reinen Funktionen (src/transcript.ts) mit Node: Redebeiträge wie der Python-Kern (render._turns),
// Ersetzen des erzeugten Abschnitts ohne eigene Notizen anzutasten. Aufruf: npm test
import { build } from "esbuild";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), "lt-test-")), "transcript.mjs");
await build({ entryPoints: [join(here, "../src/transcript.ts")], outfile: out, format: "esm", bundle: true, logLevel: "error" });
const T = await import(pathToFileURL(out));

// 1. Redebeiträge = Python (Sollwerte erzeugt mit transcriber.render._turns, test/expected-turns.json)
const doc = JSON.parse(readFileSync(join(here, "../../tests/fixtures/beispiel.transcript.json"), "utf8"));
const expected = JSON.parse(readFileSync(join(here, "expected-turns.json"), "utf8"));
const got = T.turns(doc, "Unklar").map((u) => ({ ...u, start: +u.start.toFixed(3), end: +u.end.toFixed(3) }));
assert.deepEqual(got, expected);

// 2. Was mit einer vorhandenen Notiz geschieht (decide)
const block = (x) => `${T.START}\n${x}\n${T.END}`;
const alt = block("alt"), neu = block("neu"), h = T.fingerprint(alt);
const note = `Meine Notiz oben\n\n${alt}\n\nMeine Notiz unten\n`;
let d = T.decide(note, neu, h, false);                                       // unverändert → ersetzen, Rest bleibt
assert.equal(d.kind, "write");
assert.equal(d.content, `Meine Notiz oben\n\n${neu}\n\nMeine Notiz unten\n`);
assert.equal(note.slice(0, d.from) + d.insert + note.slice(d.to), d.content);  // Editor-Weg ergibt dasselbe
const hand = note.replace("alt", "alt, von Hand korrigiert");
assert.equal(T.decide(hand, neu, h, false).kind, "edited");                    // Handänderung → nicht überschreiben
assert.equal(T.decide(hand, neu, h, true).kind, "write");                      // „neu schreiben“ verwirft sie
assert.equal(T.decide(note.replace(T.END, ""), neu, h, false).kind, "no-markers");     // Ende-Markierung gelöscht
assert.equal(T.decide(note.replace(T.START, ""), neu, h, false).kind, "no-markers");   // Start-Markierung gelöscht
const ohne = "Nur eigener Text\n";
assert.equal(T.decide(ohne, neu, h, false).kind, "no-markers");               // nie ein zweites Transkript anhängen
d = T.decide(ohne, neu, h, true);
assert.equal(d.content, `Nur eigener Text\n\n${neu}\n`);                     // nur auf ausdrücklichen Befehl
assert.equal(T.decide(note, alt, h, false).kind, "unchanged");
assert.equal(T.decide(note, neu, undefined, false).kind, "write");             // Notiz ohne gemerkten Stand
assert.equal(T.fingerprint(alt), T.fingerprint(alt.replace(/\n/g, "  \r\n"))); // Leerraum/Zeilenenden zählen nicht

// 2b. Teilnehmer: eigene (vom Plugin gesetzte) veraltete fallen weg, von Hand eingetragene bleiben
assert.deepEqual(T.mergeParticipants(["[[A]]", "Eigener Eintrag"], ["[[A]]", "[[B]]"], ["[[A]]"]), ["[[A]]", "Eigener Eintrag", "[[B]]"]);
assert.equal(T.mergeParticipants(["[[A]]"], ["[[A]]"], ["[[A]]"]), null);                          // unverändert
assert.deepEqual(T.mergeParticipants(undefined, ["[[B]]"], []), ["[[B]]"]);
assert.deepEqual(T.mergeParticipants(["[[Tom]]"], ["[[Anna]]"], ["[[Tom]]"]), ["[[Anna]]"]);         // umbenannt: Tom weg
assert.deepEqual(T.mergeParticipants(["[[Tom]]", "[[Lisa]]"], ["[[Anna]]"], ["[[Tom]]"]), ["[[Lisa]]", "[[Anna]]"]); // Lisa von Hand
assert.equal(T.mergeParticipants(["[[Lisa]]"], [], ["[[Tom]]"]), null);                             // von Hand bleibt immer

// 3. Nur sicher zugeordnete Namen werden verlinkt
const named = T.knownNames(doc);
for (const c of doc.speakers) if (named.includes(c.name)) assert.ok(["sicher", "bestätigt"].includes(c.status));

// 4. Dateiname ohne Zeichen, die Obsidian ablehnt
assert.equal(T.noteName({ ...doc, source: "/x/Budget: Q4/Plan #1.m4a" }), "Plan 1");
assert.equal(T.noteName({ ...doc, source: "/x/2026-10-14 Budget: Q4 [final].m4a" }), "2026-10-14 Budget Q4 final");
console.log("ok – Redebeiträge, Notiz-Entscheidungen, Teilnehmer, Namen");
