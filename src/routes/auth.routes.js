import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { signupSchema, loginSchema, refreshSchema } from './auth.schemas.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../lib/async-handler.js';

// Auth slice routes (§4). Validation middleware runs first; controllers receive clean input.
export const authRouter = Router();

authRouter.post('/signup', validate(signupSchema), asyncHandler(authController.signup));
authRouter.post('/login', validate(loginSchema), asyncHandler(authController.login));
authRouter.post('/refresh', validate(refreshSchema), asyncHandler(authController.refresh));
