import { Router } from 'express';
import { healthCheck } from '../controllers/health.controller.js';

// Top-level router. Feature routers (auth, etc.) will be mounted here as slices land.
export const router = Router();

router.get('/healthz', healthCheck);
