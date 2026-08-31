import { createNote, getMeta, setMeta } from './store';
import { makeId, type LocalNote } from './types';

/**
 * Import notes saved by the v1 single-file app.
 *
 * v1 stored everything as JSON under the localStorage key `reel-voice-notes`,
 * with audio inlined as base64 data URLs. This reads that, writes the notes
 * into IndexedDB, and — importantly — **leaves the original key untouched**.
 *
 * Deleting the source after a successful import would be tidier, and it is
 * exactly the wrong call: if this migration has a bug, the localStorage copy
 * is the only remaining record of notes a user may have been keeping for a
 * year. It costs a few megabytes to leave it there. It can be cleared from
 * Settings once the user has seen their notes arrive safely.
 */

const V1_KEY = 'reel-voice-notes';
const MIGRATION_FLAG = 'v1-import-completed';

export interface MigrationResult {
  status: 'imported' | 'already-done' | 'nothing-to-import' | 'failed';
  imported: number;
  skipped: number;
  error?: string;
}

export async function migrateV1Notes(): Promise<MigrationResult> {
  if (typeof window === 'undefined') {
    return { status: 'nothing-to-import', imported: 0, skipped: 0 };
  }

  if (await getMeta<boolean>(MIGRATION_FLAG)) {
    return { status: 'already-done', imported: 0, skipped: 0 };
  }

  let raw: string | null = null;
  try {
    raw = localStorage.getItem(V1_KEY);
  } catch {
    // Storage blocked (private mode, cookie settings). Nothing to import.
    return { status: 'nothing-to-import', imported: 0, skipped: 0 };
  }

  if (!raw) {
    await setMeta(MIGRATION_FLAG, true);
    return { status: 'nothing-to-import', imported: 0, skipped: 0 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      status: 'failed',
      imported: 0,
      skipped: 0,
      error: 'Saved notes could not be read. The original data has been left in place.',
    };
  }

  if (!Array.isArray(parsed)) {
    await setMeta(MIGRATION_FLAG, true);
    return { status: 'nothing-to-import', imported: 0, skipped: 0 };
  }

  let imported = 0;
  let skipped = 0;

  for (const entry of parsed) {
    const note = normalizeV1(entry);
    if (!note) {
      skipped++;
      continue;
    }
    try {
      await createNote(note);
      imported++;
    } catch {
      skipped++;
    }
  }

  await setMeta(MIGRATION_FLAG, true);
  await setMeta('v1-import-summary', { imported, skipped, at: Date.now() });

  return { status: 'imported', imported, skipped };
}

/**
 * v1 went through a couple of note shapes over its life — early versions
 * stored bare strings, later ones objects with `text` or `transcript`. Accept
 * all of them rather than dropping anything we do not recognise on sight.
 */
function normalizeV1(entry: unknown): (Partial<LocalNote> & { text: string }) | null {
  if (typeof entry === 'string') {
    return { id: makeId(), text: entry, tags: [], createdAt: Date.now() };
  }

  if (!entry || typeof entry !== 'object') return null;
  const record = entry as Record<string, unknown>;

  const text =
    typeof record.text === 'string'
      ? record.text
      : typeof record.transcript === 'string'
        ? record.transcript
        : '';

  if (!text.trim()) return null;

  const createdAt =
    typeof record.createdAt === 'number'
      ? record.createdAt
      : typeof record.timestamp === 'number'
        ? record.timestamp
        : Date.now();

  return {
    id: typeof record.id === 'string' ? record.id : makeId(),
    text,
    tags: Array.isArray(record.tags)
      ? record.tags.filter((t): t is string => typeof t === 'string')
      : [],
    audio: dataUrlToBlob(typeof record.audio === 'string' ? record.audio : null),
    createdAt,
  };
}

/** Convert a v1 base64 data URL back into a Blob, so it stops costing 33% extra. */
function dataUrlToBlob(dataUrl: string | null): Blob | null {
  if (!dataUrl?.startsWith('data:')) return null;
  try {
    const [header, base64] = dataUrl.split(',');
    if (!header || !base64) return null;
    const mime = header.match(/data:([^;]+)/)?.[1] ?? 'audio/webm';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    // A corrupt audio blob must not cost us the transcript, which is the part
    // that actually matters.
    return null;
  }
}

/** Only offered from Settings, and only after an import has succeeded. */
export function clearV1Storage(): void {
  try {
    localStorage.removeItem(V1_KEY);
  } catch {
    // Nothing to do.
  }
}
