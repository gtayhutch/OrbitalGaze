/**
 * @fileoverview Tests for the app shell and its environment badge.
 *
 * Layer: client tests (jsdom).
 *
 * The WebGL globe can't run in jsdom, so the globe feature is replaced with a
 * stand-in element. Calls to the health endpoint are answered by a stubbed
 * `fetch`, so no test touches the network.
 */
import {render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {App} from './app';
import {EnvironmentBadge} from './environment_badge';

vi.mock('@/client/features/globe', () => ({
  GlobeView: () => <div data-testid="globe" />,
}));

/** Makes `fetch` answer every request with `body` as JSON. */
function stubFetchJson(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), {status}))),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('renders the brand and the globe', async () => {
    stubFetchJson({data: {status: 'ok', environment: 'production'}});
    render(<App />);

    expect(
      screen.getByRole('heading', {name: 'OrbitalGaze'}),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('globe')).toBeInTheDocument();
  });

  it('shows the environment badge outside production', async () => {
    stubFetchJson({data: {status: 'ok', environment: 'staging'}});
    render(<App />);

    expect(await screen.findByText('Staging')).toBeInTheDocument();
  });

  it('still renders when the health check fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetchJson({unexpected: true}, 500);
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
