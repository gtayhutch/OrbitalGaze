/**
 * @fileoverview Tests for the camera preview: image, players, and refreshes.
 *
 * Layer: client tests (jsdom). The API is stubbed; images never load in
 * jsdom, so load failures are simulated with `fireEvent.error`.
 */
import {act, fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  buildCameraDetail,
  buildCameraFeed,
} from '@/client/test_support/camera_fixtures';
import {apiError, ok, stubApi} from '@/client/test_support/fake_api';

import {CameraPreview} from './camera_preview';

/** The feed path for the fixture camera. */
const FEED_PATH = '/api/v1/cameras/cam-1/feed';

/** A camera that has a feed. */
const cameraWithFeed = buildCameraDetail({hasFeed: true});

/** How many times the feed was requested. */
function feedRequests(stub: ReturnType<typeof stubApi>): number {
  return stub.mock.calls.filter(([input]) => String(input).endsWith(FEED_PATH))
    .length;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('CameraPreview', () => {
  it('says there is no preview, without asking the server, when the camera has no feed', () => {
    const stub = stubApi({});

    render(<CameraPreview camera={buildCameraDetail({hasFeed: false})} />);

    expect(screen.getByText('Preview not available')).toBeInTheDocument();
    expect(feedRequests(stub)).toBe(0);
  });

  it('shows the latest image, unstretched, linked to the camera page on windy.com', async () => {
    const feed = buildCameraFeed();
    stubApi({[FEED_PATH]: ok(feed)});

    render(<CameraPreview camera={cameraWithFeed} />);

    const image = await screen.findByRole('img', {
      name: 'Latest image from Tokyo Tower view',
    });
    expect(image).toHaveAttribute('src', feed.imageUrl);
    expect(image).toHaveAttribute('width', '400');
    expect(image).toHaveClass('max-w-full', 'h-auto');
    const link = image.closest('a');
    expect(link).toHaveAttribute('href', feed.pageUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('loads the timelapse player only when asked, in a sandboxed frame', async () => {
    const feed = buildCameraFeed();
    stubApi({[FEED_PATH]: ok(feed)});
    const user = userEvent.setup();
    const {container} = render(<CameraPreview camera={cameraWithFeed} />);
    await screen.findByRole('img');
    expect(container.querySelector('iframe')).toBeNull();
    expect(
      screen.queryByRole('button', {name: 'Watch live'}),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', {name: "Watch today's timelapse"}),
    );

    const player = screen.getByTitle('Timelapse of Tokyo Tower view');
    expect(player).toHaveAttribute('src', feed.timelapseUrl);
    expect(player).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-popups',
    );

    await user.click(screen.getByRole('button', {name: 'Show latest image'}));
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('offers the live player when the camera streams', async () => {
    const feed = buildCameraFeed({
      liveUrl: 'https://webcams.windy.com/webcams/public/embed/player/1/live',
    });
    stubApi({[FEED_PATH]: ok(feed)});
    const user = userEvent.setup();
    render(<CameraPreview camera={cameraWithFeed} />);

    await user.click(await screen.findByRole('button', {name: 'Watch live'}));

    expect(screen.getByTitle('Live view of Tokyo Tower view')).toHaveAttribute(
      'src',
      feed.liveUrl,
    );
  });

  it('says there is no preview when the server has none', async () => {
    stubApi({[FEED_PATH]: apiError(404, 'NOT_FOUND')});

    render(<CameraPreview camera={cameraWithFeed} />);

    expect(
      await screen.findByText('Preview not available'),
    ).toBeInTheDocument();
  });

  it('explains a failure and lets the visitor try again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stub = stubApi({[FEED_PATH]: apiError(500, 'INTERNAL')});
    const user = userEvent.setup();
    render(<CameraPreview camera={cameraWithFeed} />);

    await user.click(await screen.findByRole('button', {name: 'Try again'}));

    expect(feedRequests(stub)).toBe(2);
  });

  it('fetches fresh links once when the image fails, then shows the error', async () => {
    const stub = stubApi({[FEED_PATH]: ok(buildCameraFeed())});
    render(<CameraPreview camera={cameraWithFeed} />);

    fireEvent.error(await screen.findByRole('img'));
    // The previous image stays up while fresh links load.
    fireEvent.error(await screen.findByRole('img'));

    expect(
      await screen.findByText("The preview can't be loaded right now"),
    ).toBeInTheDocument();
    expect(feedRequests(stub)).toBe(2);
  });

  it('fetches fresh links when the current ones expire', async () => {
    vi.useFakeTimers({shouldAdvanceTime: true});
    const now = new Date();
    const stub = stubApi({
      [FEED_PATH]: ok(
        buildCameraFeed({
          expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        }),
      ),
    });
    render(<CameraPreview camera={cameraWithFeed} />);
    await screen.findByRole('img');
    expect(feedRequests(stub)).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });

    expect(feedRequests(stub)).toBe(2);
    expect(screen.getByRole('img')).toBeInTheDocument();
  });
});
