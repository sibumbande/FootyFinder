import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MatchRefereeLine } from './MatchRefereeLine.js';

describe('MatchRefereeLine (Gate 8 / D18)', () => {
  afterEach(cleanup);

  it('shows the assigned referee by display name', () => {
    render(<MatchRefereeLine referee={{ id: 'r1', displayName: 'Sam Ref' }} goNoGoAt="2026-10-30T11:30:00.000Z" status="OPEN" />);
    expect(screen.getByTestId('match-referee')).toHaveTextContent('FootyFinder referee: Sam Ref');
  });

  it('says the referee is still to be confirmed', () => {
    render(<MatchRefereeLine referee={null} goNoGoAt="2026-10-30T11:30:00.000Z" status="OPEN" />);
    expect(screen.getByTestId('match-referee')).toHaveTextContent('FootyFinder referee: to be confirmed');
  });

  it('renders nothing for legacy matches and cancelled matches', () => {
    const { container, rerender } = render(<MatchRefereeLine referee={null} status="OPEN" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<MatchRefereeLine referee={{ id: 'r1', displayName: 'Sam Ref' }} goNoGoAt="2026-10-30T11:30:00.000Z" status="CANCELLED" />);
    expect(container).toBeEmptyDOMElement();
  });
});
