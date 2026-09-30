import { vi } from 'vitest';

/** Gate 9: a quiet stand-in for the social hooks in tests that render without a QueryClient. */
const idle = { data: undefined, isPending: false, error: null };
export const socialHooksMock: Record<string, unknown> = {
  socialKey: ['social'],
  relationshipKey: (userId: string) => ['social', 'relationship', userId],
  loadRelationship: vi.fn(),
  useRelationship: () => idle,
  useSocialSummary: () => idle,
  useDiscover: () => idle,
  useFriends: () => idle,
  useFriendRequests: () => idle,
  useBlocks: () => ({ ...idle, data: [] }),
  useSocialSettings: () => idle,
  usePlayedWith: () => idle,
  useFriendAction: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useUpdateSocialSettings: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useAddAll: () => ({ mutate: vi.fn(), isPending: false, error: null, data: undefined }),
};
