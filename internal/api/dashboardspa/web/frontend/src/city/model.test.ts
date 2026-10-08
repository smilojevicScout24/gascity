import { describe, expect, it } from 'vitest';
import type { SupervisorAgent } from '../supervisor/agentReads';
import type { SupervisorBead } from '../supervisor/beadReads';
import type { SupervisorRig } from '../supervisor/rigReads';
import type { SupervisorSession } from '../supervisor/sessionReads';
import { layoutCity } from './layout';
import {
  beadRig,
  deriveCity,
  isWorkBead,
  polecatPose,
  resolveRigName,
  roleOf,
  STALL_AFTER_MINUTES,
} from './model';
import { spriteFor, spriteUrl } from './sprites';

const NOW = Date.parse('2026-10-07T12:00:00Z');

function session(partial: Partial<SupervisorSession> & { id: string }): SupervisorSession {
  return {
    template: 'gastown.polecat',
    session_name: partial.id,
    title: partial.id,
    state: 'active',
    created_at: '2026-10-07T08:00:00Z',
    last_active: '2026-10-07T11:59:00Z',
    attached: false,
    running: true,
    provider: 'claude',
    ...partial,
  } as SupervisorSession;
}

function bead(partial: Partial<SupervisorBead> & { id: string }): SupervisorBead {
  return {
    title: `title for ${partial.id}`,
    status: 'open',
    issue_type: 'task',
    created_at: '2026-10-07T08:00:00Z',
    ...partial,
  } as SupervisorBead;
}

function rig(name: string, prefix: string): SupervisorRig {
  return {
    name,
    prefix,
    path: `/home/gascity/rigs/${name}`,
    agent_count: 0,
    running_count: 0,
    suspended: false,
  } as SupervisorRig;
}

const RIGS = [rig('is24-luxury-portal', 'ilp')];

describe('roleOf', () => {
  it('maps gastown templates, rig-qualified or not, onto the cast', () => {
    expect(roleOf('gastown.mayor')).toBe('mayor');
    expect(roleOf('is24-luxury-portal/gastown.witness')).toBe('witness');
    expect(roleOf('gastown.polecat')).toBe('polecat');
    expect(roleOf('gastown.dog')).toBe('dog');
  });

  it('treats templates from other packs as visitors', () => {
    expect(roleOf('scix-worker')).toBe('visitor');
    expect(roleOf('review-babysitter.dispatcher')).toBe('visitor');
  });
});

