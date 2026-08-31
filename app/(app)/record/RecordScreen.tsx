'use client';

import { useState } from 'react';

import { NoteCard } from '@/components/NoteCard';
import { Recorder } from '@/components/Recorder';
import { useNotes } from '@/lib/local/use-notes';
import type { RecorderResult } from '@/lib/recorder/use-recorder';
import type { LocalNote } from '@/lib/local/types';

export function RecordScreen() {
  const { create, update, remove } = useNotes();
  const [justSaved, setJustSaved] = useState<LocalNote | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSaved = async (result: RecorderResult) => {
    setSaveError(null);
    try {
      const note = await create({
        text: result.transcript,
        audio: result.audio,
        audioDurationSec: result.durationSec,
      });
      // Show the new note straight away in edit mode, so tagging or fixing a
      // mis-heard word happens while it is still fresh rather than requiring a
      // trip to the Notes tab.
      setJustSaved(note);
    } catch (error) {
      console.error('failed to save note', error);
      setSaveError(
        'Could not save that note — your browser may be out of storage. The recording was not kept.',
      );
    }
  };

  return (
    <>
      {saveError ? (
        <p className="banner banner-danger" role="alert">
          {saveError}
        </p>
      ) : null}

      <Recorder onSaved={handleSaved} />

      {justSaved ? (
        <>
          <p className="section-label">Saved — add tags or fix the text</p>
          <NoteCard
            key={justSaved.id}
            note={justSaved}
            startEditing
            onUpdate={async (id, patch) => {
              const updated = await update(id, patch);
              if (updated) setJustSaved(updated);
              return updated;
            }}
            onDelete={async (id) => {
              await remove(id);
              setJustSaved(null);
            }}
          />
        </>
      ) : null}
    </>
  );
}
