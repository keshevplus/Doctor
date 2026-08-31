/**
 * Build the GitHub Pages bundle.
 *
 *     BASE_PATH=/Doctor node scripts/build-pages.mjs
 *
 * GitHub Pages serves files and nothing else — no Node runtime, no request
 * handlers, no database, nowhere to keep a secret. So this produces a static
 * export of the local-first half of Reel only: recording, notes, analysis and
 * export, all of which run in the browser against IndexedDB.
 *
 * The server-only surfaces are physically moved out of the way before the
 * build rather than stubbed. Two reasons:
 *
 *   1. `output: 'export'` refuses to build route handlers at all, so they
 *      cannot simply be left in place.
 *   2. A stub would let a dead sign-in button or a checkout that silently
 *      fails ship to users. Removing the route means the tab is gone and the
 *      links point at the real deployment instead.
 *
 * Everything is restored afterwards, including when the build fails — the
 * working tree must never be left half-dismantled.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const stashDir = join(root, '.pages-build-stash');

/** Paths excluded from the static build. */
const SERVER_ONLY = [
  'app/api', // route handlers: auth, checkout, webhook, cron
  'app/(app)', // the auth-gated segment: billing
  'app/signin', // sign-in relies on Auth.js server actions
  'middleware.ts', // no edge runtime on Pages
];

/** Flattened so nested paths cannot collide inside the stash. */
const stashPath = (relative) => join(stashDir, relative.replace(/[/\\]/g, '__'));

function stash() {
  for (const relative of SERVER_ONLY) {
    const from = join(root, relative);
    if (existsSync(from)) renameSync(from, stashPath(relative));
  }
}

function restore() {
  for (const relative of SERVER_ONLY) {
    const from = stashPath(relative);
    if (existsSync(from)) renameSync(from, join(root, relative));
  }
  rmSync(stashDir, { recursive: true, force: true });
}

rmSync(stashDir, { recursive: true, force: true });
mkdirSync(stashDir, { recursive: true });

// A .next directory left by a normal build still lists the routes we are about
// to stash. Clear it so the export starts from a clean manifest.
rmSync(join(root, '.next'), { recursive: true, force: true });
rmSync(join(root, 'out'), { recursive: true, force: true });

let failed = false;
try {
  stash();

  execFileSync('npx', ['next', 'build'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      STATIC_EXPORT: '1',
      NEXT_PUBLIC_STATIC_BUILD: '1',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  });
} catch {
  // execFileSync already streamed the compiler's own diagnostics to stderr;
  // repeating its generic "command failed" message on top would only bury them.
  failed = true;
  console.error('\nStatic build failed — see the output above.');
} finally {
  restore();
}

if (failed) process.exit(1);

// Pages pipes the output through Jekyll unless told otherwise, and Jekyll
// drops directories beginning with an underscore — which is every Next.js
// asset directory.
writeFileSync(join(root, 'out', '.nojekyll'), '');

console.log('\nStatic site written to out/');
