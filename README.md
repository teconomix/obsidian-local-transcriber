# Local Transcriber for Obsidian

Import meeting and call transcripts from [Local Transcriber](https://transcriber.teconomix.net) as notes – with
speakers linked to people notes. Transcription and speaker recognition run on your Mac; nothing goes to the cloud.

**Requires** the free [Local Transcriber](https://transcriber.teconomix.net) app (Mac with Apple Silicon, macOS 14+).
Desktop only.

## What it does

- **One note per recording** in a folder of your choice (default `Transcriber`), with properties: `date`,
  `duration` (minutes), `participants` (`[[links]]` to recognized speakers), `event` (calendar title),
  `transcript` (path of the transcript file) and the tag `transcript`.
- **Transcripts stay current** until you take over: speaker names you assign later (in the app or here), a re-analysis
  or the app's automatic descriptive file name reach the note.
- **Renamed recordings** keep their note: the note is renamed too, and links to it stay intact.
- **Name a speaker** (command palette, in a transcript note): pick the speaker, type a name – suggestions come from
  the calendar attendees and, optionally, a people folder. Local Transcriber's voice database learns the voice and
  recognizes it in future recordings.
- **Confirm all speaker matches** with one command.
- **Transcribe audio files in your vault**: right-click an audio file › *Transcribe*, or use the command palette.
  The note embeds the audio, so you can play it in Obsidian.
- **Sync** on startup and whenever the transcript folder changes, or manually (ribbon icon, command palette).

Use it with the AI plugin of your choice to summarize transcripts – the plugin itself sends nothing anywhere.

## Your edits

The note follows Local Transcriber only as long as you leave the transcript itself alone:

| You … | The plugin … |
|---|---|
| write above or below the transcript | never touches it |
| edit the transcript (e.g. fix a misheard word) | stops updating it and tells you; the command *Rewrite transcript* brings the current version back (and discards your edits) |
| delete one of the hidden `%% local-transcriber %%` marker lines | treats the note as yours: no further updates, never a second copy |
| change properties (`date`, `event`, …) | keeps your values; it only adds new participants and removes participants it added itself that are no longer correct – entries you added stay |
| rename or move the note | finds it anywhere in the vault and keeps your name and folder |
| delete the note | does not recreate it |

Changes travel one way: from Local Transcriber to Obsidian. Edits in the note do not change the transcript files.

## Disclosures

As required by Obsidian's developer policies:

- **Files outside the vault:** the plugin *reads* transcripts (`*.transcript.json`) from Local Transcriber's folder
  (default `~/Transcriber`, configurable), because that is where the app stores recordings. It writes only notes
  inside your vault.
- **External program:** to name speakers, confirm matches and transcribe files, the plugin runs Local Transcriber's
  command line tool (default `~/.local/bin/transcriber`, configurable). It runs locally.
- **No network use, no telemetry, no account.**

## Installation

1. Install [Local Transcriber](https://transcriber.teconomix.net).
2. In Obsidian: **Settings → Community plugins → Browse**, search for *Local Transcriber*, install and enable.
3. Optional: in the plugin settings, choose the notes folder and a people folder.

## Privacy note

Transcripts can contain confidential conversations. If your vault is synced (Obsidian Sync, iCloud, Syncthing …),
the transcript notes are synced too. Choose the notes folder accordingly.

## License

MIT – free and without warranty. Source: [teconomix/local-transcriber](https://github.com/teconomix/local-transcriber).
