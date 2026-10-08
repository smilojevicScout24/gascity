// City view model: projects supervisor sessions, agents, rigs and beads onto
// the town map. Pure functions only, so the derivation is unit-testable and
// the SVG layer stays a dumb renderer.
//
// Role detection is template-driven: `gastown.polecat`, `rig/gastown.witness`
// and friends map to the Gastown cast; anything else renders as a plain
// "visitor" so cities running other packs still get a usable map.
//
// Live sessions only exist while an agent runs. Pool members that are stopped
// (named polecats, dogs) come from the agent list instead, so an idle rig
// still shows its crew asleep at their benches.

import { parseAssignee } from 'gas-city-dashboard-shared';
import type {
  AgentResponse,
  Bead,
  RigResponse,
  SessionResponse,
} from 'gas-city-dashboard-shared/gc-supervisor';

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
  /** Full agent name (`rig/gastown.furiosa`); bead assignees use this form. */
  alias?: string;
  template: string;
  /** Pack-provided description of the agent, when the pack sets one. */
  description?: string;
  /** Pack the agent comes from (`gastown`, `core`, ...). */
  pack?: string;
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
  /** Configured agents; supplies activity for live sessions and the stopped pool members. */
  agents?: ReadonlyArray<AgentResponse>;
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
const SINGLETON_ROLES: ReadonlySet<CityRole> = new Set([
  'mayor',
  'deacon',
  'boot',
  'witness',
  'refinery',
]);
const ASLEEP_STATES: ReadonlySet<string> = new Set(['asleep', 'suspended', 'stopped']);

export function roleOf(template: string): CityRole {
  const base = template.slice(template.lastIndexOf('/') + 1);
  const leaf = base.slice(base.lastIndexOf('.') + 1).toLowerCase();
  return ROLES.has(leaf as CityRole) ? (leaf as CityRole) : 'visitor';
}

/**
 * Real work, as opposed to the bookkeeping beads formulas and patrols create:
 * molecules, their `-mol-` step beads and ephemeral `-wisp-` beads.
 */
export function isWorkBead(bead: Bead): boolean {
  return (
    bead.ephemeral !== true && bead.issue_type !== 'molecule' && !/-(?:mol|wisp)-/.test(bead.id)
  );
}

