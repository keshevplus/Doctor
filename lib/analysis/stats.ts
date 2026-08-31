/**
 * Words in a transcript. Lives here rather than alongside the note types
 * because it is an analysis concern, and keeping this module free of imports
 * lets the test runner load it without a bundler or path-alias resolver.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Pure analysis functions.
 *
 * In v1 these were tangled into the render path, which meant the only way to
 * check the top-words logic was to record notes in a browser and squint at
 * bars. Extracted here they are ordinary functions with ordinary tests.
 */

export interface NoteLike {
  text: string;
  createdAt: number;
}

export interface Totals {
  noteCount: number;
  wordCount: number;
  averageWords: number;
}

export function totals(notes: readonly NoteLike[]): Totals {
  const noteCount = notes.length;
  const wordCount = notes.reduce((sum, note) => sum + countWords(note.text), 0);
  return {
    noteCount,
    wordCount,
    averageWords: noteCount ? Math.round(wordCount / noteCount) : 0,
  };
}

export interface DayBucket {
  date: Date;
  label: string;
  count: number;
}

/** Notes per day for the trailing `days` days, oldest first, in local time. */
export function activityByDay(notes: readonly NoteLike[], days = 7, now = new Date()): DayBucket[] {
  const buckets: DayBucket[] = [];

  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    buckets.push({
      date,
      label: date.toLocaleDateString(undefined, { weekday: 'short' }).charAt(0),
      count: 0,
    });
  }

  // Bucket by local calendar day rather than by elapsed hours, so a note made
  // at 11pm and one made at 1am land on the days the user remembers them on.
  for (const note of notes) {
    const noteDate = new Date(note.createdAt);
    const bucket = buckets.find(
      (b) =>
        b.date.getFullYear() === noteDate.getFullYear() &&
        b.date.getMonth() === noteDate.getMonth() &&
        b.date.getDate() === noteDate.getDate(),
    );
    if (bucket) bucket.count++;
  }

  return buckets;
}

/**
 * Stopwords. Kept as a Set for O(1) membership, and deliberately including
 * spoken-language filler ("um", "like", "gonna") that a written-text stopword
 * list would not — these are voice notes, and without it the top-words chart
 * is just a list of hesitations.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'a','about','after','again','all','am','an','and','any','are','as','at','be','because','been',
  'before','being','below','between','both','but','by','can','could','did','do','does','doing',
  'down','during','each','few','for','from','further','had','has','have','having','he','her',
  'here','hers','herself','him','himself','his','how','i','if','in','into','is','it','its',
  'itself','just','me','more','most','my','myself','no','nor','not','now','of','off','on','once',
  'only','or','other','our','ours','ourselves','out','over','own','same','she','should','so',
  'some','such','than','that','the','their','theirs','them','themselves','then','there','these',
  'they','this','those','through','to','too','under','until','up','very','was','we','were','what',
  'when','where','which','while','who','whom','why','will','with','would','you','your','yours',
  'yourself','yourselves',
  // Spoken filler and contractions that survive transcription.
  'im','ive','id','ill','dont','doesnt','didnt','cant','wont','youre','youve','thats','theres',
  'gonna','gotta','wanna','kinda','okay','ok','uh','um','uhm','er','ah','yeah','yep','nope','like',
  'really','actually','basically','literally','sort','kind','stuff','thing','things',
]);

export interface WordCount {
  word: string;
  count: number;
}

export function topWords(notes: readonly NoteLike[], limit = 10): WordCount[] {
  const frequencies = new Map<string, number>();

  for (const note of notes) {
    const words = note.text
      .toLowerCase()
      // Keep apostrophes so "don't" survives to be matched as a stopword,
      // then strip them for counting.
      .replace(/[^a-z0-9'\s]/g, ' ')
      .split(/\s+/);

    for (const raw of words) {
      const word = raw.replace(/'/g, '');
      if (word.length < 3 || STOPWORDS.has(word)) continue;
      frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
    }
  }

  return [...frequencies.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit);
}

/** Tag usage counts, most-used first. */
export function tagFrequencies(notes: readonly { tags: string[] }[]): WordCount[] {
  const frequencies = new Map<string, number>();
  for (const note of notes) {
    for (const tag of note.tags) {
      frequencies.set(tag, (frequencies.get(tag) ?? 0) + 1);
    }
  }
  return [...frequencies.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}

/**
 * Longest run of consecutive days with at least one note, ending today or
 * yesterday. Counting a streak as broken only after a full missed day is the
 * forgiving reading, and the one every habit tracker uses.
 */
export function currentStreak(notes: readonly NoteLike[], now = new Date()): number {
  if (notes.length === 0) return 0;

  const dayKeys = new Set(
    notes.map((note) => {
      const date = new Date(note.createdAt);
      return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    }),
  );

  const keyFor = (offset: number): string => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  };

  // Allow the streak to start yesterday — someone who has not recorded yet
  // today has not lost their streak.
  let offset = dayKeys.has(keyFor(0)) ? 0 : dayKeys.has(keyFor(1)) ? 1 : -1;
  if (offset === -1) return 0;

  let streak = 0;
  while (dayKeys.has(keyFor(offset))) {
    streak++;
    offset++;
  }
  return streak;
}
