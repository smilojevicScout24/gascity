// City: an animated town map of the live city. Sessions, rigs and beads come
// from the supervisor; the event stream drives refreshes plus the transient
// flourishes (mail envelopes, dog errands, merge sparks).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { SseIndicator } from '../components/SseIndicator';
import { useNow } from '../contexts/NowContext';
import { useCachedData } from '../hooks/useCachedData';
import { useGcEventRefresh, type GcEventEnvelope } from '../hooks/useGcEvents';
import { formatClockTime, formatRelative } from '../hooks/time';
import { useVisibleInterval } from '../hooks/useVisibleInterval';
import { listSupervisorBeads, type SupervisorBead } from '../supervisor/beadReads';
import { listSupervisorRigs } from '../supervisor/rigReads';
import { listSupervisorSessions } from '../supervisor/sessionReads';
import { CityMap, statusLine, type CityFx, type CitySelection } from '../city/CityMap';
import { layoutCity, STREET_Y, type Point } from '../city/layout';
import { deriveCity, type CityActor, type CityBead, type CityModel } from '../city/model';
import '../city/city.css';

const FEED_LIMIT = 14;
const CLOSED_FETCH_LIMIT = 200;
const SESSION_POLL_MS = 20_000;

interface FeedItem {
  key: string;
  ts: string;
  type: string;
  actor: string;
  detail: string;
}

export function CityPage() {
  const now = useNow();
  const sessions = useCachedData('city:sessions', () => listSupervisorSessions());
  const rigs = useCachedData('city:rigs', () => listSupervisorRigs());
  const rigNames = useMemo(() => (rigs.data?.items ?? []).map((r) => r.name), [rigs.data]);
  const rigKey = rigNames.join(',');
  const beads = useCachedData(`city:beads:${rigKey}`, (signal) =>
    fetchRigBeads(rigNames, false, signal),
  );
  const closed = useCachedData(`city:closed:${rigKey}`, (signal) =>
    fetchRigBeads(rigNames, true, signal),
  );

  const model = useMemo(
    () =>
      deriveCity({
        sessions: sessions.data?.items ?? [],
        rigs: rigs.data?.items ?? [],
        beads: beads.data?.items ?? [],
        closedBeads: closed.data?.items ?? [],
        beadRigs: new Map([...(beads.data?.rigOf ?? []), ...(closed.data?.rigOf ?? [])]),
        now,
      }),
    // `now` ticks every second; re-deriving on the minute is enough for "quiet Nm".
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions.data, rigs.data, beads.data, closed.data, Math.floor(now / 60_000)],
  );
  const layout = useMemo(() => layoutCity(model), [model]);

  // Beads already on the map at first paint appear in place; later ones fly in from the mayor.
  const initialBeads = useRef<Set<string> | null>(null);
  if (initialBeads.current === null && beads.data !== undefined) {
    initialBeads.current = new Set(beads.data.items.map((b) => b.id));
  }

  const { fx, feed, onEvent } = useCityFx(model, layout);
  const refreshAll = useCallback(() => {
    void sessions.refresh();
    void beads.refresh();
    void closed.refresh();
  }, [sessions, beads, closed]);
  const sseState = useGcEventRefresh(['session.', 'bead.', 'mail.', 'order.'], refreshAll, {
    coalesceMs: 3_000,
    matches: (event) => {
      onEvent(event);
      return event.type.startsWith('session.') || event.type.startsWith('bead.');
    },
  });
  // Activity flips (thinking / tool use) don't always emit events.
  useVisibleInterval(() => void sessions.refresh(), SESSION_POLL_MS);

  const [selected, setSelected] = useState<CitySelection | null>(null);
  const error = sessions.error ?? rigs.error ?? beads.error;

  return (
    <section className="city-root">
      <PageHeader
        title="City"
        synopsis={synopsis(model)}
        meta={
          <>
            <SseIndicator state={sseState} />
            {error && (
              <span className="normal-case text-body text-accent" role="alert">
                {error}
              </span>
            )}
          </>
        }
      />

      <dl className="grid grid-cols-2 md:grid-cols-4 border-y border-rule mb-8">
        <Stat label="Sessions awake" value={model.counts.awake} />
        <Stat label="Beads in flight" value={model.counts.inFlight} />
        <Stat label="Merge queue" value={model.counts.mergeQueue} />
        <Stat label="Merged today" value={model.counts.mergedToday} />
      </dl>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div className="border border-rule rounded-sm">
            <CityMap
              model={model}
              layout={layout}
              fx={fx}
              selected={selected}
              onSelect={setSelected}
              initialBeads={initialBeads.current ?? new Set()}
            />
          </div>
          <Legend />
        </div>
        <aside className="space-y-8 min-w-0">
          <Detail model={model} selected={selected} now={now} />
          <Feed items={feed} />
          <Roster model={model} onSelect={setSelected} />
        </aside>
      </div>
    </section>
  );
}