describe('deriveCity', () => {
  it('places rig-scoped roles in their district and city roles in town', () => {
    const model = deriveCity({
      sessions: [
        session({ id: 'gc-m', template: 'gastown.mayor' }),
        session({ id: 'gc-d', template: 'gastown.deacon' }),
        session({
          id: 'gc-w',
          template: 'is24-luxury-portal/gastown.witness',
          rig: 'is24-luxury-portal',
        }),
        session({
          id: 'gc-r',
          template: 'is24-luxury-portal/gastown.refinery',
          rig: 'is24-luxury-portal',
        }),
        session({ id: 'gc-p1', rig: 'is24-luxury-portal', alias: 'furiosa' }),
        session({ id: 'gc-x', template: 'scix-worker' }),
      ],
      rigs: RIGS,
      beads: [],
      now: NOW,
    });
    expect(model.mayor?.id).toBe('gc-m');
    expect(model.deacon?.id).toBe('gc-d');
    const district = model.rigs[0]!;
    expect(district.witness?.id).toBe('gc-w');
    expect(district.refinery?.id).toBe('gc-r');
    expect(district.polecats.map((p) => p.label)).toEqual(['furiosa']);
    expect(model.visitors.map((v) => v.id)).toEqual(['gc-x']);
  });

  it('resolves a session rig given as a checkout path', () => {
    const model = deriveCity({
      sessions: [session({ id: 'gc-p1', rig: '/home/gascity/rigs/is24-luxury-portal' })],
      rigs: RIGS,
      beads: [],
      now: NOW,
    });
    expect(model.rigs[0]!.polecats).toHaveLength(1);
    expect(model.visitors).toHaveLength(0);
  });

  it('drops closed sessions', () => {
    const model = deriveCity({
      sessions: [session({ id: 'gc-p1', rig: 'is24-luxury-portal', state: 'closed' })],
      rigs: RIGS,
      beads: [],
      now: NOW,
    });
    expect(model.actors).toHaveLength(0);
  });

  it('attaches the active bead, falling back to an in-progress assignee join', () => {
    const model = deriveCity({
      sessions: [
        session({ id: 'gc-p1', rig: 'is24-luxury-portal', active_bead: 'ilp-aaa' }),
        session({ id: 'gc-p2', rig: 'is24-luxury-portal' }),
      ],
      rigs: RIGS,
      beads: [
        bead({ id: 'ilp-aaa', status: 'in_progress', title: 'Fix canonical tags' }),
        bead({ id: 'ilp-bbb', status: 'in_progress', assignee: 'polecat-gc-p2' }),
      ],
      now: NOW,
    });
    const [p1, p2] = model.rigs[0]!.polecats;
    expect(p1?.bead?.title).toBe('Fix canonical tags');
    expect(p2?.bead?.id).toBe('ilp-bbb');
    expect(model.counts.inFlight).toBe(2);
  });

  it('puts unassigned, unblocked open beads on the ready board', () => {
    const model = deriveCity({
      sessions: [],
      rigs: RIGS,
      beads: [
        bead({ id: 'ilp-r1' }),
        bead({ id: 'ilp-r2', assignee: 'polecat-gc-1' }),
        bead({ id: 'ilp-r3', is_blocked: true }),
        bead({ id: 'zzz-r4' }),
      ],
      now: NOW,
    });
    expect(model.rigs[0]!.ready.map((b) => b.id)).toEqual(['ilp-r1']);
    expect(model.rigs[0]!.readyTotal).toBe(1);
  });

  it('prefers the rig a bead was fetched from over its id prefix', () => {
    const model = deriveCity({
      sessions: [],
      rigs: [rig('demo', '')],
      beads: [bead({ id: 'work-1' })],
      beadRigs: new Map([['work-1', 'demo']]),
      now: NOW,
    });
    expect(model.rigs[0]!.ready.map((b) => b.id)).toEqual(['work-1']);
  });

  it('queues beads assigned to the refinery behind the one it is merging', () => {
    const model = deriveCity({
      sessions: [
        session({
          id: 'gc-r',
          template: 'is24-luxury-portal/gastown.refinery',
          rig: 'is24-luxury-portal',
          active_bead: 'ilp-m1',
        }),
      ],
      rigs: RIGS,
      beads: [
        bead({ id: 'ilp-m1', status: 'in_progress', assignee: 'refinery-gc-r' }),
        bead({ id: 'ilp-m2', status: 'open', assignee: 'refinery-gc-r' }),
      ],
      now: NOW,
    });
    const district = model.rigs[0]!;
    expect(district.refinery?.bead?.id).toBe('ilp-m1');
    expect(district.mergeQueue.map((b) => b.id)).toEqual(['ilp-m2']);
    expect(model.counts.mergeQueue).toBe(1);
  });

  it('counts only beads closed today in the rig', () => {
    const model = deriveCity({
      sessions: [],
      rigs: RIGS,
      beads: [],
      closedBeads: [
        bead({ id: 'ilp-c1', status: 'closed', updated_at: '2026-10-07T09:00:00Z' }),
        bead({ id: 'ilp-c2', status: 'closed', updated_at: '2026-10-05T09:00:00Z' }),
        bead({ id: 'zzz-c3', status: 'closed', updated_at: '2026-10-07T09:00:00Z' }),
      ],
      now: NOW,
    });
    expect(model.rigs[0]!.mergedToday).toBe(1);
  });

  it('marks a polecat holding work but idle for too long as stalled', () => {
    const quietSince = new Date(NOW - (STALL_AFTER_MINUTES + 2) * 60_000).toISOString();
    const model = deriveCity({
      sessions: [
        session({
          id: 'gc-p1',
          rig: 'is24-luxury-portal',
          activity: 'idle',
          active_bead: 'ilp-aaa',
          last_active: quietSince,
        }),
      ],
      rigs: RIGS,
      beads: [bead({ id: 'ilp-aaa', status: 'in_progress' })],
      now: NOW,
    });
    const p = model.rigs[0]!.polecats[0]!;
    expect(p.stalled).toBe(true);
    expect(p.pose).toBe('stuck');
    expect(p.quietMinutes).toBe(STALL_AFTER_MINUTES + 2);
  });
});

