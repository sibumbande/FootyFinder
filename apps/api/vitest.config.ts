import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { env: { DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/footy_finder_test?schema=public', JWT_SECRET: 'test-secret-that-is-at-least-thirty-two-characters', CLIENT_URL: 'http://localhost:5173', NODE_ENV: 'test' } } });
