/**
 * @fileoverview Tests for the share button and the share link.
 *
 * Layer: client tests (jsdom).
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {ShareButton} from './share_button';
import {buildShareUrl} from './share_url';

const LINK =
  'https://orbitalgaze.com/?view=1_0_0_1000_0.0_-90.0&layers=webcams';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ShareButton', () => {
  it('copies the link and says so', async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    render(<ShareButton getShareUrl={() => LINK} />);

    await user.click(screen.getByRole('button', {name: 'Share this view'}));

    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(await screen.findByRole('status')).toHaveTextContent('Link copied');
  });

  it('shows the link, selected, when the clipboard is refused', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new Error('denied'),
    );
    render(<ShareButton getShareUrl={() => LINK} />);

    await user.click(screen.getByRole('button', {name: 'Share this view'}));

    const field = await screen.findByLabelText('Copy this link');
    expect(field).toHaveValue(LINK);
    expect(field).toHaveFocus();
  });
});

describe('buildShareUrl', () => {
  it('adds the active layers and keeps the view readable', () => {
    expect(
      buildShareUrl(
        'https://orbitalgaze.com/?view=1_0_0_1000_0.0_-90.0&camera=cam-1',
        new Set(['webcams'] as const),
      ),
    ).toBe(
      'https://orbitalgaze.com/?view=1_0_0_1000_0.0_-90.0&camera=cam-1&layers=webcams',
    );
  });

  it('shares "no layers" as an empty value', () => {
    expect(buildShareUrl('https://orbitalgaze.com/', new Set())).toBe(
      'https://orbitalgaze.com/?layers=',
    );
  });
});
