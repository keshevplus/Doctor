'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import * as store from './store';
import { migrateV1Notes, type MigrationResult } from './migrate-v1';
import type { LocalNote } from './types';

/**
 * Loads notes from IndexedDB and keeps a copy in React state.
 *
 * Every mutation writes to IndexedDB first and then updates state from the
 * result, so what is on screen is always what is on disk — no optimistic
 * update can drift from storage that quietly rejected a write.
 */
export function useNotes() {
  const [notes, setNotes] = useState<LocalNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [migration, setMigration] = useState<MigrationResult | null>(null);

  const refresh = useCallback(async () => {
    setNotes(await store.listNotes());
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Import v1 notes before the first read, so a returning user never
        // sees an empty archive and concludes their notes are gone.
        const result = await migrateV1Notes();
        if (!cancelled && (result.status === 'imported' || result.status === 'failed')) {
          setMigration(result);
        }
        const loaded = await store.listNotes();
        if (!cancelled) setNotes(loaded);
      } catch (error) {
        console.error('failed to load notes', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const create = useCallback(
    async (input: Parameters<typeof store.createNote>[0]) => {
      const note = await store.createNote(input);
      await refresh();
      return note;
    },
    [refresh],
  );

  const update = useCallback(
    async (id: string, patch: Parameters<typeof store.updateNote>[1]) => {
      const note = await store.updateNote(id, patch);
      await refresh();
      return note;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await store.deleteNote(id);
      await refresh();
    },
    [refresh],
  );

  const allTags = useMemo(
    () => [...new Set(notes.flatMap((note) => note.tags))].sort(),
    [notes],
  );

  return { notes, allTags, loading, migration, create, update, remove, refresh };
}

/** Filter notes by free-text query and an optional tag. */
export function filterNotes(
  notes: readonly LocalNote[],
  query: string,
  tag: string | null,
): LocalNote[] {
  const needle = query.trim().toLowerCase();

  return notes.filter((note) => {
    if (tag && !note.tags.includes(tag)) return false;
    if (!needle) return true;
    return (
      note.text.toLowerCase().includes(needle) ||
      note.tags.some((t) => t.includes(needle)) ||
      (note.summary?.toLowerCase().includes(needle) ?? false)
    );
  });
}
