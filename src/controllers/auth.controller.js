import * as authService from '../services/auth.service.js';

// HTTP boundary for auth (§4). Request bodies are already validated + normalized by the
// zod middleware, so controllers just call the service and shape the response.

export async function signup(req, res) {
  const result = await authService.signup(req.body);
  res.status(201).json(result);
}

export async function login(req, res) {
  const result = await authService.login(req.body);
  res.status(200).json(result);
}

export async function refresh(req, res) {
  const result = await authService.refresh(req.body);
  res.status(200).json(result);
}
