import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupervisorBead } from '../supervisor/beadReads';
import type { SupervisorRig } from '../supervisor/rigReads';
import type { SupervisorSession } from '../supervisor/sessionReads';
import { CityMap, type CityFx } from './CityMap';
import { layoutCity } from './layout';
import { deriveCity } from './model';
import type { SupervisorAgent } from '../supervisor/agentReads';
import { workflowPortrait } from './sprites';

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
  it('links dogs beyond the map slots to the complete roster', () => {
    const agents = Array.from({ length: 5 }, (_, i) => ({
      name: `gastown.dog-${i + 1}`,
      pool: 'gastown.dog',
      running: false,
      state: 'stopped',
    })) as SupervisorAgent[];
    const model = deriveCity({ sessions: [], agents, rigs: [], beads: [], now: 0 });
    render(
      <CityMap
        model={model}
        layout={layoutCity(model)}
        fx={NO_FX}
        selected={null}
        onSelect={() => {}}
        initialBeads={new Set()}
      />,
    );
    expect(model.dogs).toHaveLength(5);
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getByRole('link', { name: '2 more dogs in roster' }).getAttribute('href')).toBe(
      '#city-roster',
    );
  });
  it('keeps an on-demand Sol reviewer visible with a portrait among other supporting agents', () => {
    const agents = [
      ...Array.from({ length: 7 }, (_, i) => ({
        name: `custom.helper-${i}`,
        running: false,
        state: 'stopped',
      })),
      {
        name: 'project/sol-pre-push-review.sol-reviewer',
        rig: 'project',
        running: false,
        state: 'stopped',
      },
    ] as SupervisorAgent[];
    const model = deriveCity({ sessions: [], agents, rigs: [], beads: [], now: 0 });
    render(
      <CityMap
        model={model}
        layout={layoutCity(model)}
        fx={NO_FX}
        selected={null}
        onSelect={() => {}}
        initialBeads={new Set()}
      />,
    );
    const reviewer = screen.getByRole('button', {
      name: 'sol-pre-push-review.sol-reviewer, asleep',
    });
    expect(reviewer.querySelector('image')?.getAttribute('href')).toBe(
      workflowPortrait('sol-pre-push-review.sol-reviewer'),
    );
    expect(model.actors).toHaveLength(agents.length);
    expect(model.counts.awake).toBe(0);
    expect(screen.getByText('Sol reviewer')).toBeTruthy();
    expect(screen.getByRole('link', { name: '3 more agents in roster' }).getAttribute('href')).toBe(
      '#city-roster',
    );
  });

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