describe('polecatPose', () => {
  it('derives the pose from state and activity', () => {
    expect(polecatPose(true, false, 'thinking', true)).toBe('sleep');
    expect(polecatPose(false, true, 'thinking', true)).toBe('stuck');
    expect(polecatPose(false, false, 'tool_use', true)).toBe('tool');
    expect(polecatPose(false, false, 'thinking', true)).toBe('think');
    expect(polecatPose(false, false, 'idle', false)).toBe('idle');
    expect(polecatPose(false, false, 'in-turn', true)).toBe('tool');
  });
});

describe('beadRig / resolveRigName', () => {
  it('maps bead id prefixes and rig paths to rig names', () => {
    expect(beadRig(bead({ id: 'ilp-4kx2' }), RIGS)).toBe('is24-luxury-portal');
    expect(beadRig(bead({ id: 'hq-1' }), RIGS)).toBeUndefined();
    expect(resolveRigName('/home/gascity/rigs/is24-luxury-portal', RIGS)).toBe(
      'is24-luxury-portal',
    );
    expect(resolveRigName(undefined, RIGS)).toBeUndefined();
  });
});

describe('layoutCity', () => {
  it('gives every shown polecat a bench and puts its bead on the bubble pin', () => {
    const model = deriveCity({
      sessions: [session({ id: 'gc-p1', rig: 'is24-luxury-portal', active_bead: 'ilp-aaa' })],
      rigs: RIGS,
      beads: [bead({ id: 'ilp-aaa', status: 'in_progress' })],
      now: NOW,
    });
    const layout = layoutCity(model);
    const bench = layout.actors.get('gc-p1');
    expect(bench).toBeDefined();
    expect(layout.beads.get('ilp-aaa')).toEqual({ x: bench!.x + 56, y: bench!.y - 128 });
  });

  it('fits more benches into a single wide district and reports overflow', () => {
    const sessions = Array.from({ length: 14 }, (_, i) =>
      session({ id: `gc-p${i}`, rig: 'is24-luxury-portal' }),
    );
    const layout = layoutCity(deriveCity({ sessions, rigs: RIGS, beads: [], now: NOW }));
    const d = layout.districts[0]!;
    expect(d.slots.length).toBeGreaterThan(4);
    expect(d.overflow).toBe(14 - d.slots.length);
  });

  it('caps the number of districts drawn', () => {
    const rigs = ['a', 'b', 'c', 'd'].map((n) => rig(n, n));
    const layout = layoutCity(deriveCity({ sessions: [], rigs, beads: [], now: NOW }));
    expect(layout.districts).toHaveLength(3);
    expect(layout.hiddenRigs).toBe(1);
  });
});

describe('sprites', () => {
  it('resolves a sprite for every gastown pose', () => {
    const model = deriveCity({
      sessions: [session({ id: 'gc-p1', rig: 'is24-luxury-portal', activity: 'tool_use' })],
      rigs: RIGS,
      beads: [],
      now: NOW,
    });
    const p = model.rigs[0]!.polecats[0]!;
    expect(spriteFor(p)).toMatch(/^polecat-[abc]-tool$/);
    for (const name of [
      'mayor-idle',
      'mayor-sling',
      'deacon-walk-1',
      'deacon-walk-2',
      'witness-nudge',
      'refinery-merge',
      'dog-run',
      'boot-idle',
      'polecat-a-sleep',
      'polecat-b-stuck',
      'polecat-c-think',
      'bldg-townhall',
    ]) {
      expect(spriteUrl(name), name).not.toBe('');
    }
  });
});

