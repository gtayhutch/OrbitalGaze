/**
 * @fileoverview Tests for the camera detail panel.
 *
 * Layer: client tests (jsdom).
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {buildCameraDetail} from '@/client/test_support/camera_fixtures';

import {CameraDetailPanel, formatCoordinates} from './camera_detail_panel';

describe('CameraDetailPanel', () => {
  it('renders nothing when no camera is selected', () => {
    const {container} = render(
      <CameraDetailPanel detail={{status: 'idle'}} onClose={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the camera, its place, and its attribution', () => {
    render(
      <CameraDetailPanel
        detail={{status: 'ready', camera: buildCameraDetail()}}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('heading', {name: 'Tokyo Tower view'}),
    ).toBeInTheDocument();
    expect(screen.getByText('Tokyo, Japan')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('Local time')).toBeInTheDocument();
    expect(screen.getByText('Courtesy of the test source')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: /Visit source/})).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );
  });

  it('says plainly when there is no live view', () => {
    render(
      <CameraDetailPanel
        detail={{status: 'ready', camera: buildCameraDetail({hasFeed: false})}}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Preview not available')).toBeInTheDocument();
  });

  it('marks offline cameras', () => {
    render(
      <CameraDetailPanel
        detail={{
          status: 'ready',
          camera: buildCameraDetail({status: 'offline'}),
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('skips the local time for an unknown time zone', () => {
    render(
      <CameraDetailPanel
        detail={{
          status: 'ready',
          camera: buildCameraDetail({timeZone: 'Not/AZone'}),
        }}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByText('Local time').nextElementSibling,
    ).toBeEmptyDOMElement();
  });

  it('moves focus to the title when it opens', () => {
    render(
      <CameraDetailPanel
        detail={{status: 'ready', camera: buildCameraDetail()}}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('heading', {name: 'Tokyo Tower view'}),
    ).toHaveFocus();
  });

  it('closes from the close button', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <CameraDetailPanel
        detail={{status: 'ready', camera: buildCameraDetail()}}
        onClose={onClose}
      />,
    );

    await user.click(
      screen.getByRole('button', {name: 'Close camera details'}),
    );

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows loading, not-found, and error states', () => {
    const {rerender} = render(
      <CameraDetailPanel
        detail={{status: 'loading', id: 'x'}}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('complementary')).toHaveAttribute(
      'aria-busy',
      'true',
    );

    rerender(
      <CameraDetailPanel
        detail={{status: 'not-found', id: 'x'}}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('heading', {name: "This camera isn't available"}),
    ).toBeInTheDocument();

    rerender(
      <CameraDetailPanel
        detail={{status: 'error', id: 'x'}}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('formatCoordinates', () => {
  it('uses hemisphere letters instead of signs', () => {
    expect(formatCoordinates(35.6762, 139.6503)).toBe(
      '35.6762° N, 139.6503° E',
    );
    expect(formatCoordinates(-33.8688, -70.5)).toBe('33.8688° S, 70.5000° W');
  });
});
