import { describe, expect, it } from 'vitest';
import { devMockRefusal } from './guard.js';

const ok = 'postgresql://postgres:pw@localhost:5432/footy_finder?schema=public';

describe('dev mock world safety lock', () => {
  it('allows only the local footy_finder database', () => {
    expect(devMockRefusal({ DATABASE_URL: ok, NODE_ENV: 'development' })).toBeNull();
    expect(devMockRefusal({ DATABASE_URL: ok.replace('localhost', '127.0.0.1') })).toBeNull();
  });

  it('refuses the smoke database, other names, remote hosts and production', () => {
    expect(devMockRefusal({ DATABASE_URL: ok.replace('footy_finder?', 'footy_finder_test?') })).toMatch(/footy_finder_test/);
    expect(devMockRefusal({ DATABASE_URL: ok.replace('footy_finder?', 'Footy_Finder?') })).toMatch(/not exactly/);
    expect(devMockRefusal({ DATABASE_URL: ok.replace('localhost', 'db.example.com') })).toMatch(/not localhost/);
    expect(devMockRefusal({ DATABASE_URL: ok.replace('localhost', 'localhost.evil.com') })).toMatch(/not localhost/);
    expect(devMockRefusal({ DATABASE_URL: ok, NODE_ENV: 'production' })).toMatch(/production/);
    expect(devMockRefusal({ DATABASE_URL: ok, EMAIL_PROVIDER: 'postmark' })).toMatch(/postmark/);
    expect(devMockRefusal({})).toMatch(/not set/);
    expect(devMockRefusal({ DATABASE_URL: 'mysql://localhost/footy_finder' })).toMatch(/PostgreSQL/);
  });
});
