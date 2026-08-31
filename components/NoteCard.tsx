'use client';

import { useEffect, useMemo, useState } from 'react';

import { countWords } from '@/lib/analysis/stats';
import { downloadNotes, formatTimestamp, type ExportFormat } from '@/lib/export/format';
import { parseTags, type LocalNote } from '@/lib/local/types';
import styles from './NoteCard.module.css';

interface NoteCardProps {
  note: LocalNote;
  startEditing?: boolean;
  onUpdate: (id: string, patch: { text?: string; tags?: string[] }) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}

export function NoteCard({ note, startEditing = false, onUpdate, onDelete }: NoteCardProps) {
  const [editing, setEditing] = useState(startEditing);
  const [draftText, setDraftText] = useState(note.text);
  const [draftTags, setDraftTags] = useState(note.tags.join(', '));
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Object URLs must be created from the blob and released when the note
  // changes or unmounts — leaking them pins the audio in memory for the life
  // of the page, which for a long archive is a real amount of memory.
  const audioUrl = useMemo(
    () => (note.audio ? URL.createObjectURL(note.audio) : null),
    [note.audio],
  );

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const save = async () => {
    await onUpdate(note.id, {
      text: draftText.trim() || note.text,
      tags: parseTags(draftTags),
    });
    setEditing(false);
  };

  const cancel = () => {
    setDraftText(note.text);
    setDraftTags(note.tags.join(', '));
    setEditing(false);
  };

  const exportAs = (format: ExportFormat) => {
    downloadNotes([note], format, note);
    setExportOpen(false);
  };

  return (
    <article className={`${styles.card} ${editing ? styles.editing : ''}`}>
      <div className={styles.meta}>
        <span>{formatTimestamp(note.createdAt)}</span>
        <span>{countWords(note.text)} words</span>
      </div>

      {editing ? (
        <>
          <label className="visually-hidden" htmlFor={`text-${note.id}`}>
            Note text
          </label>
          <textarea
            id={`text-${note.id}`}
            className={styles.editText}
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
          />
          <label className="visually-hidden" htmlFor={`tags-${note.id}`}>
            Tags, comma separated
          </label>
          <input
            id={`tags-${note.id}`}
            type="text"
            className={styles.editTags}
            placeholder="tags, comma separated"
            value={draftTags}
            onChange={(event) => setDraftTags(event.target.value)}
          />
        </>
      ) : (
        <>
          <p className={styles.text}>{note.text}</p>
          {note.summary ? <p className={styles.summary}>{note.summary}</p> : null}
          {note.tags.length ? (
            <div className={styles.tags}>
              {note.tags.map((tag) => (
                <span key={tag} className="tag-chip">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </>
      )}

      {audioUrl ? (
        // preload="none" so a list of fifty notes does not fetch fifty audio
        // blobs on render.
        <audio className={styles.audio} controls preload="none" src={audioUrl} />
      ) : null}

      <div className={styles.actions}>
        {editing ? (
          <>
            <button type="button" className="btn btn-primary" onClick={save}>
              Save
            </button>
            <button type="button" className="btn btn-ghost" onClick={cancel}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)}>
              Edit
            </button>

            <div className={styles.exportMenu}>
              <button
                type="button"
                className="btn btn-ghost"
                aria-expanded={exportOpen}
                onClick={() => setExportOpen((open) => !open)}
              >
                Export ▾
              </button>
              {exportOpen ? (
                <div className={styles.exportDropdown}>
                  {(['txt', 'md', 'json'] as const).map((format) => (
                    <button key={format} type="button" onClick={() => exportAs(format)}>
                      .{format}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </>
        )}

        {confirmingDelete ? (
          <>
            <span className={styles.confirmLabel}>Delete this note?</span>
            <button type="button" className="btn btn-danger" onClick={() => onDelete(note.id)}>
              Delete
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setConfirmingDelete(false)}
            >
              Keep
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete
          </button>
        )}
      </div>
    </article>
  );
}
