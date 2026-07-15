import { Router } from 'express';
import { healthCheck } from '../controllers/health.controller.js';
import { authRouter } from './auth.routes.js';

// Top-level router. Feature routers are mounted here as slices land.
export const router = Router();

router.get('/healthz', healthCheck);
router.use('/auth', authRouter);
