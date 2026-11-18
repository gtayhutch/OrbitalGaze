/**
 * @fileoverview Tests for the data credits shown for active layers.
 *
 * Layer: client tests (jsdom).
 */
import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {CreditBar} from './credit_bar';

describe('CreditBar', () => {
  it('credits windy.com with the two links its terms ask for while webcams are on', () => {
    render(<CreditBar active={new Set(['webcams'] as const)} />);

    expect(screen.getByRole('list', {name: 'Data credits'})).toHaveTextContent(
      'Webcams provided by windy.com — add a webcam',
    );
    expect(screen.getByRole('link', {name: 'windy.com'})).toHaveAttribute(
      'href',
      'https://www.windy.com/',
    );
    expect(screen.getByRole('link', {name: 'add a webcam'})).toHaveAttribute(
      'href',
      'https://www.windy.com/webcams/add',
    );
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('shows nothing when no layer is on', () => {
    const {container} = render(<CreditBar active={new Set()} />);

    expect(container).toBeEmptyDOMElement();
  });
});
