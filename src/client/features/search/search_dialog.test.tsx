/**
 * @fileoverview Tests for the search dialog, its shortcut, and its states.
 *
 * Layer: client tests (jsdom). The search API is answered by a stubbed `fetch`.
 */
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {apiError, ok, stubApi} from '@/client/test_support/fake_api';
import type {CameraSearchResult} from '@/shared/cameras';

import {SearchDialog, SearchTrigger, useSearchShortcut} from './search_dialog';

/** Two Tokyo cameras, as the API would return them. */
const TOKYO_RESULTS: CameraSearchResult[] = [
  {
    id: 'cam-1',
    title: 'Tokyo Tower view',
    placeName: 'Tokyo',
    countryCode: 'JP',
    category: 'landmark',
    lat: 35.6586,
    lng: 139.7454,
  },
  {
    id: 'cam-2',
    title: 'Tokyo bay',
    placeName: 'Tokyo',
    countryCode: 'JP',
    category: 'beach',
    lat: 35.6,
    lng: 139.8,
  },
];

/** The dialog with its trigger and shortcut, as the app shell wires them. */
function SearchHarness({
  onSelectCamera,
}: {
  onSelectCamera: (id: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const openSearch = (): void => {
    setOpen(true);
  };
  useSearchShortcut(openSearch);
  return (
    <>
      <SearchTrigger onOpen={openSearch} />
      <SearchDialog
        open={open}
        onOpenChange={setOpen}
        onSelectCamera={onSelectCamera}
      />
    </>
  );
}

/** Number of search requests the stub received. */
function searchRequestCount(stub: ReturnType<typeof stubApi>): number {
  return stub.mock.calls.filter(([input]) =>
    String(input).includes('/cameras/search'),
  ).length;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SearchDialog', () => {
  it('opens with Ctrl K and prompts for input', async () => {
    stubApi({});
    const user = userEvent.setup();
    render(<SearchHarness onSelectCamera={vi.fn()} />);

    await user.keyboard('{Control>}k{/Control}');

    expect(screen.getByRole('dialog', {name: 'Search cameras'})).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Type a city, place, or camera name.',
    );
  });

  it('searches once after typing pauses and lists the results', async () => {
    const stub = stubApi({
      '/api/v1/cameras/search?q=tokyo': ok({results: TOKYO_RESULTS}),
    });
    const user = userEvent.setup();
    render(<SearchHarness onSelectCamera={vi.fn()} />);
    await user.click(
      screen.getByRole('button', {name: /Search places and cameras/}),
    );

    await user.type(screen.getByRole('combobox'), 'tokyo');

    expect(
      await screen.findByRole('option', {name: /Tokyo Tower view/}),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', {name: /Tokyo bay/})).toHaveTextContent(
      'Tokyo, Japan · Beach',
    );
    expect(searchRequestCount(stub)).toBe(1);
  });

  it('opens the highlighted result with Enter and closes', async () => {
    stubApi({'/api/v1/cameras/search?q=tokyo': ok({results: TOKYO_RESULTS})});
    const onSelectCamera = vi.fn();
    const user = userEvent.setup();
    render(<SearchHarness onSelectCamera={onSelectCamera} />);
    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByRole('combobox'), 'tokyo');
    await screen.findByRole('option', {name: /Tokyo Tower view/});

    await user.keyboard('{ArrowDown}{Enter}');

    expect(onSelectCamera).toHaveBeenCalledWith('cam-2');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not search for a single character', async () => {
    const stub = stubApi({});
    const user = userEvent.setup();
    render(<SearchHarness onSelectCamera={vi.fn()} />);
    await user.keyboard('{Control>}k{/Control}');

    await user.type(screen.getByRole('combobox'), 't');

    expect(screen.getByRole('status')).toHaveTextContent('Keep typing');
    expect(searchRequestCount(stub)).toBe(0);
  });

  it('says when nothing matches', async () => {
    stubApi({'/api/v1/cameras/search?q=zzz': ok({results: []})});
    const user = userEvent.setup();
    render(<SearchHarness onSelectCamera={vi.fn()} />);
    await user.keyboard('{Control>}k{/Control}');

    await user.type(screen.getByRole('combobox'), 'zzz');

    expect(await screen.findByText('No cameras match “zzz”.')).toBeVisible();
  });

  it('explains a rate limit', async () => {
    stubApi({'/api/v1/cameras/search?q=tokyo': apiError(429, 'RATE_LIMITED')});
    const user = userEvent.setup();
    render(<SearchHarness onSelectCamera={vi.fn()} />);
    await user.keyboard('{Control>}k{/Control}');

    await user.type(screen.getByRole('combobox'), 'tokyo');

    expect(await screen.findByText(/Too many searches/)).toBeVisible();
  });

  it('closes with Escape without letting Escape reach the page', async () => {
    stubApi({});
    const pageEscape = vi.fn();
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        pageEscape();
      }
    });
    const user = userEvent.setup();
    render(<SearchHarness onSelectCamera={vi.fn()} />);
    await user.keyboard('{Control>}k{/Control}');

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(pageEscape).not.toHaveBeenCalled();
  });
});
