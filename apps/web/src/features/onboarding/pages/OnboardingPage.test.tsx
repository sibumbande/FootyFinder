import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingPage } from './OnboardingPage.js';

const { mutation, status } = vi.hoisted(() => ({
  mutation: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, error: null }),
  // One stable object: the page re-syncs its form whenever the user object changes.
  status: {
    isPending: false,
    data: {
      user: { email: 'sam@test.invalid', emailVerified: true, dateOfBirth: null, yearsExperience: null, city: null, preferredPositions: [], onboardingComplete: false },
      missing: ['PHOTO'],
      canComplete: false,
    },
  },
}));
vi.mock('@/features/auth/hooks/useAuth.js', () => ({ useResendVerification: mutation }));
vi.mock('../hooks/useOnboarding.js', () => ({
  useOnboardingStatus: () => status,
  useCities: () => ({ data: undefined }),
  useLegalDocuments: () => ({ data: undefined }),
  useSaveOnboardingProfile: mutation,
  useUploadPlayerPhoto: mutation,
  useAcceptLegal: mutation,
  useCompleteOnboarding: mutation,
  useJoinCityInterest: mutation,
}));

afterEach(cleanup);

const renderPage = () => render(<MemoryRouter><OnboardingPage /></MemoryRouter>);

describe('OnboardingPage player details (CEO batch 2, item 3)', () => {
  it('renders date of birth and years of experience as matching fields, each with a hint', () => {
    renderPage();
    const dateOfBirth = screen.getByLabelText('Date of birth');
    const experience = screen.getByLabelText('Whole years of experience');
    expect(experience.className).toBe(dateOfBirth.className);
    expect(dateOfBirth).toHaveAccessibleDescription('Stored privately for 18+ enforcement.');
    expect(experience).toHaveAccessibleDescription("Whole years you've played football.");
  });
});
