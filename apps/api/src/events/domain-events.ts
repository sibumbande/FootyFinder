import { EventEmitter } from 'node:events';
import { logError } from '../observability/logger.js';
export const domainEvents = new EventEmitter();
domainEvents.setMaxListeners(30);

export const emitDomainEventBestEffort = (event: string, payload: unknown) => {
  try {
    domainEvents.emit(event, payload);
  } catch (error) {
    logError('post_commit_event_failed', error, { domainEvent: event });
  }
};