interface RigBeads {
  items: SupervisorBead[];
  /** Bead id → the rig whose store it came from. */
  rigOf: Map<string, string>;
}

async function fetchRigBeads(
  rigs: readonly string[],
  closedOnly: boolean,
  signal: AbortSignal,
): Promise<RigBeads> {
  const out: RigBeads = { items: [], rigOf: new Map() };
  if (rigs.length === 0) return out;
  const results = await Promise.allSettled(
    rigs.map((rig) =>
      listSupervisorBeads(
        closedOnly
          ? { rigFilter: rig, includeClosed: true, limit: CLOSED_FETCH_LIMIT, signal }
          : { rigFilter: rig, signal },
      ),
    ),
  );
  if (results.every((r) => r.status === 'rejected')) {
    throw (results[0] as PromiseRejectedResult).reason;
  }
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    for (const bead of r.value.items) {
      if (closedOnly && bead.status !== 'closed') continue;
      out.items.push(bead);
      out.rigOf.set(bead.id, rigs[i]!);
    }
  });
  return out;
}

/** Transient map flourishes derived from the live event stream. */
function useCityFx(model: CityModel, layout: ReturnType<typeof layoutCity>) {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [fx, setFx] = useState<CityFx>({
    slinging: false,
    nudging: new Set(),
    dogs: new Map(),
    envelopes: [],
    sparks: [],
    scans: [],
  });
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  // The event handler is created once per hook subscription; read the latest map through refs.
  const modelRef = useRef(model);
  modelRef.current = model;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const seq = useRef(0);

  const onEvent = useCallback((event: GcEventEnvelope) => {
    const key = `${String(event.seq ?? '')}:${seq.current++}`;
    const actorName = str(event.actor);
    const item: FeedItem = {
      key,
      ts: str(event.ts) || new Date().toISOString(),
      type: event.type,
      actor: actorName,
      detail: str(event.message) || str(event.subject),
    };
    setFeed((prev) => [item, ...prev].slice(0, FEED_LIMIT));

    const m = modelRef.current;
    const l = layoutRef.current;
    const find = (name: string) => findActor(m, name);
    const pointOf = (a: CityActor | undefined): Point | undefined => {
      const p = a ? l.actors.get(a.id) : undefined;
      return p ? { x: p.x, y: p.y - 55 } : undefined;
    };

    if (event.type === 'bead.created' && actorName.includes('mayor')) {
      setFx((f) => ({ ...f, slinging: true }));
      later(2_500, () => setFx((f) => ({ ...f, slinging: false })));
    }
    if (event.type === 'mail.sent') {
      const from = find(actorName);
      const to = find(
        str(event.subject) || str((event.payload as Record<string, unknown> | undefined)?.to),
      );
      const a = pointOf(from);
      const b = pointOf(to);
      if (a && b) {
        setFx((f) => ({ ...f, envelopes: [...f.envelopes, { key, from: a, to: b }] }));
        later(1_600, () =>
          setFx((f) => ({ ...f, envelopes: f.envelopes.filter((e) => e.key !== key) })),
        );
      }
      if (from?.role === 'witness') {
        const id = from.id;
        setFx((f) => ({ ...f, nudging: new Set([...f.nudging, id]) }));
        if (a && b)
          setFx((f) => ({ ...f, scans: [...f.scans, { key, from: a, to: b, tone: 'merge' }] }));
        later(2_600, () =>
          setFx((f) => {
            const nudging = new Set(f.nudging);
            nudging.delete(id);
            return { ...f, nudging, scans: f.scans.filter((s) => s.key !== key) };
          }),
        );
      }
    }
    if (event.type === 'bead.closed') {
      const subject = str(event.subject);
      const district =
        l.districts.find((d) => subject.startsWith(`${d.rig.name}`) || m.rigs.length === 1) ??
        l.districts[0];
      if (district) {
        const at = district.gateInlet;
        setFx((f) => ({ ...f, sparks: [...f.sparks, { key, at }] }));
        later(1_000, () => setFx((f) => ({ ...f, sparks: f.sparks.filter((s) => s.key !== key) })));
      }
    }
    if (event.type === 'order.fired' && l.districts.length > 0) {
      setFx((f) => {
        const idle = m.dogs.slice(0, l.dogs.length).find((d) => !f.dogs.has(d.id));
        if (!idle) return f;
        const d = l.districts[Math.floor(Math.random() * l.districts.length)]!;
        const target = { x: d.ox + d.w / 2, y: STREET_Y + 8 };
        const home = l.actors.get(idle.id)!;
        later(4_500, () =>
          setFx((g) => ({ ...g, dogs: new Map(g.dogs).set(idle.id, { at: home, dir: -1 }) })),
        );
        later(7_600, () =>
          setFx((g) => {
            const dogs = new Map(g.dogs);
            dogs.delete(idle.id);
            return { ...g, dogs };
          }),
        );
        const deacon = pointOf(m.deacon);
        const scans = deacon
          ? [...f.scans, { key, from: deacon, to: home, tone: 'civic' as const }]
          : f.scans;
        later(1_200, () => setFx((g) => ({ ...g, scans: g.scans.filter((s) => s.key !== key) })));
        return { ...f, scans, dogs: new Map(f.dogs).set(idle.id, { at: target, dir: 1 }) };
      });
    }
  }, []);

  return { fx, feed, onEvent };
}

