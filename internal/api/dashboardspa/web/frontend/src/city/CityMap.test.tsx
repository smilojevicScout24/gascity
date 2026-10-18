import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupervisorBead } from '../supervisor/beadReads';
import type { SupervisorRig } from '../supervisor/rigReads';
import type { SupervisorSession } from '../supervisor/sessionReads';
import { CityMap, type CityFx } from './CityMap';
import { layoutCity } from './layout';
import { deriveCity } from './model';

const NO_FX: CityFx = {
  slinging: false,
  nudging: new Set(),
  dogs: new Map(),
  envelopes: [],
  sparks: [],
  scans: [],
};

function fixture() {
  const sessions = [
    { id: 'gc-m', template: 'gastown.mayor', state: 'active', activity: 'idle' },
    {
      id: 'gc-p1',
      template: 'gastown.polecat',
      alias: 'furiosa',
      rig: 'is24-luxury-portal',
      state: 'active',
      activity: 'thinking',
      active_bead: 'ilp-aaa',
      last_active: new Date().toISOString(),
    },
  ].map((s) => ({
    session_name: s.id,
    title: s.id,
    created_at: '2026-10-07T08:00:00Z',
    attached: false,
    running: true,
    provider: 'claude',
    ...s,
  })) as SupervisorSession[];
  const rigs = [
    {
      name: 'is24-luxury-portal',
      prefix: 'ilp',
      path: '/rigs/ilp',
      agent_count: 2,
      running_count: 1,
      suspended: false,
    },
  ] as SupervisorRig[];
  const beads = [
    {
      id: 'ilp-aaa',
      title: 'Fix canonical tags',
      status: 'in_progress',
      issue_type: 'bug',
      created_at: '2026-10-07T08:00:00Z',
    },
  ] as SupervisorBead[];
  const model = deriveCity({ sessions, rigs, beads, now: Date.now() });
  return { model, layout: layoutCity(model) };
}

describe('CityMap', () => {
  afterEach(cleanup);

  it('draws the rig district, cast and the bead a polecat is working', () => {
    const { model, layout } = fixture();
    render(
      <CityMap
        model={model}
        layout={layout}
        fx={NO_FX}
        selected={null}
        onSelect={() => {}}
        initialBeads={new Set(['ilp-aaa'])}
      />,
    );
    expect(screen.getByText('is24-luxury-portal')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'furiosa, thinking' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'bead ilp-aaa, Fix canonical tags' })).toBeTruthy();
    expect(screen.getByText('Fix canonical ta…')).toBeTruthy();
  });

  it('selects an actor from the keyboard', () => {
    const { model, layout } = fixture();
    const onSelect = vi.fn();
    render(
      <CityMap
        model={model}
        layout={layout}
        fx={NO_FX}
        selected={null}
        onSelect={onSelect}
        initialBeads={new Set()}
      />,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'mayor, idle' }), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith({ kind: 'actor', id: 'gc-m' });
  });
});
