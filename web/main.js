// Browser entrypoint. Imported only by index.html; kept logic-free so app.js stays unit-testable.
import * as api from './api.js';
import { mountLive, mount } from './app.js';

mountLive(document, { api, baseUrl: '', userId: 'cfo' }).catch(() => mount(document));