/** Match an event actor/recipient string (`rig/gastown.witness`, `mayor`, a session id) to an actor. */
function findActor(model: CityModel, name: string): CityActor | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  return (
    model.actors.find((a) => a.id === name) ??
    model.actors.find(
      (a) =>
        (a.rig ? lower.includes(a.rig.toLowerCase()) : true) &&
        lower.endsWith(a.label.toLowerCase()),
    )
  );
}

function synopsis(model: CityModel): string {
  const rigs = model.rigs.length;
  return `${rigs} ${rigs === 1 ? 'rig' : 'rigs'} · ${model.counts.awake} sessions awake · ${model.counts.inFlight} beads in flight`;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="py-4">
      <dd className="text-3xl font-semibold tnum text-fg">{value}</dd>
      <dt className="text-label uppercase tracking-wider text-fg-muted">{label}</dt>
    </div>
  );
}

function Legend() {
  const items: Array<[string, string]> = [
    ['oklch(var(--fg-faint))', 'open bead on the ready board'],
    ['var(--city-work)', 'bead being worked'],
    ['var(--city-merge)', 'bead in the merge queue'],
    ['oklch(var(--accent))', 'maroon glow · polecat stalled or quiet'],
  ];
  return (
    <ul className="flex flex-wrap gap-x-6 gap-y-2 mt-3 text-body text-fg-muted">
      {items.map(([color, label]) => (
        <li key={label} className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ background: color }}
          />
          {label}
        </li>
      ))}
    </ul>
  );
}

