import { z } from 'zod';

// Normalize then validate: trim + lowercase, then require a valid email (§4, R-2).
const email = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .pipe(z.string().email('Must be a valid email'));

// Signup password rules (§4.1): min 8, max 72, at least one letter and one digit.
// Max 72 because bcrypt only considers the first 72 bytes and silently truncates the
// rest — we reject rather than truncate (§4.1 rationale).
const signupPassword = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/\d/, 'Password must contain at least one digit');

export const signupSchema = z
  .object({ email, password: signupPassword })
  .strict();

// Login only checks presence; full complexity is enforced at signup, not login (§4.2).
export const loginSchema = z
  .object({
    email,
    password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
  })
  .strict();

export const refreshSchema = z
  .object({
    refreshToken: z
      .string({ required_error: 'refreshToken is required' })
      .min(1, 'refreshToken is required'),
  })
  .strict();
