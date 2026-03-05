import type { Request, Response } from 'express';
import { Router } from 'express';
import {
  getDashboardStats,
  getSessionList,
  getSessionDetailV2,
  getSkillAgentStats,
  generateSessionsCsv,
} from '../data/reader';
import type { SkillAgentStatsOptions } from '../data/types';

export function createApiRouter(): Router {
  const router = Router();

  // GET /api/stats
  router.get('/stats', (_req: Request, res: Response) => {
    try {
      res.json(getDashboardStats());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/sessions?query=&limit=&offset=
  router.get('/sessions', (req: Request, res: Response) => {
    try {
      const query  = req.query.query  as string | undefined;
      const limit  = req.query.limit  ? Number(req.query.limit)  : 50;
      const offset = req.query.offset ? Number(req.query.offset) : 0;
      res.json(getSessionList({ query, limit, offset }));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/sessions/:id
  router.get('/sessions/:id', async (req: Request, res: Response) => {
    try {
      const detail = await getSessionDetailV2(req.params.id);
      if (!detail) {
        res.status(404).json({ error: 'Session not found.' });
      } else {
        res.json(detail);
      }
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/skills?timeRange=30d&filter=my-skill
  router.get('/skills', (req: Request, res: Response) => {
    try {
      const opts: SkillAgentStatsOptions = {};
      const tr = req.query.timeRange as string | undefined;
      if (tr && tr !== 'all') {
        opts.timeRange = tr as SkillAgentStatsOptions['timeRange'];
      }
      const filter = req.query.filter as string | undefined;
      if (filter) { opts.filter = filter; }
      res.json(getSkillAgentStats(opts));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/export/csv
  router.get('/export/csv', (_req: Request, res: Response) => {
    try {
      const csv = generateSessionsCsv();
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="klawops-sessions.csv"');
      res.send(csv);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
