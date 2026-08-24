import type {
  AdminSupportListQuery,
  AdminSupportReplyInput,
  CreateSupportTicketInput,
  SupportTicket,
  SupportTicketStatus,
  SupportReplyInput,
  UpdateSupportTicketInput,
} from '@footy-finder/shared';
import { randomBytes } from 'node:crypto';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import { persistNotifications, notificationDedupeKey } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { toPublicUser } from '../users/user.mapper.js';
import { appendAdminAudit } from '../admin/admin-audit.js';

const safeUser = { profile: { include: { preferredPositions: true } } } as const;
const detailInclude = {
  createdBy: { include: safeUser },
  assignedAdmin: { include: safeUser },
  messages: { include: { author: { include: safeUser } }, orderBy: { createdAt: 'asc' as const } },
} as const;
const summaryInclude = { createdBy: { include: safeUser }, assignedAdmin: { include: safeUser } } as const;

export const supportTicketDto = (ticket: any, exposeInternal: boolean): SupportTicket => ({
  id: ticket.id,
  referenceCode: ticket.referenceCode,
  subject: ticket.subject,
  category: ticket.category,
  status: ticket.status,
  priority: ticket.priority,
  lastMessageAt: ticket.lastMessageAt.toISOString(),
  ...(ticket.resolvedAt ? { resolvedAt: ticket.resolvedAt.toISOString() } : {}),
  ...(ticket.closedAt ? { closedAt: ticket.closedAt.toISOString() } : {}),
  createdAt: ticket.createdAt.toISOString(),
  updatedAt: ticket.updatedAt.toISOString(),
  createdBy: toPublicUser(ticket.createdBy),
  ...(ticket.assignedAdmin ? { assignedAdmin: toPublicUser(ticket.assignedAdmin) } : {}),
  ...(ticket.messages ? {
    messages: ticket.messages
      .filter((message: any) => exposeInternal || !message.internal)
      .map((message: any) => ({
        id: message.id,
        content: message.content,
        authorRole: message.authorRole,
        internal: exposeInternal ? message.internal : false,
        createdAt: message.createdAt.toISOString(),
        author: toPublicUser(message.author),
      })),
  } : {}),
});

export const assertSupportTicketOpen = (status: SupportTicketStatus) => {
  if (status === 'CLOSED')
    throw new AppError(409, 'This support ticket is closed.', 'SUPPORT_TICKET_CLOSED');
};

export class SupportService {
  constructor(private readonly notifications = new NotificationsService()) {}

  async create(userId: string, input: CreateSupportTicketInput) {
    const referenceCode = `FF-${new Date().getUTCFullYear()}-${randomBytes(5).toString('hex').toUpperCase()}`;
    const ticket = await serializableTransaction((tx) => tx.supportTicket.create({
      data: {
        referenceCode,
        createdByUserId: userId,
        subject: input.subject,
        category: input.category,
        messages: { create: { authorUserId: userId, authorRole: 'USER', content: input.message } },
      },
      include: detailInclude,
    }));
    return supportTicketDto(ticket, false);
  }

  async listMine(userId: string) {
    return (await prisma.supportTicket.findMany({
      where: { createdByUserId: userId },
      include: summaryInclude,
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    })).map((ticket) => supportTicketDto(ticket, false));
  }

  async getMine(ticketId: string, userId: string) {
    const ticket = await prisma.supportTicket.findFirst({ where: { id: ticketId, createdByUserId: userId }, include: detailInclude });
    if (!ticket) throw new AppError(404, 'Support ticket not found.', 'SUPPORT_TICKET_NOT_FOUND');
    return supportTicketDto(ticket, false);
  }

  async replyMine(ticketId: string, userId: string, input: SupportReplyInput) {
    const ticket = await serializableTransaction(async (tx) => {
      const current = await tx.supportTicket.findFirst({ where: { id: ticketId, createdByUserId: userId } });
      if (!current) throw new AppError(404, 'Support ticket not found.', 'SUPPORT_TICKET_NOT_FOUND');
      assertSupportTicketOpen(current.status);
      const now = new Date();
      await tx.supportTicketMessage.create({ data: { ticketId, authorUserId: userId, authorRole: 'USER', content: input.content } });
      return tx.supportTicket.update({ where: { id: ticketId }, data: { status: 'OPEN', resolvedAt: null, lastMessageAt: now }, include: detailInclude });
    });
    return supportTicketDto(ticket, false);
  }

