/**
 * @fileoverview Tests for the webcam layer's controls (counts, freshness,
 * category filters).
 *
 * Layer: client tests (jsdom).
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {SAMPLE_INDEX} from '@/client/test_support/camera_fixtures';

import {CameraLayerControls} from './camera_layer_controls';
import {
  HIDDEN_CATEGORIES_STORAGE_KEY,
  useCategoryFilter,
} from './use_category_filter';
import type {CameraIndexState} from './use_camera_index';

/** Renders the controls wired to the real filter hook. */
function ControlsWithFilter({
  index,
}: {
  index: CameraIndexState;
}): React.JSX.Element {
  const filter = useCategoryFilter();
  return <CameraLayerControls index={index} filter={filter} />;
}

const READY: CameraIndexState = {
  status: 'ready',
  cameras: SAMPLE_INDEX,
  generatedAt: '2026-11-18T11:00:00Z',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('CameraLayerControls', () => {
  it('lists each category with its camera count', () => {
    render(<ControlsWithFilter index={READY} />);

    expect(screen.getByRole('checkbox', {name: /City\s*2/})).toBeChecked();
    expect(screen.getByRole('checkbox', {name: /Beach\s*1/})).toBeChecked();
    expect(screen.getByText('4 shown')).toBeInTheDocument();
  });

  it('hides a category and remembers the choice on this device', async () => {
    const user = userEvent.setup();
    render(<ControlsWithFilter index={READY} />);

    await user.click(screen.getByRole('checkbox', {name: /City/}));

    expect(screen.getByRole('checkbox', {name: /City/})).not.toBeChecked();
    expect(screen.getByText('2 shown')).toBeInTheDocument();
    expect(window.localStorage.getItem(HIDDEN_CATEGORIES_STORAGE_KEY)).toBe(
      '["city"]',
    );
  });

  it('restores saved choices and ignores unknown saved values', () => {
    window.localStorage.setItem(
      HIDDEN_CATEGORIES_STORAGE_KEY,
      '["beach", "volcano"]',
    );
    render(<ControlsWithFilter index={READY} />);

    expect(screen.getByRole('checkbox', {name: /Beach/})).not.toBeChecked();
    expect(screen.getByRole('checkbox', {name: /City/})).toBeChecked();
  });

  it('says how recently the camera list changed', () => {
    vi.useFakeTimers({now: new Date('2026-11-18T12:00:00Z')});
    render(<ControlsWithFilter index={READY} />);

    expect(screen.getByText('List updated 1 h ago')).toBeInTheDocument();
    expect(screen.queryByText(/stale/)).not.toBeInTheDocument();
  });

  it('flags a camera list that is days old as stale', () => {
    vi.useFakeTimers({now: new Date('2026-11-22T12:00:00Z')});
    render(<ControlsWithFilter index={READY} />);

    expect(screen.getByText('List updated 4 days ago')).toBeInTheDocument();
    expect(screen.getByText('· stale')).toBeInTheDocument();
  });

  it('shows loading and error states', () => {
    const {rerender} = render(
      <ControlsWithFilter index={{status: 'loading'}} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading cameras');

    rerender(<ControlsWithFilter index={{status: 'error'}} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load cameras",
    );
  });
});
