import { z } from 'zod';

export const supportTicketCategorySchema = z.enum(['GENERAL', 'ACCOUNT', 'MATCH', 'TEAM', 'PAYMENT', 'SAFETY']);
export const supportTicketStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED']);
export const supportTicketPrioritySchema = z.enum(['NORMAL', 'HIGH', 'URGENT']);
export const createSupportTicketSchema = z.object({
  subject: z.string().trim().min(5).max(140),
  category: supportTicketCategorySchema,
  message: z.string().trim().min(5).max(5000),
});
export const supportReplySchema = z.object({ content: z.string().trim().min(1).max(5000) });
export const adminSupportReplySchema = supportReplySchema.extend({ internal: z.boolean().default(false) });
export const adminSupportListQuerySchema = z.object({
  status: supportTicketStatusSchema.optional(),
  priority: supportTicketPrioritySchema.optional(),
  assignedToMe: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});
export const updateSupportTicketSchema = z.object({
  status: supportTicketStatusSchema.optional(),
  priority: supportTicketPrioritySchema.optional(),
  assignedAdminUserId: z.string().uuid().nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Submit at least one change.');
export type CreateSupportTicketInput = z.infer<typeof createSupportTicketSchema>;
export type SupportReplyInput = z.infer<typeof supportReplySchema>;
export type AdminSupportReplyInput = z.infer<typeof adminSupportReplySchema>;
export type AdminSupportListQuery = z.infer<typeof adminSupportListQuerySchema>;
export type UpdateSupportTicketInput = z.infer<typeof updateSupportTicketSchema>;
