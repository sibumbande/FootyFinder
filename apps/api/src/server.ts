import { createServer } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { createSocketServer } from './socket/create-socket-server.js';

const server = createServer(app);
createSocketServer(server);
server.listen(env.PORT, () => console.log(`API listening on http://localhost:${env.PORT}`));
