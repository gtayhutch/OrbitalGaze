/**
 * @fileoverview Tests for the grouped layer panel.
 *
 * Layer: client tests (jsdom).
 */
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';

import {LayerPanel} from './layer_panel';
import {LAYER_CHOICES_STORAGE_KEY, useActiveLayers} from './use_active_layers';

/** Renders the panel wired to the real active-layers hook. */
function PanelWithLayers({
  withControls = false,
}: {
  withControls?: boolean;
}): React.JSX.Element {
  const activeLayers = useActiveLayers();
  return (
    <LayerPanel
      activeLayers={activeLayers}
      layerControls={
        withControls ? {webcams: <p>Webcam category filters</p>} : {}
      }
    />
  );
}

describe('LayerPanel', () => {
  it('lists layers by group with a switch, name, and summary', () => {
    render(<PanelWithLayers />);

    const cameras = screen.getByRole('region', {name: 'Cameras'});
    const webcams = within(cameras).getByRole('switch', {
      name: 'Public webcams',
    });
    expect(webcams).toBeChecked();
    expect(webcams).toHaveAccessibleDescription(
      'Live views from public webcams around the world.',
    );
  });

  it('counts how many layers are on', () => {
    render(<PanelWithLayers />);

    expect(screen.getByRole('button', {name: /^Layers/})).toHaveTextContent(
      'Layers1 of 2 on',
    );
  });

  it('switches a layer off, hides its controls, and remembers the choice', async () => {
    const user = userEvent.setup();
    render(<PanelWithLayers withControls />);
    expect(screen.getByText('Webcam category filters')).toBeInTheDocument();

    await user.click(screen.getByRole('switch', {name: 'Public webcams'}));

    expect(
      screen.getByRole('switch', {name: 'Public webcams'}),
    ).not.toBeChecked();
    expect(
      screen.queryByText('Webcam category filters'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: /^Layers/})).toHaveTextContent(
      '0 of 2 on',
    );
    expect(window.localStorage.getItem(LAYER_CHOICES_STORAGE_KEY)).toBe(
      '{"webcams":false}',
    );
  });

  it('collapses and expands', async () => {
    const user = userEvent.setup();
    render(<PanelWithLayers />);
    const toggle = screen.getByRole('button', {name: /^Layers/});

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
