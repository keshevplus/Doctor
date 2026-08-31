/**
 * Serve the static export the way GitHub Pages will, for local checking and
 * for the e2e smoke test.
 *
 *     npm run build:pages && npm run serve:pages
 *
 * The one thing that matters here is the base path: a project Pages site lives
 * at /<repo>, not at the root, so serving out/ directly would hide every
 * broken asset URL. This mounts the export under BASE_PATH so the local URLs
 * match the deployed ones exactly.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = join(process.cwd(), 'out');
const basePath = (process.env.BASE_PATH ?? '/Doctor').replace(/\/$/, '');
const port = Number(process.env.PORT ?? 8099);

if (!existsSync(root)) {
  console.error('No out/ directory. Run: npm run build:pages');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || '/';
  } else if (basePath && pathname !== '/') {
    response.writeHead(404).end('Not found (outside base path)');
    return;
  }

  // Contain traversal: resolve, then confirm the result is still under out/.
  let filePath = join(root, normalize(pathname));
  if (!filePath.startsWith(root)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html');
  }

  if (!existsSync(filePath)) {
    const notFound = join(root, '404.html');
    if (existsSync(notFound)) {
      response.writeHead(404, { 'Content-Type': MIME['.html'] });
      createReadStream(notFound).pipe(response);
      return;
    }
    response.writeHead(404).end('Not found');
    return;
  }

  response.writeHead(200, {
    'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
  });
  createReadStream(filePath).pipe(response);
}).listen(port, () => {
  console.log(`Serving out/ at http://localhost:${port}${basePath}/`);
});
