import 'dotenv/config';
import { assertDisposableTestDatabase } from '../src/database/test-database-safety.js';

assertDisposableTestDatabase({
  databaseUrl: process.env.DATABASE_URL,
  nodeEnv: process.env.NODE_ENV,
});
