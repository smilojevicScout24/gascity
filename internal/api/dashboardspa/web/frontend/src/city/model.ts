// City view model: projects supervisor sessions, rigs and beads onto the
// town map. Pure functions only, so the derivation is unit-testable and the
// SVG layer stays a dumb renderer.
//
// Role detection is template-driven: `gastown.polecat`, `rig/gastown.witness`
// and friends map to the Gastown cast; anything else renders as a plain
// "visitor" so cities running other packs still get a usable map.

import { parseAssignee } from 'gas-city-dashboard-shared';
import type { SessionResponse, Bead, RigResponse } from 'gas-city-dashboard-shared/gc-supervisor';

export type CityRole =
  | 'mayor'
  | 'deacon'
  | 'boot'
  | 'dog'
  | 'witness'
  | 'refinery'
  | 'polecat'
  | 'visitor';

export type PolecatPose = 'idle' | 'think' | 'tool' | 'stuck' | 'sleep';

export interface CityBead {
  id: string;
  title: string;
  status: string;
  type: string;
  assignee?: string;
  rig?: string;
}

export interface CityActor {
  id: string;
  role: CityRole;
  label: string;
  template: string;
  rig?: string;
  state: string;
  activity?: string;
  model?: string;
  contextPct?: number;
  lastActive?: string;
  bead?: CityBead;
  asleep: boolean;
  stalled: boolean;
  /** Minutes since last activity, set only when the actor is quiet with work in hand. */
  quietMinutes?: number;
  /** Polecat pose; other roles pick their pose in the renderer. */
  pose: PolecatPose;
  /** Stable 0..2 variant so the same polecat keeps the same look. */
  variant: 0 | 1 | 2;
}

export interface CityRig {
  name: string;
  branch?: string;
  ready: CityBead[];
  readyTotal: number;
  polecats: CityActor[];
  witness?: CityActor;
  refinery?: CityActor;
  mergeQueue: CityBead[];
  mergedToday: number;
}

export interface CityModel {
  mayor?: CityActor;
  deacon?: CityActor;
  boot?: CityActor;
  dogs: CityActor[];
  visitors: CityActor[];
  rigs: CityRig[];
  actors: CityActor[];
  counts: { awake: number; inFlight: number; mergeQueue: number; mergedToday: number };
}

export interface CityInputs {
  sessions: ReadonlyArray<SessionResponse>;
  rigs: ReadonlyArray<RigResponse>;
  /** Open + in-progress beads (any rig). */
  beads: ReadonlyArray<Bead>;
  /** Closed beads, used only to count today's merges per rig. */
  closedBeads?: ReadonlyArray<Bead>;
  /** Rig each bead was fetched from; preferred over guessing from the id prefix. */
  beadRigs?: ReadonlyMap<string, string>;
  now: number;
}

/** A polecat holding a bead with no activity for this long is drawn as stalled. */
export const STALL_AFTER_MINUTES = 10;
/** Ready beads drawn on a board; the rest are summarised in the count. */
export const READY_BOARD_CAP = 21;

const ROLES: ReadonlySet<CityRole> = new Set([
  'mayor',
  'deacon',
  'boot',
  'dog',
  'witness',
  'refinery',
  'polecat',
]);

export function roleOf(template: string): CityRole {
  const base = template.slice(template.lastIndexOf('/') + 1);
  const leaf = base.slice(base.lastIndexOf('.') + 1).toLowerCase();
  return ROLES.has(leaf as CityRole) ? (leaf as CityRole) : 'visitor';
}