function Detail({
  model,
  selected,
  now,
}: {
  model: CityModel;
  selected: CitySelection | null;
  now: number;
}) {
  const actor =
    selected?.kind === 'actor'
      ? model.actors.find((a) => a.id === selected.id)
      : selected
        ? undefined
        : model.mayor;
  const bead = selected?.kind === 'bead' ? findBead(model, selected.id) : undefined;
  const rows: Array<[string, string]> = actor
    ? [
        ['template', actor.template],
        ['session', actor.id],
        ['state', actor.stalled ? `${actor.state} · stalled` : actor.state],
        ['activity', statusLine(actor)],
        ['model', actor.model ?? '·'],
        ['context', actor.contextPct === undefined ? '·' : `${Math.round(actor.contextPct)}%`],
        ['last active', actor.lastActive ? formatRelative(actor.lastActive, now) : '·'],
        [
          'active bead',
          actor.bead
            ? `${actor.bead.id}${actor.bead.title ? ` · ${actor.bead.title}` : ''}`
            : 'none',
        ],
      ]
    : bead
      ? [
          ['title', bead.title],
          ['rig', bead.rig ?? '·'],
          ['status', bead.status],
          ['type', bead.type],
          ['assignee', bead.assignee ?? 'unassigned'],
        ]
      : [];
  const title = actor
    ? actor.rig
      ? `${actor.rig} · ${actor.label}`
      : actor.label
    : bead
      ? bead.id
      : 'Selected';
  return (
    <section aria-label="Selection detail">
      <header className="flex items-baseline justify-between border-b border-rule pb-2 mb-3">
        <h2 className="text-headline text-fg truncate">{title}</h2>
        <span className="text-label uppercase tracking-wider text-fg-faint">
          {actor ? 'session' : bead ? 'bead' : ''}
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="text-body text-fg-muted">
          Select anyone on the map to see what they are doing.
        </p>
      ) : (
        <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 text-body">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-faint">{k}</dt>
              <dd className="text-fg break-words tnum">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function Feed({ items }: { items: ReadonlyArray<FeedItem> }) {
  return (
    <section aria-label="Live events">
      <header className="flex items-baseline justify-between border-b border-rule pb-2 mb-3">
        <h2 className="text-headline text-fg">Live events</h2>
      </header>
      {items.length === 0 ? (
        <p className="text-body text-fg-muted">Waiting for the next event.</p>
      ) : (
        <ol className="text-body">
          {items.map((e) => (
            <li
              key={e.key}
              className="grid grid-cols-[64px_minmax(0,1fr)] gap-2 py-1 border-b border-rule last:border-0"
            >
              <span className="tnum text-fg-faint">{formatClockTime(e.ts)}</span>
              <span className="min-w-0 break-words">
                <span className="text-fg">{e.type}</span>{' '}
                <span className="text-fg-muted">
                  {e.actor}
                  {e.detail ? ` · ${e.detail}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Roster({ model, onSelect }: { model: CityModel; onSelect: (s: CitySelection) => void }) {
  const order = ['mayor', 'deacon', 'boot', 'witness', 'refinery', 'polecat', 'dog', 'visitor'];
  const rows = [...model.actors].sort(
    (a, b) =>
      order.indexOf(a.role) - order.indexOf(b.role) ||
      (a.rig ?? '').localeCompare(b.rig ?? '') ||
      a.label.localeCompare(b.label),
  );
  return (
    <section aria-label="Roster">
      <header className="flex items-baseline justify-between border-b border-rule pb-2 mb-3">
        <h2 className="text-headline text-fg">Roster</h2>
        <span className="text-label uppercase tracking-wider text-fg-faint tnum">
          {rows.length}
        </span>
      </header>
      <table className="w-full text-body">
        <thead>
          <tr className="text-label uppercase tracking-wider text-fg-faint text-left">
            <th className="font-normal pb-1">Agent</th>
            <th className="font-normal pb-1">State</th>
            <th className="font-normal pb-1 text-right">Ctx</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-t border-rule">
              <td className="py-1 pr-2 max-w-[150px]">
                <button
                  type="button"
                  className="block w-full truncate text-left text-fg focus-mark"
                  title={a.rig ? `${a.rig} · ${a.label}` : a.label}
                  onClick={() => onSelect({ kind: 'actor', id: a.id })}
                >
                  {a.label}
                </button>
              </td>
              <td
                className={`py-1 pr-2 truncate max-w-[120px] ${a.stalled ? 'text-accent' : 'text-fg-muted'}`}
              >
                {statusLine(a)}
              </td>
              <td className="py-1 text-right tnum text-fg-muted">
                {a.contextPct === undefined ? '·' : `${Math.round(a.contextPct)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function findBead(model: CityModel, id: string): CityBead | undefined {
  for (const rig of model.rigs) {
    const hit = [...rig.ready, ...rig.mergeQueue].find((b) => b.id === id);
    if (hit) return hit;
  }
  return model.actors.find((a) => a.bead?.id === id)?.bead;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}
