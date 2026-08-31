import { makeId, type LocalNote } from './types';

/**
 * Local-first note storage on IndexedDB.
 *
 * v1 kept notes in localStorage, which forced audio to be base64 data URLs and
 * capped the whole archive at ~5 MB. IndexedDB stores Blobs natively, so a
 * recording costs its actual bytes rather than a third more, and the quota is
 * measured in hundreds of megabytes.
 *
 * Reads and writes go here first and sync happens afterwards in the
 * background. That is what makes the app usable offline and makes the UI feel
 * immediate — no spinner is ever waiting on a network round trip to show a
 * note the user just recorded.
 */

const DB_NAME = 'reel';
const DB_VERSION = 1;
const NOTES = 'notes';
const META = 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(NOTES)) {
        const store = db.createObjectStore(NOTES, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('syncState', 'syncState');
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const request = fn(transaction.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

/* --- Notes -------------------------------------------------------------- */

export async function listNotes(): Promise<LocalNote[]> {
  const all = await tx<LocalNote[]>(NOTES, 'readonly', (store) => store.getAll());
  return all
    .filter((note) => !note.deletedAt)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getNote(id: string): Promise<LocalNote | undefined> {
  return tx<LocalNote | undefined>(NOTES, 'readonly', (store) => store.get(id));
}

export async function putNote(note: LocalNote): Promise<void> {
  await tx(NOTES, 'readwrite', (store) => store.put(note));
}

export async function createNote(
  input: Pick<LocalNote, 'text'> & Partial<LocalNote>,
): Promise<LocalNote> {
  const now = Date.now();
  const note: LocalNote = {
    id: input.id ?? makeId(),
    text: input.text,
    tags: input.tags ?? [],
    audio: input.audio ?? null,
    audioDurationSec: input.audioDurationSec ?? null,
    summary: input.summary ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    deletedAt: null,
    version: 1,
    syncState: 'local',
  };
  await putNote(note);
  return note;
}

export async function updateNote(
  id: string,
  patch: Partial<Pick<LocalNote, 'text' | 'tags' | 'summary'>>,
): Promise<LocalNote | undefined> {
  const existing = await getNote(id);
  if (!existing) return undefined;

  const updated: LocalNote = {
    ...existing,
    ...patch,
    updatedAt: Date.now(),
    version: existing.version + 1,
    syncState: 'local',
  };
  await putNote(updated);
  return updated;
}

/**
 * Soft delete. A hard delete cannot be replicated — the other device would
 * simply never hear about it and would push the note back on its next sync.
 * The tombstone is purged once the server confirms it.
 */
export async function deleteNote(id: string): Promise<void> {
  const existing = await getNote(id);
  if (!existing) return;
  await putNote({
    ...existing,
    deletedAt: Date.now(),
    updatedAt: Date.now(),
    version: existing.version + 1,
    syncState: 'local',
  });
}

export async function purgeNote(id: string): Promise<void> {
  await tx(NOTES, 'readwrite', (store) => store.delete(id));
}

export async function pendingSyncNotes(): Promise<LocalNote[]> {
  const all = await tx<LocalNote[]>(NOTES, 'readonly', (store) => store.getAll());
  return all.filter((note) => note.syncState === 'local');
}

/* --- Meta --------------------------------------------------------------- */

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return tx<T | undefined>(META, 'readonly', (store) => store.get(key));
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await tx(META, 'readwrite', (store) => store.put(value, key));
}

/** Rough storage headroom, for warning before a long recording fails to save. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}
