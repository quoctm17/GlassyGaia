import { Router, cors, error, withParams } from 'itty-router';
import { registerAuthRoutes } from './handlers/auth.js';
import { registerSearchRoutes } from './handlers/search.js';
import { registerR2Routes } from './handlers/r2.js';
import { registerMediaRoutes } from './handlers/media.js';
import { registerItemRoutes } from './handlers/items.js';
import { registerCardRoutes } from './handlers/cards.js';
import { registerCategoryRoutes } from './handlers/categories.js';
import { registerImportRoutes } from './handlers/import.js';
import { registerProgressRoutes } from './handlers/progress.js';
import { registerCardOpsRoutes } from './handlers/cardOps.js';
import { registerUserRoutes } from './handlers/user.js';
import { registerContentRoutes } from './handlers/content.js';
import { registerCommentRoutes } from './handlers/comments.js';
import { registerUsersRoutes } from './handlers/users.js';
import { registerAdminRoutes } from './handlers/admin.js';
import { resetDailyTables } from './services/scheduled.js';

const { preflight, corsify } = cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  headers: ['Content-Type', 'Authorization'],
  maxAge: 86400,
});

const router = Router({
  before: [preflight, withParams],
  catch: (err) => error(500, { error: err.message }),
  finally: [(response) => {
    if (response?.headers) {
      response.headers.set('Cross-Origin-Opener-Policy', 'unsafe-none');
      response.headers.set('Cross-Origin-Embedder-Policy', 'unsafe-none');
    }
    return response;
  }, corsify],
});

registerAuthRoutes(router);
registerSearchRoutes(router);
registerR2Routes(router);
registerMediaRoutes(router);
registerItemRoutes(router);
registerCardRoutes(router);
registerCategoryRoutes(router);
registerImportRoutes(router);
registerProgressRoutes(router);
registerCardOpsRoutes(router);
registerUserRoutes(router);
registerContentRoutes(router);
registerCommentRoutes(router);
registerUsersRoutes(router);
registerAdminRoutes(router);

router.all('*', () => error(404, 'Not found'));

export default {
  fetch: (request, env, ctx) => router.fetch(request, env, ctx),
  scheduled: (event, env, ctx) => ctx.waitUntil(resetDailyTables(env)),
};
