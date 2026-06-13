/**
 * Dev/CI web server: boots RevenueTwin and serves the web/ console + REST API on :8787.
 * Used by playwright.config.ts (webServer) and for local manual demo (npm run serve:web).
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { bootstrap } from '../src/app/bootstrap.ts';
import { createApiServer } from '../src/app/server.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../web');
const port = Number(process.env.PORT ?? 8787);

const { app, users } = await bootstrap({});
const server = createApiServer({ app, users, webRoot });
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log('RevenueTwin serving on http://127.0.0.1:' + port);
});
