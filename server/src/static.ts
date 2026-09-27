import { basename, extname, join, sep } from 'node:path';
import express, { Router } from 'express';

/**
 * Serves the built client (client/dist) in production. Vite's hashed files in
 * /assets are cached forever; index.html is always revalidated so a deploy is
 * picked up immediately. Extension-less GET paths fall back to index.html (SPA);
 * a missing file with an extension is a plain 404, never HTML.
 */
export function clientStatic(distDir: string): Router {
  const router = Router();
  const assetsDir = join(distDir, 'assets');

  router.use(
    express.static(distDir, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.startsWith(assetsDir + sep)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else if (basename(filePath) === 'index.html') res.setHeader('Cache-Control', 'no-cache');
        else res.setHeader('Cache-Control', 'public, max-age=3600');
      },
    }),
  );

  router.use((req, res, next) => {
    // /api never gets here: the API router answers unknown API routes with a JSON 404.
    const isPageRequest = (req.method === 'GET' || req.method === 'HEAD') && extname(req.path) === '';
    if (!isPageRequest) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    // With `root`, send's dotfile check covers only 'index.html', not the install path
    // (a dist under e.g. ~/.local or .claude/worktrees would otherwise be a 404).
    res.sendFile('index.html', { root: distDir }, (error) => {
      if (!error) return;
      if (res.headersSent) next(error);
      else res.status(404).type('text/plain').send('Client build not found. Run `npm run build`.');
    });
  });

  return router;
}
