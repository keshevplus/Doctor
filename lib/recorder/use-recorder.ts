'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Speech recognition + audio capture, extracted from the v1 file so the
 * recording state machine can be reasoned about (and tested) on its own.
 *
 * The two capture paths are independent on purpose. SpeechRecognition gives a
 * free live transcript but only in Chromium browsers; MediaRecorder gives us
 * the audio bytes everywhere. Either can fail without taking the other down —
 * on Safari you still get a recording you can transcribe in the cloud, and
 * with the microphone busy you still get a live transcript.
 */

export type RecorderStatus = 'idle' | 'starting' | 'recording' | 'stopping';

export interface RecorderResult {
  transcript: string;
  audio: Blob | null;
  durationSec: number;
}

export interface UseRecorderOptions {
  captureAudio: boolean;
  onComplete: (result: RecorderResult) => void;
  onError?: (message: string) => void;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechRecognitionAvailable(): boolean {
  return getSpeechRecognition() !== null;
}

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

export function useRecorder({ captureAudio, onComplete, onError }: UseRecorderOptions) {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [finalText, setFinalText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);

  // Held in a ref as well as state: the stop path reads the transcript from a
  // callback that closed over the old state value otherwise.
  const finalTextRef = useRef('');
  const interimTextRef = useRef('');
  const shouldRestartRef = useRef(false);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Release the microphone if the component unmounts mid-recording. Without
  // this the browser's recording indicator stays lit after navigation, which
  // users reasonably read as the app still listening.
  useEffect(() => {
    return () => {
      shouldRestartRef.current = false;
      recognitionRef.current?.abort();
      if (mediaRecorderRef.current?.state !== 'inactive') {
        mediaRecorderRef.current?.stop();
      }
      cleanupStream();
    };
  }, [cleanupStream]);

  useEffect(() => {
    if (status !== 'recording') return;
    const handle = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    return () => clearInterval(handle);
  }, [status]);

  const start = useCallback(async () => {
    if (status !== 'idle') return;

    setStatus('starting');
    setFinalText('');
    setInterimText('');
    setElapsedSec(0);
    finalTextRef.current = '';
    interimTextRef.current = '';
    chunksRef.current = [];
    startedAtRef.current = Date.now();

    const SR = getSpeechRecognition();
    if (SR) {
      const recognition = new SR();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || 'en-US';

      recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result) continue;
          const piece = result[0]?.transcript ?? '';
          if (result.isFinal) {
            finalTextRef.current += `${piece} `;
          } else {
            interim += piece;
          }
        }
        interimTextRef.current = interim;
        setFinalText(finalTextRef.current);
        setInterimText(interim);
      };

      recognition.onerror = (event) => {
        // 'no-speech' fires constantly during pauses and 'aborted' is what our
        // own stop() looks like from in here. Neither is worth surfacing.
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        if (event.error === 'not-allowed' || event.error === 'audio-capture') {
          onError?.('Microphone access was blocked. Allow it to record voice notes.');
        }
      };

      // Chromium ends recognition roughly every minute regardless of
      // `continuous`. Restarting on end is what makes long recordings work.
      recognition.onend = () => {
        if (shouldRestartRef.current) {
          try {
            recognition.start();
          } catch {
            // Already restarting; harmless.
          }
        }
      };

      recognitionRef.current = recognition;
      shouldRestartRef.current = true;
      try {
        recognition.start();
      } catch {
        // Some browsers throw if start() races a previous session.
      }
    }

    if (captureAudio && navigator.mediaDevices && typeof MediaRecorder !== 'undefined') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        streamRef.current = stream;

        const mimeType = pickMimeType();
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data);
        };
        recorder.start();
        mediaRecorderRef.current = recorder;
      } catch {
        // No audio track — the transcript path still works on its own.
        mediaRecorderRef.current = null;
      }
    }

    if (!SR && !mediaRecorderRef.current) {
      onError?.('This browser cannot record audio or transcribe speech.');
      setStatus('idle');
      return;
    }

    setStatus('recording');
  }, [captureAudio, onError, status]);

  const stop = useCallback(() => {
    if (status !== 'recording') return;
    setStatus('stopping');

    shouldRestartRef.current = false;
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        // Already stopped.
      }
      recognitionRef.current = null;
    }

    const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
    const transcript = `${finalTextRef.current} ${interimTextRef.current}`.trim();

    const finish = (audio: Blob | null) => {
      cleanupStream();
      mediaRecorderRef.current = null;
      setStatus('idle');
      setInterimText('');
      onComplete({ transcript, audio, durationSec });
    };

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        finish(blob.size > 0 ? blob : null);
      };
      try {
        recorder.stop();
      } catch {
        finish(null);
      }
    } else {
      finish(null);
    }
  }, [cleanupStream, onComplete, status]);

  return {
    status,
    isRecording: status === 'recording',
    transcript: finalText,
    interimTranscript: interimText,
    elapsedSec,
    start,
    stop,
    toggle: status === 'recording' ? stop : start,
  };
}
