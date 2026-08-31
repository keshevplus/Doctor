'use client';

import { useDeferredValue, useMemo, useState } from 'react';

import { downloadNotes, type ExportFormat } from '@/lib/export/format';
import { filterNotes, useNotes } from '@/lib/local/use-notes';
import { NoteCard } from './NoteCard';
import styles from './NotesView.module.css';

export function NotesView() {
  const { notes, allTags, loading, migration, update, remove } = useNotes();
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  // Keeps typing responsive on a large archive: the input updates immediately
  // while the filtered list re-renders at a lower priority.
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(
    () => filterNotes(notes, deferredQuery, activeTag),
    [notes, deferredQuery, activeTag],
  );

  const exportAll = (format: ExportFormat) => {
    // Exports what is on screen, not the whole archive — if you have filtered
    // to a tag, that filter is almost certainly the point of the export.
    downloadNotes(filtered, format);
    setExportOpen(false);
  };

  if (loading) {
    return <p className="empty-state">Loading your notes…</p>;
  }

  return (
    <>
      {migration?.status === 'imported' && migration.imported > 0 ? (
        <p className="banner">
          Imported {migration.imported} note{migration.imported === 1 ? '' : 's'} from the earlier
          version of Reel.
          {migration.skipped > 0 ? ` ${migration.skipped} could not be read and were left alone.` : ''}
        </p>
      ) : null}

      {migration?.status === 'failed' ? (
        <p className="banner banner-danger" role="alert">
          {migration.error}
        </p>
      ) : null}

      <div className={styles.toolbar}>
        <label className="visually-hidden" htmlFor="note-search">
          Search notes
        </label>
        <input
          id="note-search"
          type="search"
          placeholder="Search notes…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        {allTags.length ? (
          <div className={styles.tagRow}>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="tag-filter-chip"
                aria-pressed={activeTag === tag}
                onClick={() => setActiveTag((current) => (current === tag ? null : tag))}
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}

        <div className={styles.exportRow}>
          <span className="muted">
            {filtered.length} note{filtered.length === 1 ? '' : 's'}
          </span>
          <div className={styles.exportMenu}>
            <button
              type="button"
              className="btn btn-ghost"
              aria-expanded={exportOpen}
              disabled={filtered.length === 0}
              onClick={() => setExportOpen((open) => !open)}
            >
              Export {activeTag || deferredQuery ? 'these' : 'all'} ▾
            </button>
            {exportOpen ? (
              <div className={styles.exportDropdown}>
                {(['txt', 'md', 'json'] as const).map((format) => (
                  <button key={format} type="button" onClick={() => exportAll(format)}>
                    .{format}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="empty-state">
          {notes.length
            ? 'No notes match your search.'
            : 'No voice notes yet. Record your first one from the Record tab.'}
        </p>
      ) : (
        <div className={styles.list}>
          {filtered.map((note) => (
            <NoteCard key={note.id} note={note} onUpdate={update} onDelete={remove} />
          ))}
        </div>
      )}
    </>
  );
}
