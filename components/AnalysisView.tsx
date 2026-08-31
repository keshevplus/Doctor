'use client';

import { useMemo } from 'react';

import { activityByDay, currentStreak, topWords, totals } from '@/lib/analysis/stats';
import { useNotes } from '@/lib/local/use-notes';
import styles from './AnalysisView.module.css';

export function AnalysisView() {
  const { notes, loading } = useNotes();

  const stats = useMemo(() => {
    const summary = totals(notes);
    return {
      ...summary,
      streak: currentStreak(notes),
      days: activityByDay(notes, 7),
      words: topWords(notes, 10),
    };
  }, [notes]);

  if (loading) return <p className="empty-state">Loading…</p>;

  if (notes.length === 0) {
    return <p className="empty-state">Record a few notes and your patterns will show up here.</p>;
  }

  const maxDay = Math.max(1, ...stats.days.map((day) => day.count));
  const maxWord = stats.words[0]?.count ?? 1;

  return (
    <>
      <div className={styles.statsGrid}>
        <Stat value={stats.noteCount} label="Total notes" />
        <Stat value={stats.wordCount.toLocaleString()} label="Total words" />
        <Stat value={stats.averageWords} label="Avg words / note" />
        <Stat value={stats.streak} label={stats.streak === 1 ? 'Day streak' : 'Day streak'} />
      </div>

      <section className="panel" style={{ marginBottom: 20 }}>
        <h3 className={styles.heading}>Last 7 days</h3>
        <div className={styles.chart}>
          {stats.days.map((day) => (
            <div key={day.date.toISOString()} className={styles.chartCol}>
              <span className={styles.dayCount}>{day.count}</span>
              <div
                className={styles.chartBar}
                style={{ height: `${Math.max((day.count / maxDay) * 100, 3)}%` }}
                // The bar is decorative; the count above it carries the value.
                aria-hidden="true"
              />
              <span className={styles.dayLabel}>{day.label}</span>
              <span className="visually-hidden">
                {day.date.toLocaleDateString()}: {day.count} notes
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3 className={styles.heading}>Most used words</h3>
        {stats.words.length === 0 ? (
          <p className="empty-state">Not enough data yet.</p>
        ) : (
          <div className={styles.wordList}>
            {stats.words.map((item) => (
              <div key={item.word} className={styles.wordRow}>
                <span className={styles.word}>{item.word}</span>
                <span className={styles.barTrack} aria-hidden="true">
                  <span
                    className={styles.barFill}
                    style={{ width: `${(item.count / maxWord) * 100}%` }}
                  />
                </span>
                <span className={styles.count}>{item.count}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}
