import { EventEmitter } from 'node:events';
export const domainEvents = new EventEmitter();
domainEvents.setMaxListeners(30);

export const emitDomainEventBestEffort = (event: string, payload: unknown) => {
  try {
    domainEvents.emit(event, payload);
  } catch (error) {
    console.error(`Post-commit event publication failed for ${event}:`, error);
  }
};
