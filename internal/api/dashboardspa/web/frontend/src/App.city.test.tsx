import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ThemeProvider } from './contexts/ThemeContext';

// Keep the fork's city presentation coverage separate from upstream's route tests.
vi.mock('./api/client', () => ({
  api: {
    config: vi.fn(async () => ({
      cityName: 'test-city',
      defaultView: null,
      enabledModules: [],
      readOnly: false,
      operatorAlias: 'stephanie',
      operatorWireAlias: 'human',
      decisionLabel: 'needs/stephanie',
    })),
  },
}));

vi.mock('./supervisor/client', () => ({
  supervisorApi: () => ({
    listCities: vi.fn(async () => ({
      items: [{ name: 'test-city', path: '/srv/gc/test-city', running: true }],
      total: 1,
    })),
    listSessions: vi.fn(async () => ({ items: [], total: 0 })),
    listBeads: vi.fn(async () => ({ items: [], total: 0 })),
    listAgents: vi.fn(async () => ({ items: [], total: 0 })),
    listRigs: vi.fn(async () => ({ items: [], total: 0 })),
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <output data-testid="pathname">{location.pathname}</output>
      <output data-testid="search">{location.search}</output>
    </>
  );
}

describe('App city presentation', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });
  });

  it('/map switches city presentations through the app router and preserves other query parameters', async () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/map?style=gascity&keep=1']}>
          <App />
          <LocationProbe />
        </MemoryRouter>
      </ThemeProvider>,
    );

    const presentation = await screen.findByRole('combobox', { name: 'City presentation' });
    expect((presentation as HTMLSelectElement).value).toBe('gascity');
    expect(screen.getByText('In review')).toBeTruthy();

    fireEvent.change(presentation, { target: { value: 'gastown' } });
    await waitFor(() => {
      expect(screen.getByTestId('search').textContent).toBe('?style=gastown&keep=1');
    });
    expect(screen.getByText('Merge queue')).toBeTruthy();
    expect(screen.getByTestId('pathname').textContent).toBe('/map');
  });
});