  async listAdmin(query: AdminSupportListQuery, adminUserId: string) {
    const tickets = (await prisma.supportTicket.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.priority ? { priority: query.priority } : {}),
        ...(query.assignedToMe !== undefined ? { assignedAdminUserId: query.assignedToMe ? adminUserId : null } : {}),
      },
      include: summaryInclude,
      orderBy: { lastMessageAt: 'desc' },
      take: 200,
    })).map((ticket) => supportTicketDto(ticket, true));
    const priorityRank = { URGENT: 0, HIGH: 1, NORMAL: 2 } as const;
    return tickets.sort((left, right) =>
      priorityRank[left.priority] - priorityRank[right.priority] ||
      Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt),
    );
  }

  async getAdmin(ticketId: string) {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId }, include: detailInclude });
    if (!ticket) throw new AppError(404, 'Support ticket not found.', 'SUPPORT_TICKET_NOT_FOUND');
    return supportTicketDto(ticket, true);
  }

  async replyAdmin(ticketId: string, adminUserId: string, input: AdminSupportReplyInput, requestId?: string) {
    const result = await serializableTransaction(async (tx) => {
      const current = await tx.supportTicket.findUnique({ where: { id: ticketId } });
      if (!current) throw new AppError(404, 'Support ticket not found.', 'SUPPORT_TICKET_NOT_FOUND');
      assertSupportTicketOpen(current.status);
      const now = new Date();
      const message = await tx.supportTicketMessage.create({ data: { ticketId, authorUserId: adminUserId, authorRole: 'ADMIN', content: input.content, internal: input.internal } });
      const ticket = await tx.supportTicket.update({
        where: { id: ticketId },
        data: { lastMessageAt: now, ...(!input.internal ? { status: 'WAITING_ON_USER' as const } : {}) },
        include: detailInclude,
      });
      await appendAdminAudit(tx, { actorUserId: adminUserId, action: input.internal ? 'SUPPORT_INTERNAL_NOTE_ADDED' : 'SUPPORT_REPLY_SENT', entityType: 'SUPPORT_TICKET', entityId: ticketId, requestId, metadata: { referenceCode: current.referenceCode } });
      const notifications = input.internal ? [] : await persistNotifications(tx, [{
        userId: current.createdByUserId,
        type: 'SUPPORT_REPLY',
        title: 'Support replied',
        message: `There is a new reply on ${current.referenceCode}.`,
        targetPath: `/support/${ticketId}`,
        dedupeKey: notificationDedupeKey('support-reply', message.id),
      }]);
      return { ticket, notifications };
    });
    this.notifications.publishPersistedMany(result.notifications);
    return supportTicketDto(result.ticket, true);
  }

  async updateAdmin(ticketId: string, adminUserId: string, input: UpdateSupportTicketInput, requestId?: string) {
    const ticket = await serializableTransaction(async (tx) => {
      const current = await tx.supportTicket.findUnique({ where: { id: ticketId } });
      if (!current) throw new AppError(404, 'Support ticket not found.', 'SUPPORT_TICKET_NOT_FOUND');
      if (input.assignedAdminUserId) {
        const assignee = await tx.user.findFirst({ where: { id: input.assignedAdminUserId, platformRole: 'ADMIN', accountStatus: 'ACTIVE' }, select: { id: true } });
        if (!assignee) throw new AppError(400, 'Choose an active platform administrator.', 'SUPPORT_ASSIGNEE_INVALID');
      }
      const now = new Date();
      const status = input.status ?? current.status;
      const updated = await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          ...input,
          resolvedAt:
            status === 'RESOLVED'
              ? current.resolvedAt ?? now
              : status === 'CLOSED'
                ? current.resolvedAt
                : null,
          closedAt: status === 'CLOSED' ? current.closedAt ?? now : null,
        },
        include: detailInclude,
      });
      await appendAdminAudit(tx, { actorUserId: adminUserId, action: 'SUPPORT_TICKET_UPDATED', entityType: 'SUPPORT_TICKET', entityId: ticketId, requestId, metadata: { status: updated.status, priority: updated.priority, assignedAdminUserId: updated.assignedAdminUserId } });
      return updated;
    });
    return supportTicketDto(ticket, true);
  }
}