export function deriveCity(input: CityInputs): CityModel {
  const live = input.sessions.filter((s) => s.state !== 'closed');
  const agentsByName = new Map((input.agents ?? []).map((a) => [a.name, a]));
  const beads = indexBeads(input.beads);

  const actors = live.map((s) => {
    const actor = toActor(s, agentsByName.get(s.alias ?? ''), beads, input.now);
    const rig = resolveRigName(s.rig, input.rigs);
    if (rig !== undefined) actor.rig = rig;
    return actor;
  });
  actors.push(...stoppedPoolMembers(input.agents ?? [], live, input.rigs));

  const byRole = (role: CityRole) => actors.filter((a) => a.role === role);
  const singleton = (role: CityRole) =>
    newestFirst(byRole(role).filter((a) => !a.asleep))[0] ?? byRole(role)[0];

  const rigNames = new Set(input.rigs.map((r) => r.name));
  const rigOf = (b: Bead) => input.beadRigs?.get(b.id) ?? beadRig(b, input.rigs);
  const rigs: CityRig[] = input.rigs.map((rig) => {
    const inRig = (a: CityActor) => a.rig === rig.name;
    const refinery = newestFirst(byRole('refinery').filter(inRig))[0];
    const rigBeads = input.beads.filter((b) => rigOf(b) === rig.name && isWorkBead(b));
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
        .sort((a, b) => a.label.localeCompare(b.label)),
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
    dogs: byRole('dog').sort((a, b) => a.label.localeCompare(b.label)),
    visitors: [...byRole('visitor'), ...orphans],
    rigs,
    actors,
    counts: {
      awake: actors.filter((a) => !a.asleep).length,
      inFlight: input.beads.filter((b) => b.status === 'in_progress' && isWorkBead(b)).length,
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

interface BeadIndex {
  byId: ReadonlyMap<string, Bead>;
  /** In-progress beads keyed by raw assignee and by any embedded session id. */
  byAssignee: ReadonlyMap<string, Bead>;
}

function indexBeads(beads: ReadonlyArray<Bead>): BeadIndex {
  const byId = new Map<string, Bead>();
  const byAssignee = new Map<string, Bead>();
  for (const bead of beads) {
    byId.set(bead.id, bead);
    if (bead.status !== 'in_progress' || !bead.assignee || !isWorkBead(bead)) continue;
    if (!byAssignee.has(bead.assignee)) byAssignee.set(bead.assignee, bead);
    const { sessionId } = parseAssignee(bead.assignee);
    if (sessionId && !byAssignee.has(sessionId)) byAssignee.set(sessionId, bead);
  }
  return { byId, byAssignee };
}

function toActor(
  s: SessionResponse,
  agent: AgentResponse | undefined,
  beads: BeadIndex,
  now: number,
): CityActor {
  const role = roleOf(s.template);
  const asleep = ASLEEP_STATES.has(s.state);
  const activity = s.activity ?? agent?.activity;
  const activeBead = s.active_bead ?? agent?.active_bead;
  const raw =
    (activeBead ? beads.byId.get(activeBead) : undefined) ??
    (s.alias ? beads.byAssignee.get(s.alias) : undefined) ??
    beads.byAssignee.get(s.id);
  const bead = raw
    ? toCityBead(raw)
    : activeBead
      ? { id: activeBead, title: '', status: 'in_progress', type: 'task' }
      : undefined;
  const lastActiveMs = s.last_active ? Date.parse(s.last_active) : Number.NaN;
  const quiet = Number.isFinite(lastActiveMs) ? Math.floor((now - lastActiveMs) / 60_000) : 0;
  const busyAndQuiet =
    !asleep && bead !== undefined && activity === 'idle' && quiet >= STALL_AFTER_MINUTES;
  const stalled = s.state === 'failed' || busyAndQuiet;
  const label = actorLabel(s.alias ?? s.display_name, role, s.session_name ?? s.id);

  const actor: CityActor = {
    id: s.id,
    role,
    label,
    template: s.template,
    state: s.state,
    asleep,
    stalled,
    pose: polecatPose(asleep, stalled, activity, bead !== undefined),
    variant: variantOf(label),
  };
  if (s.alias !== undefined) actor.alias = s.alias;
  if (s.rig !== undefined) actor.rig = s.rig;
  if (activity !== undefined) actor.activity = activity;
  const model = s.model ?? agent?.model;
  if (model !== undefined) actor.model = model;
  const ctx = s.context_pct ?? agent?.context_pct;
  if (ctx !== undefined) actor.contextPct = ctx;
  if (s.last_active !== undefined) actor.lastActive = s.last_active;
  if (agent?.description) actor.description = agent.description;
  if (agent?.pack) actor.pack = agent.pack;
  if (bead) actor.bead = bead;
  if (busyAndQuiet) actor.quietMinutes = quiet;
  return actor;
}

/** Stopped polecats and dogs from the agent list, drawn asleep at their bench or kennel. */
function stoppedPoolMembers(
  agents: ReadonlyArray<AgentResponse>,
  live: ReadonlyArray<SessionResponse>,
  rigs: ReadonlyArray<RigResponse>,
): CityActor[] {
  const liveNames = new Set(live.map((s) => s.alias).filter((a): a is string => a !== undefined));
  return agents
    .filter((a) => !a.running && !liveNames.has(a.name))
    .flatMap((a) => {
      const role = roleOf(a.pool ?? a.name);
      if (role !== 'polecat' && role !== 'dog') return [];
      const label = actorLabel(a.name, role, a.name);
      const actor: CityActor = {
        id: `agent:${a.name}`,
        role,
        label,
        alias: a.name,
        template: a.pool ?? a.name,
        state: a.state,
        asleep: true,
        stalled: false,
        pose: 'sleep',
        variant: variantOf(label),
      };
      const rig = resolveRigName(a.rig, rigs);
      if (rig !== undefined) actor.rig = rig;
      if (a.model !== undefined) actor.model = a.model;
      if (a.description) actor.description = a.description;
      if (a.pack) actor.pack = a.pack;
      return [actor];
    });
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

function actorLabel(named: string | undefined, role: CityRole, fallback: string): string {
  // One-of-a-kind roles read better by role than by a raw session name.
  const raw = named ?? (SINGLETON_ROLES.has(role) ? role : fallback);
  // Names are often rig- and pack-qualified (`rig/gastown.witness`); the rig
  // is drawn by the district, so keep only the leaf.
  const leaf = raw.slice(raw.lastIndexOf('/') + 1);
  return leaf.startsWith('gastown.') ? leaf.slice('gastown.'.length) : leaf;
}

function variantOf(key: string): 0 | 1 | 2 {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return (h % 3) as 0 | 1 | 2;
}

function newestFirst(list: CityActor[]): CityActor[] {
  return [...list].sort((a, b) => (b.lastActive ?? '').localeCompare(a.lastActive ?? ''));
}

function assignedTo(bead: Bead, actor: CityActor): boolean {
  const assignee = bead.assignee;
  if (!assignee) return false;
  if (assignee === actor.alias || assignee === actor.id) return true;
  return parseAssignee(assignee).sessionId === actor.id || assignee.endsWith(`-${actor.id}`);
}

function isReady(bead: Bead): boolean {
  return (
    bead.status === 'open' &&
    !bead.assignee &&
    bead.is_blocked !== true &&
    bead.issue_type !== 'epic'
  );
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
    if (b.status !== 'closed' || rigOf(b) !== rig || !isWorkBead(b)) return false;
    const at = Date.parse(b.updated_at ?? b.created_at);
    return Number.isFinite(at) && at >= since;
  }).length;
}
