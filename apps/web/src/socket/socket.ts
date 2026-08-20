import { io } from 'socket.io-client';
export const socket = io(import.meta.env.VITE_API_URL ?? 'http://localhost:3000', {
  withCredentials: true,
  autoConnect: false,
});
export const ensureSocketConnected = () => {
  if (!socket.connected) socket.connect();
  return socket;
};
