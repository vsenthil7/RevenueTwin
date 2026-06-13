/** Serve the web control room + REST API on :4173 (Makefile `serve`). Thin wrapper over the same
 * boot path as scripts/serve-web.ts; honours PORT (default 4173). */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { bootstrap } from '../src/app/bootstrap.ts';
import { createApiServer } from '../src/app/server.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../web');
const port = Number(process.env.PORT ?? 4173);
const { app, users } = await bootstrap({});
createApiServer({ app, users, webRoot }).listen(port, () => {
  // eslint-disable-next-line no-console
  console.log('RevenueTwin control room on http://127.0.0.1:' + port);
});
