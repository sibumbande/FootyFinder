import { EventEmitter } from 'node:events';
export const domainEvents = new EventEmitter();
domainEvents.setMaxListeners(30);
