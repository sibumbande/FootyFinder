import type { FootballPosition } from '../../src/generated/prisma/client.js';

/** Everything the mock world creates carries one of these marks (docs/DEV_MOCK_WORLD.md). */
export const DEV_SEED = 'DEV SEED';
export const DEV_SEED_BATCH_LABEL = 'DEV SEED mock world';
export const DEV_SEED_MATCH_PREFIX = '[DEV SEED]';
export const DEV_SEED_PASSWORD = 'MockPlayer2026';
export const DEV_SEED_WALLET_CENTS = 50_000;
export const DEV_SEED_TEAM_CONTRIBUTION_CENTS = 30_000;
export const DEV_SEED_RESET_AUDIT = 'DEV_SEED_MOCK_RESET';
export const WEB_URL = 'http://localhost:5173';

export const mockEmail = (n: number) => `player${String(n).padStart(2, '0')}@footyfinder.test`;
export const mockUsername = (n: number) => `mock_player${String(n).padStart(2, '0')}`;

const NAMES = [
  'Thabo Mokoena', 'Liam van Wyk', 'Sipho Ndlovu', 'Ethan Jacobs', 'Kagiso Dlamini', 'Ruan Botha',
  'Lwazi Mthembu', 'Aidan Petersen', 'Bongani Khumalo', 'Keegan Adams', 'Mpho Sithole', 'Jaden Hendricks',
  'Themba Zulu', 'Tristan Fortuin', 'Luthando Nkosi', 'Chad Williams', 'Siyabonga Cele', 'Zaid Isaacs',
  'Neo Molefe', 'Ryan Daniels', 'Andile Mahlangu', 'Brandon Solomons', 'Kabelo Tau', 'Yusuf Davids',
  'Lebo Radebe', 'Dylan Arendse', 'Tumelo Masilela', 'Nathan Abrahams', 'Vusi Shabalala', 'Kyle Februarie',
];
const OUTFIELD: FootballPosition[][] = [['DEFENDER', 'MIDFIELDER'], ['MIDFIELDER', 'FORWARD'], ['FORWARD'], ['DEFENDER'], ['MIDFIELDER']];
export const GOALKEEPERS = new Set([1, 15, 21, 25]);

export function mockPlayer(n: number) {
  return {
    n,
    email: mockEmail(n),
    username: mockUsername(n),
    displayName: `${NAMES[n - 1]} (mock ${String(n).padStart(2, '0')})`,
    initials: NAMES[n - 1]!.split(' ').map((part) => part[0]).join(''),
    dateOfBirth: `${1991 + (n % 16)}-${String((n % 12) + 1).padStart(2, '0')}-15`,
    // CEO touch-up batch 4, item 1: every mock player is male (the names are); gender is private.
    gender: 'MALE' as const,
    yearsExperience: 1 + ((n * 7) % 15),
    positions: GOALKEEPERS.has(n) ? (['GOALKEEPER'] as FootballPosition[]) : OUTFIELD[n % OUTFIELD.length]!,
  };
}

export const TEAMS = [
  { key: 'WANDERERS', name: 'Woodstock Wanderers', members: range(1, 14), owner: 1, captain: 2, contributors: [1, 2, 3, 4, 5], locationText: 'Woodstock, Cape Town', primaryColor: '#1F4EB4', secondaryColor: '#FFD400' },
  { key: 'OBSERVATORY', name: 'Observatory United', members: range(15, 28), owner: 15, captain: 16, contributors: [15, 16, 17, 18, 19], locationText: 'Observatory, Cape Town', primaryColor: '#D7262E', secondaryColor: '#FFFFFF' },
] as const;

export function range(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

export const isDevSeedMatchName = (name: string) => name.startsWith(DEV_SEED_MATCH_PREFIX);

/** CEO touch-up batch 3 (D10): a second, clearly labelled mock venue so the home carousel can be swiped locally. */
export const DEV_SEED_VENUE_SLUG = 'dev-seed-mock-green-point-astro';
export const DEV_SEED_VENUE_NAME = 'Mock: Green Point Astro';
