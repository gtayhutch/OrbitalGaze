/**
 * @fileoverview Tests for the webcam provider's credit.
 *
 * Layer: client tests (jsdom).
 */
import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {WebcamCredit} from './webcam_credit';

describe('WebcamCredit', () => {
  it('credits windy.com with the two links its terms ask for', () => {
    const {container} = render(<WebcamCredit />);

    expect(container).toHaveTextContent(
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
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });
});