describe('live-city shapes (gc 1.4)', () => {
  function agent(partial: Partial<SupervisorAgent> & { name: string }): SupervisorAgent {
    return {
      available: true,
      pack_derived: true,
      running: false,
      suspended: false,
      state: 'stopped',
      ...partial,
    } as SupervisorAgent;
  }

  it('shows stopped pool polecats and dogs from the agent list asleep', () => {
    const model = deriveCity({
      sessions: [],
      agents: [
        agent({
          name: 'is24-luxury-portal/gastown.furiosa',
          rig: 'is24-luxury-portal',
          pool: 'is24-luxury-portal/gastown.polecat',
        }),
        agent({ name: 'gastown.dog-1', pool: 'gastown.dog' }),
        agent({
          name: 'is24-luxury-portal/sol-pre-push-review.sol-reviewer',
          rig: 'is24-luxury-portal',
        }),
      ],
      rigs: RIGS,
      beads: [],
      now: NOW,
    });
    const [p] = model.rigs[0]!.polecats;
    expect(p?.label).toBe('furiosa');
    expect(p?.asleep).toBe(true);
    expect(p?.pose).toBe('sleep');
    expect(model.dogs.map((d) => d.label)).toEqual(['dog-1']);
    expect(model.visitors).toHaveLength(0);
    expect(model.counts.awake).toBe(0);
  });

  it('does not duplicate a pool member that has a live session', () => {
    const model = deriveCity({
      sessions: [
        session({
          id: 'ga-x1',
          template: 'is24-luxury-portal/gastown.polecat',
          alias: 'is24-luxury-portal/gastown.furiosa',
          rig: 'is24-luxury-portal',
        }),
      ],
      agents: [
        agent({
          name: 'is24-luxury-portal/gastown.furiosa',
          rig: 'is24-luxury-portal',
          pool: 'is24-luxury-portal/gastown.polecat',
          running: true,
          state: 'active',
          activity: 'thinking',
        }),
      ],
      rigs: RIGS,
      beads: [],
      now: NOW,
    });
    const polecats = model.rigs[0]!.polecats;
    expect(polecats).toHaveLength(1);
    expect(polecats[0]!.label).toBe('furiosa');
    expect(polecats[0]!.pose).toBe('think');
  });

  it('takes activity and active bead from the agent when the session lacks them', () => {
    const model = deriveCity({
      sessions: [session({ id: 'ga-k9r', template: 'gastown.mayor', alias: 'gastown.mayor' })],
      agents: [
        agent({
          name: 'gastown.mayor',
          running: true,
          state: 'idle',
          activity: 'idle',
          context_pct: 12,
        }),
      ],
      rigs: RIGS,
      beads: [],
      now: NOW,
    });
    expect(model.mayor?.label).toBe('mayor');
    expect(model.mayor?.activity).toBe('idle');
    expect(model.mayor?.contextPct).toBe(12);
  });

  it('matches bead assignees given as full agent names', () => {
    const model = deriveCity({
      sessions: [
        session({
          id: 'ga-nqxap',
          template: 'is24-luxury-portal/gastown.refinery',
          alias: 'is24-luxury-portal/gastown.refinery',
          rig: 'is24-luxury-portal',
        }),
        session({
          id: 'ga-p1',
          template: 'is24-luxury-portal/gastown.polecat',
          alias: 'is24-luxury-portal/gastown.nux',
          rig: 'is24-luxury-portal',
        }),
      ],
      rigs: RIGS,
      beads: [
        bead({ id: 'ilp-uak1', assignee: 'is24-luxury-portal/gastown.refinery' }),
        bead({ id: 'ilp-36yd', status: 'in_progress', assignee: 'is24-luxury-portal/gastown.nux' }),
      ],
      now: NOW,
    });
    expect(model.rigs[0]!.mergeQueue.map((b) => b.id)).toEqual(['ilp-uak1']);
    expect(model.rigs[0]!.polecats[0]!.bead?.id).toBe('ilp-36yd');
  });

  it('keeps formula and patrol bookkeeping beads off the board', () => {
    expect(isWorkBead(bead({ id: 'ilp-mol-u1wz' }))).toBe(false);
    expect(isWorkBead(bead({ id: 'ilp-wisp-1av', ephemeral: true }))).toBe(false);
    expect(isWorkBead(bead({ id: 'ilp-dohq', issue_type: 'molecule' }))).toBe(false);
    expect(isWorkBead(bead({ id: 'ilp-hzf.51' }))).toBe(true);
    const model = deriveCity({
      sessions: [],
      rigs: RIGS,
      beads: [
        bead({ id: 'ilp-mol-u1wz' }),
        bead({ id: 'ilp-uak1' }),
        bead({ id: 'ilp-hzf', issue_type: 'epic' }),
      ],
      now: NOW,
    });
    expect(model.rigs[0]!.ready.map((b) => b.id)).toEqual(['ilp-uak1']);
  });
});

