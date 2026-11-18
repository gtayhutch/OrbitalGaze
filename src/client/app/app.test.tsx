/**
 * @fileoverview Tests for the app shell: layout, environment badge, and camera selection.
 *
 * Layer: client tests (jsdom).
 *
 * The WebGL globe can't run in jsdom, so the globe feature is replaced with a
 * stand-in that shows how many pins it was given, how many categories are
 * visible, and the credits it was handed, and offers a button that "clicks"
 * a pin. API calls are answered by a stubbed `fetch`.
 */
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';

import type {GlobeViewProps} from '@/client/features/globe';
import {
  buildCameraDetail,
  SAMPLE_INDEX,
} from '@/client/test_support/camera_fixtures';
import {apiError, ok, stubApi} from '@/client/test_support/fake_api';

import {App} from './app';
import {EnvironmentBadge} from './environment_badge';

vi.mock('@/client/features/globe', () => ({
  GlobeView: (props: GlobeViewProps) => (
    <div data-testid="globe">
      <span data-testid="globe-pin-count">{props.cameras.length}</span>
      <span data-testid="globe-visible-categories">
        {props.visibleCategories.size}
      </span>
      {props.credits}
      <button
        type="button"
        onClick={() => {
          props.onSelectCamera('cam-1');
        }}
      >
        Click pin cam-1
      </button>
    </div>
  ),
}));

/** Standard API answers for a healthy local app with four cameras. */
function stubHealthyApi(environment = 'test'): ReturnType<typeof stubApi> {
  return stubApi({
    '/api/v1/health': ok({status: 'ok', environment}),
    '/api/v1/cameras/index': ok({
      generatedAt: '2026-11-17T00:00:00Z',
      cameras: SAMPLE_INDEX,
    }),
    '/api/v1/cameras/cam-1': ok(buildCameraDetail()),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('renders the brand, the layer panel, and the globe with every pin', async () => {
    stubHealthyApi();
    render(<App />);

    expect(
      screen.getByRole('heading', {name: 'OrbitalGaze'}),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Layers'})).toBeInTheDocument();
    expect(await screen.findByTestId('globe-pin-count')).toHaveTextContent('4');
  });

  it('shows the environment badge outside production', async () => {
    stubHealthyApi('staging');
    render(<App />);

    expect(await screen.findByText('Staging')).toBeInTheDocument();
  });

  it('still renders when the health check fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubApi({'/api/v1/health': apiError(500, 'INTERNAL')});
    render(<App />);

    expect(
      screen.getByRole('heading', {name: 'OrbitalGaze'}),
    ).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(console.warn).toHaveBeenCalled();
    });
    expect(screen.queryByText('Local')).not.toBeInTheDocument();
  });
});

describe('camera selection', () => {
  it('opens the camera from the URL', async () => {
    window.history.replaceState(null, '', '/?camera=cam-1');
    stubHealthyApi();
    render(<App />);

    const panel = await screen.findByRole('complementary', {
      name: 'Tokyo Tower view',
    });
    expect(within(panel).getByText('Landmark')).toBeInTheDocument();
  });

  it('opens a camera when its pin is clicked and records it in the URL', async () => {
    stubHealthyApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByText('Click pin cam-1'));

    expect(
      await screen.findByRole('complementary', {name: 'Tokyo Tower view'}),
    ).toBeInTheDocument();
    expect(window.location.search).toBe('?camera=cam-1');
  });

  it('closes with Escape and removes the camera from the URL', async () => {
    window.history.replaceState(null, '', '/?camera=cam-1');
    stubHealthyApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('complementary', {name: 'Tokyo Tower view'});

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('says so when the linked camera is not available', async () => {
    window.history.replaceState(null, '', '/?camera=gone');
    stubHealthyApi();
    render(<App />);

    expect(
      await screen.findByRole('complementary', {
        name: "This camera isn't available",
      }),
    ).toBeInTheDocument();
  });

  it('ignores a malformed camera ID in the URL without asking the API', async () => {
    window.history.replaceState(null, '', '/?camera=%3Cscript%3E');
    const fetchStub = stubHealthyApi();
    render(<App />);
    await screen.findByTestId('globe-pin-count');

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    const requestedPaths = fetchStub.mock.calls.map(([input]) => String(input));
    expect(requestedPaths.some(path => path.includes('script'))).toBe(false);
  });
});

describe('layers', () => {
  it('shows the webcam credit while webcams are on', async () => {
    stubHealthyApi();
    render(<App />);

    expect(
      await screen.findByRole('list', {name: 'Data credits'}),
    ).toHaveTextContent('Webcams provided by windy.com — add a webcam');
    expect(screen.getByTestId('globe-visible-categories')).toHaveTextContent(
      '7',
    );
  });

  it('hides every webcam pin and the credit when the layer is switched off', async () => {
    stubHealthyApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('4 shown');

    await user.click(screen.getByRole('switch', {name: 'Public webcams'}));

    expect(screen.getByTestId('globe-visible-categories')).toHaveTextContent(
      '0',
    );
    expect(
      screen.queryByRole('list', {name: 'Data credits'}),
    ).not.toBeInTheDocument();
  });

  it('switches webcams back on when a camera is chosen in search', async () => {
    stubApi({
      '/api/v1/health': ok({status: 'ok', environment: 'test'}),
      '/api/v1/cameras/index': ok({
        generatedAt: '2026-11-17T00:00:00Z',
        cameras: SAMPLE_INDEX,
      }),
      '/api/v1/cameras/cam-1': ok(buildCameraDetail()),
      '/api/v1/cameras/search?q=tokyo': ok({
        results: [
          {
            id: 'cam-1',
            title: 'Tokyo Tower view',
            placeName: 'Tokyo',
            countryCode: 'JP',
            category: 'landmark',
            lat: 35.6586,
            lng: 139.7454,
          },
        ],
      }),
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole('switch', {name: 'Public webcams'}),
    );

    await user.click(
      screen.getByRole('button', {name: /Search places and cameras/}),
    );
    await user.type(screen.getByRole('combobox'), 'tokyo');
    await user.click(
      await screen.findByRole('option', {name: /Tokyo Tower view/}),
    );

    expect(screen.getByRole('switch', {name: 'Public webcams'})).toBeChecked();
    expect(window.location.search).toBe('?camera=cam-1');
  });
});

describe('EnvironmentBadge', () => {
  it('labels the local environment', () => {
    render(<EnvironmentBadge environment="test" />);
    expect(screen.getByText('Local')).toBeInTheDocument();
  });

  it('shows nothing in production or while unknown', () => {
    const {container: productionContainer} = render(
      <EnvironmentBadge environment="production" />,
    );
    const {container: unknownContainer} = render(
      <EnvironmentBadge environment={undefined} />,
    );

    expect(productionContainer).toBeEmptyDOMElement();
    expect(unknownContainer).toBeEmptyDOMElement();
  });
});
