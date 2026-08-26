import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from './Input.js';

describe('Input', () => {
  it('links generated input IDs to both guidance and validation feedback', () => {
    render(<Input label="Kickoff name" hint="Shown in discovery" error="Name is required" />);

    const input = screen.getByLabelText('Kickoff name');
    const hint = screen.getByText('Shown in discovery');
    const error = screen.getByText('Name is required');

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', `${hint.id} ${error.id}`);
    expect(hint.id).not.toBe('');
    expect(error.id).not.toBe('');
  });
});
