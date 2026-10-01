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

describe('OnboardingPage selfie step (CEO batch 2, item 4)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks for a selfie in plain words, without technical wording', () => {
    const { container } = renderPage();
    expect(screen.getByRole('heading', { name: '3. Upload a selfie' })).toBeInTheDocument();
    expect(screen.getByText('Take or upload a clear selfie showing your full face. Teammates and referees use it to recognise you.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload selfie' })).toBeDisabled();
    expect(container.textContent).not.toMatch(/normali[sz]|orientation|JPEG|5 MB|256/i);
  });

  it('offers only the photo picker on a desktop', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }));
    renderPage();
    expect(screen.getByLabelText('Choose a selfie from your photos')).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
    expect(screen.queryByLabelText('Take a selfie with your camera')).not.toBeInTheDocument();
  });

  it('offers the front camera as well as the gallery on a phone', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)', media: query }));
    renderPage();
    expect(screen.getByLabelText('Take a selfie with your camera')).toHaveAttribute('capture', 'user');
    expect(screen.getByText('Choose from gallery')).toBeInTheDocument();
    expect(screen.getByLabelText('Choose a selfie from your photos')).not.toHaveAttribute('capture');
  });
});