export function deriveCity(input: CityInputs): CityModel {
  const live = input.sessions.filter((s) => s.state !== 'closed');
  const beadsById = new Map<string, Bead>();
  for (const bead of input.beads) beadsById.set(bead.id, bead);
  const beadForSession = indexInProgressBySession(input.beads);

  const actors = live.map((s) => {
    const actor = toActor(s, beadsById, beadForSession, input.now);
    const rig = resolveRigName(s.rig, input.rigs);
    if (rig !== undefined) actor.rig = rig;
    return actor;
  });
  const byRole = (role: CityRole) => actors.filter((a) => a.role === role);
  const singleton = (role: CityRole) => newestFirst(byRole(role))[0];

  const rigNames = new Set(input.rigs.map((r) => r.name));
  const rigs: CityRig[] = input.rigs.map((rig) => {
    const inRig = (a: CityActor) => a.rig === rig.name;
    const refinery = newestFirst(byRole('refinery').filter(inRig))[0];
    const rigOf = (b: Bead) => input.beadRigs?.get(b.id) ?? beadRig(b, input.rigs);
    const rigBeads = input.beads.filter((b) => rigOf(b) === rig.name);
    const ready = rigBeads.filter(isReady).map((b) => toCityBead(b, rig.name));
    const mergeQueue = refinery
      ? rigBeads
          .filter((b) => b.status !== 'closed' && b.id !== refinery.bead?.id)
          .filter((b) => assignedTo(b, refinery))
          .map((b) => toCityBead(b, rig.name))
      : [];
    const out: CityRig = {
      name: rig.name,
      ready: ready.slice(0, READY_BOARD_CAP),
      readyTotal: ready.length,
      polecats: byRole('polecat')
        .filter(inRig)
        .sort((a, b) => a.id.localeCompare(b.id)),
      mergeQueue,
      mergedToday: countMergedToday(input.closedBeads ?? [], rig.name, rigOf, input.now),
    };
    const branch = rig.default_branch ?? rig.git?.branch;
    if (branch) out.branch = branch;
    const witness = newestFirst(byRole('witness').filter(inRig))[0];
    if (witness) out.witness = witness;
    if (refinery) out.refinery = refinery;
    return out;
  });

  // Rig-scoped roles whose rig is not registered still deserve a place on the map.
  const orphans = actors.filter(
    (a) =>
      (a.role === 'polecat' || a.role === 'witness' || a.role === 'refinery') &&
      (a.rig === undefined || !rigNames.has(a.rig)),
  );

  const model: CityModel = {
    dogs: byRole('dog').sort((a, b) => a.id.localeCompare(b.id)),
    visitors: [...byRole('visitor'), ...orphans],
    rigs,
    actors,
    counts: {
      awake: actors.filter((a) => !a.asleep).length,
      inFlight: input.beads.filter((b) => b.status === 'in_progress').length,
      mergeQueue: rigs.reduce((n, r) => n + r.mergeQueue.length, 0),
      mergedToday: rigs.reduce((n, r) => n + r.mergedToday, 0),
    },
  };
  const mayor = singleton('mayor');
  const deacon = singleton('deacon');
  const boot = singleton('boot');
  if (mayor) model.mayor = mayor;
  if (deacon) model.deacon = deacon;
  if (boot) model.boot = boot;
  return model;
}

function toActor(
  s: SessionResponse,
  beadsById: ReadonlyMap<string, Bead>,
  beadForSession: ReadonlyMap<string, Bead>,
  now: number,
): CityActor {
  const role = roleOf(s.template);
  const asleep = s.state === 'asleep' || s.state === 'suspended';
  const raw =
    (s.active_bead ? beadsById.get(s.active_bead) : undefined) ?? beadForSession.get(s.id);
  const bead = raw
    ? toCityBead(raw)
    : s.active_bead
      ? { id: s.active_bead, title: '', status: 'in_progress', type: 'task' }
      : undefined;
  const lastActiveMs = s.last_active ? Date.parse(s.last_active) : Number.NaN;
  const quiet = Number.isFinite(lastActiveMs) ? Math.floor((now - lastActiveMs) / 60_000) : 0;
  const busyAndQuiet =
    !asleep && bead !== undefined && s.activity === 'idle' && quiet >= STALL_AFTER_MINUTES;
  const stalled = s.state === 'failed' || busyAndQuiet;

  const actor: CityActor = {
    id: s.id,
    role,
    label: actorLabel(s, role),
    template: s.template,
    state: s.state,
    asleep,
    stalled,
    pose: polecatPose(asleep, stalled, s.activity, bead !== undefined),
    variant: variantOf(s.id),
  };
  if (s.rig !== undefined) actor.rig = s.rig;
  if (s.activity !== undefined) actor.activity = s.activity;
  if (s.model !== undefined) actor.model = s.model;
  if (s.context_pct !== undefined) actor.contextPct = s.context_pct;
  if (s.last_active !== undefined) actor.lastActive = s.last_active;
  if (bead) actor.bead = bead;
  if (busyAndQuiet) actor.quietMinutes = quiet;
  return actor;
}

