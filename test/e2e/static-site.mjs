/**
 * End-to-end smoke test for the static (GitHub Pages) build.
 *
 *     npm run build:pages && npm run test:e2e
 *
 * Deliberately separate from `npm test`, which is pure unit tests and needs no
 * browser. This one drives real Chromium against the exported site because the
 * things most likely to break in a static export are invisible to unit tests
 * and to the build itself:
 *
 *   - hydration mismatches (the build succeeds; the page then throws in the
 *     browser and silently re-renders — this test caught exactly that, from
 *     feature-detecting the Speech API during render)
 *   - IndexedDB not working under the export's asset paths
 *   - links to routes that only exist in the server build
 *
 * The site must already be built and served. See scripts/serve-pages.mjs.
 */
import { chromium } from 'playwright';

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:8099/Doctor').replace(/\/$/, '');

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
    : {}),
});
const page = await browser.newPage();

const jsErrors = [];
page.on('pageerror', (error) => jsErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') jsErrors.push(`console: ${message.text()}`);
});

let failures = 0;

async function check(label, fn) {
  try {
    await fn();
    console.log(`  ok    ${label}`);
  } catch (error) {
    failures++;
    console.log(`  FAIL  ${label}`);
    console.log(`        ${String(error).split('\n')[0]}`);
  }
}

console.log('notes page');
await page.goto(`${BASE}/notes/`, { waitUntil: 'networkidle' });
await check('resolves past the loading state', () =>
  page.waitForSelector('text=No voice notes yet', { timeout: 15_000 }),
);

console.log('record page');
await page.goto(`${BASE}/record/`, { waitUntil: 'networkidle' });
await check('recorder renders', () =>
  page.waitForSelector('text=Tap to start recording', { timeout: 10_000 }),
);
await check('no Credits tab, which has no route in this build', async () => {
  const count = await page.locator('nav a', { hasText: 'Credits' }).count();
  if (count !== 0) throw new Error(`found ${count} Credits links`);
});

console.log('storage round-trip');
await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('reel', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('notes', 'readwrite');
    transaction.objectStore('notes').put({
      id: 'e2e-1',
      text: 'ship the ledger migration before friday',
      tags: ['work'],
      audio: null,
      audioDurationSec: null,
      summary: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deletedAt: null,
      version: 1,
      syncState: 'local',
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
});

await page.goto(`${BASE}/notes/`, { waitUntil: 'networkidle' });
await check('stored note renders', () =>
  page.waitForSelector('text=ship the ledger migration', { timeout: 15_000 }),
);
await check('its tag renders', () =>
  page.waitForSelector('.tag-chip:has-text("work")', { timeout: 5_000 }),
);

console.log('search');
await page.fill('#note-search', 'ledger');
await check('matching query keeps the note', () =>
  page.waitForSelector('text=ship the ledger migration', { timeout: 5_000 }),
);
await page.fill('#note-search', 'zzzznomatch');
await check('non-matching query empties the list', () =>
  page.waitForSelector('text=No notes match your search', { timeout: 5_000 }),
);

console.log('analysis');
await page.goto(`${BASE}/analysis/`, { waitUntil: 'networkidle' });
await check('stats computed from stored notes', () =>
  page.waitForSelector('text=Total notes', { timeout: 15_000 }),
);
await check('stopwords filtered out of top words', async () => {
  const text = (await page.locator('[class*="word"]').allTextContents()).join(' ');
  if (!text.includes('ledger')) throw new Error('expected "ledger" among top words');
  if (/\bthe\b/.test(text)) throw new Error('stopword "the" leaked into top words');
});

await browser.close();

if (jsErrors.length) {
  console.log(`\n${jsErrors.length} JavaScript error(s):`);
  for (const error of jsErrors) console.log(`  ${error}`);
}

const failed = failures > 0 || jsErrors.length > 0;
console.log(failed ? '\nFAILED' : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
