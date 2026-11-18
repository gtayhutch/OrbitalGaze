/**
 * @fileoverview Tests for the layer panel's category filters.
 *
 * Layer: client tests (jsdom).
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';

import {SAMPLE_INDEX} from '@/client/test_support/camera_fixtures';

import {LayerPanel} from './layer_panel';
import {
  HIDDEN_CATEGORIES_STORAGE_KEY,
  useCategoryFilter,
} from './use_category_filter';
import type {CameraIndexState} from './use_camera_index';

/** Renders the panel wired to the real filter hook. */
function PanelWithFilter({
  index,
}: {
  index: CameraIndexState;
}): React.JSX.Element {
  const filter = useCategoryFilter();
  return <LayerPanel index={index} filter={filter} />;
}

const READY: CameraIndexState = {status: 'ready', cameras: SAMPLE_INDEX};

describe('LayerPanel', () => {
  it('lists each category with its camera count', () => {
    render(<PanelWithFilter index={READY} />);

    expect(screen.getByRole('checkbox', {name: /City\s*2/})).toBeChecked();
    expect(screen.getByRole('checkbox', {name: /Beach\s*1/})).toBeChecked();
    expect(screen.getByText('4 shown')).toBeInTheDocument();
  });

  it('hides a category and remembers the choice on this device', async () => {
    const user = userEvent.setup();
    render(<PanelWithFilter index={READY} />);

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
    render(<PanelWithFilter index={READY} />);

    expect(screen.getByRole('checkbox', {name: /Beach/})).not.toBeChecked();
    expect(screen.getByRole('checkbox', {name: /City/})).toBeChecked();
  });

  it('collapses and expands', async () => {
    const user = userEvent.setup();
    render(<PanelWithFilter index={READY} />);
    const toggle = screen.getByRole('button', {name: 'Layers'});

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows loading and error states', () => {
    const {rerender} = render(<PanelWithFilter index={{status: 'loading'}} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading cameras');

    rerender(<PanelWithFilter index={{status: 'error'}} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load cameras",
    );
  });
});