export function polecatPose(
  asleep: boolean,
  stalled: boolean,
  activity: string | undefined,
  hasBead: boolean,
): PolecatPose {
  if (asleep) return 'sleep';
  if (stalled) return 'stuck';
  const a = (activity ?? '').toLowerCase();
  if (a.includes('tool')) return 'tool';
  if (a.includes('think')) return 'think';
  if (a === '' || a === 'idle') return 'idle';
  return hasBead ? 'tool' : 'idle';
}

const SINGLETON_ROLES: ReadonlySet<CityRole> = new Set([
  'mayor',
  'deacon',
  'boot',
  'witness',
  'refinery',
]);

function actorLabel(s: SessionResponse, role: CityRole): string {
  const named = s.alias ?? s.display_name;
  // One-of-a-kind roles read better by role than by a raw session name.
  const raw = named ?? (SINGLETON_ROLES.has(role) ? role : (s.session_name ?? s.id));
  // Aliases are often rig-qualified (`rig/gastown.witness`); the rig is drawn
  // by the district, so keep only the leaf.
  const leaf = raw.slice(raw.lastIndexOf('/') + 1);
  return leaf.startsWith('gastown.') ? leaf.slice('gastown.'.length) : leaf;
}

function variantOf(id: string): 0 | 1 | 2 {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 3) as 0 | 1 | 2;
}

function newestFirst(list: CityActor[]): CityActor[] {
  return [...list].sort((a, b) => (b.lastActive ?? '').localeCompare(a.lastActive ?? ''));
}

function indexInProgressBySession(beads: ReadonlyArray<Bead>): Map<string, Bead> {
  const index = new Map<string, Bead>();
  for (const bead of beads) {
    if (bead.status !== 'in_progress' || !bead.assignee) continue;
    const { sessionId } = parseAssignee(bead.assignee);
    if (sessionId && !index.has(sessionId)) index.set(sessionId, bead);
  }
  return index;
}

function assignedTo(bead: Bead, actor: CityActor): boolean {
  if (!bead.assignee) return false;
  const { sessionId } = parseAssignee(bead.assignee);
  return (
    sessionId === actor.id ||
    bead.assignee === actor.label ||
    bead.assignee.endsWith(`/${actor.label}`)
  );
}

function isReady(bead: Bead): boolean {
  return bead.status === 'open' && !bead.assignee && bead.is_blocked !== true;
}

function toCityBead(b: Bead, rig?: string): CityBead {
  const out: CityBead = { id: b.id, title: b.title, status: b.status, type: b.issue_type };
  if (b.assignee) out.assignee = b.assignee;
  if (rig) out.rig = rig;
  return out;
}

/** Session `rig` may be a rig name or its checkout path; map either onto the registered rig name. */
export function resolveRigName(
  value: string | undefined,
  rigs: ReadonlyArray<RigResponse>,
): string | undefined {
  if (!value) return undefined;
  const hit = rigs.find(
    (r) => r.name === value || r.path === value || value.endsWith(`/${r.name}`),
  );
  return hit?.name ?? value;
}

/** Beads carry their rig as the id prefix (`ilp-4kx2` for a rig with prefix `ilp`). */
export function beadRig(bead: Bead, rigs: ReadonlyArray<RigResponse>): string | undefined {
  const dash = bead.id.indexOf('-');
  const prefix = dash > 0 ? bead.id.slice(0, dash) : '';
  return rigs.find((r) => r.prefix === prefix || r.name === prefix)?.name;
}

function countMergedToday(
  closed: ReadonlyArray<Bead>,
  rig: string,
  rigOf: (bead: Bead) => string | undefined,
  now: number,
): number {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const since = midnight.getTime();
  return closed.filter((b) => {
    if (b.status !== 'closed' || rigOf(b) !== rig) return false;
    const at = Date.parse(b.updated_at ?? b.created_at);
    return Number.isFinite(at) && at >= since;
  }).length;
}