describe('roleSummary', () => {
  it('describes each gastown role and prefers a pack description', async () => {
    const { roleSummary } = await import('./roles');
    const model = deriveCity({
      sessions: [
        session({ id: 'ga-m', template: 'gastown.mayor', alias: 'gastown.mayor' }),
        session({
          id: 'ga-x',
          template: 'core.control-dispatcher',
          alias: 'core.control-dispatcher',
        }),
        session({ id: 'ga-y', template: 'acme.helper', alias: 'acme.helper' }),
      ],
      agents: [
        {
          name: 'core.control-dispatcher',
          pack: 'core',
          available: true,
          pack_derived: true,
          running: true,
          suspended: false,
          state: 'idle',
        },
        {
          name: 'acme.helper',
          description: 'Answers questions.',
          available: true,
          pack_derived: true,
          running: true,
          suspended: false,
          state: 'idle',
        },
      ] as SupervisorAgent[],
      rigs: RIGS,
      beads: [],
      now: NOW,
    });
    expect(roleSummary(model.mayor!)).toMatch(/slings them to rig polecats/);
    const [dispatcher, helper] = model.visitors;
    expect(roleSummary(dispatcher!)).toBe('Agent from the core pack.');
    expect(roleSummary(helper!)).toBe('Answers questions.');
  });
});

describe('configured agent models', () => {
  it('keeps the configured pool model for sleeping and awake polecats without telemetry', () => {
    const agents = ['furiosa', 'nux'].map(
      (name) =>
        ({
          name: `rig/gastown.${name}`,
          pool: 'rig/gastown.polecat',
          rig: 'rig',
          provider: 'claude',
          running: false,
          suspended: false,
          available: true,
          state: 'stopped',
          configured_model: 'eu.anthropic.claude-sonnet-5-5',
        }) as SupervisorAgent,
    );
    const model = deriveCity({
      sessions: [
        session({
          id: 'live',
          template: 'rig/gastown.polecat',
          alias: 'rig/gastown.furiosa',
          rig: 'rig',
        }),
      ],
      agents,
      rigs: [rig('rig', 'r')],
      beads: [],
      now: NOW,
    });
    expect(
      model.actors.map((a) => (a as typeof a & { configuredModel?: string }).configuredModel),
    ).toEqual(['eu.anthropic.claude-sonnet-5-5', 'eu.anthropic.claude-sonnet-5-5']);
    expect(model.actors.every((a) => a.model === undefined)).toBe(true);
  });
});
