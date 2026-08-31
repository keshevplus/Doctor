'use client';

import { useCallback, useState } from 'react';

import { speechRecognitionAvailable, useRecorder, type RecorderResult } from '@/lib/recorder/use-recorder';
import styles from './Recorder.module.css';

interface RecorderProps {
  onSaved: (result: RecorderResult) => void | Promise<void>;
}

export function Recorder({ onSaved }: RecorderProps) {
  const [captureAudio, setCaptureAudio] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleComplete = useCallback(
    async (result: RecorderResult) => {
      // An empty transcript with no audio means the microphone never produced
      // anything — saving a blank note would just be litter.
      if (!result.transcript && !result.audio) return;
      await onSaved(result);
    },
    [onSaved],
  );

  const recorder = useRecorder({
    captureAudio,
    onComplete: handleComplete,
    onError: setError,
  });

  const minutes = Math.floor(recorder.elapsedSec / 60);
  const seconds = recorder.elapsedSec % 60;
  const hasSpeechApi = speechRecognitionAvailable();
  const live = `${recorder.transcript}${recorder.interimTranscript}`.trim();

  return (
    <div className="panel">
      {error ? (
        <p className="banner banner-danger" role="alert">
          {error}
        </p>
      ) : null}

      {!hasSpeechApi ? (
        <p className="banner">
          This browser has no built-in speech recognition, so there is no live transcript. Your
          audio is still recorded, and you can transcribe it with credits afterwards.
        </p>
      ) : null}

      <div className={styles.center}>
        <button
          type="button"
          className={`${styles.mic} ${recorder.isRecording ? styles.micRecording : ''}`}
          onClick={recorder.toggle}
          disabled={recorder.status === 'starting' || recorder.status === 'stopping'}
          aria-pressed={recorder.isRecording}
        >
          <span aria-hidden="true">{recorder.isRecording ? '■' : '●'}</span>
          <span className="visually-hidden">
            {recorder.isRecording ? 'Stop recording' : 'Start recording'}
          </span>
        </button>

        {/* aria-live so screen reader users hear that recording began and how
            long it has been running, which the icon swap alone does not convey. */}
        <p className={styles.status} aria-live="polite">
          {recorder.isRecording ? (
            <>
              Recording{' '}
              <span className={styles.timer}>
                {minutes}:{String(seconds).padStart(2, '0')}
              </span>
            </>
          ) : recorder.status === 'starting' ? (
            'Starting…'
          ) : recorder.status === 'stopping' ? (
            'Saving…'
          ) : (
            'Tap to start recording'
          )}
        </p>

        <div className={live ? styles.transcript : `${styles.transcript} ${styles.empty}`}>
          {live ? (
            <>
              {recorder.transcript}
              <span className={styles.interim}>{recorder.interimTranscript}</span>
            </>
          ) : (
            'Your transcript will appear here as you speak.'
          )}
        </div>

        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={captureAudio}
            onChange={(event) => setCaptureAudio(event.target.checked)}
            disabled={recorder.isRecording}
          />
          Also save the audio recording
        </label>
      </div>
    </div>
  );
}
