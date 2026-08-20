import { z } from 'zod';

const optionalName = z
  .string()
  .max(80, 'Keep this under 80 characters')
  .refine(
    (value) => value.length === 0 || value.trim().length > 0,
    'Name cannot contain only spaces',
  )
  .refine((value) => value.length === 0 || /\p{L}/u.test(value), 'Enter a valid name')
  .transform((value) => value.trim() || undefined)
  .optional();

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .email('Enter a valid email address')
  .max(254, 'Email is too long')
  .transform((value) => value.toLowerCase());

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(30, 'Username must be at most 30 characters')
  .regex(/^[a-zA-Z0-9_]+$/, 'Use only letters, numbers, and underscores')
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  firstName: optionalName,
  lastName: optionalName,
  password: passwordSchema,
});

export const registerFormSchema = registerSchema
  .extend({ confirmPassword: z.string().min(1, 'Confirm your password') })
  .superRefine(({ password, confirmPassword }, context) => {
    if (password !== confirmPassword) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirmPassword'],
        message: 'Passwords do not match',
      });
    }
  });

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Email or username is required').max(254),
  password: z.string().min(1, 'Password is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type RegisterFormInput = z.infer<typeof registerFormSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
