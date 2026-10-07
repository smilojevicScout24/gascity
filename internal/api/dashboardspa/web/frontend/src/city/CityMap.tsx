// SVG town map. Renders a CityModel at CityLayout positions; movement comes
// from CSS transitions on `transform`, so a bead that changes place between
// two supervisor snapshots glides to its new spot.

import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { CityActor, CityBead, CityModel } from './model';
import {
  HALL,
  KENNEL,
  PATROL,
  SPRITE_SIZE,
  STREET_Y,
  DISTRICT_HEIGHT,
  DISTRICT_TOP,
  VIEWBOX,
  type CityLayout,
  type DistrictLayout,
  type Point,
} from './layout';
import { spriteFor, spriteUrl } from './sprites';

export type CitySelection = { kind: 'actor'; id: string } | { kind: 'bead'; id: string };

export interface CityFx {
  slinging: boolean;
  nudging: ReadonlySet<string>;
  /** Dogs out on an errand: current target and facing. */
  dogs: ReadonlyMap<string, { at: Point; dir: 1 | -1 }>;
  envelopes: ReadonlyArray<{ key: string; from: Point; to: Point }>;
  sparks: ReadonlyArray<{ key: string; at: Point }>;
  scans: ReadonlyArray<{ key: string; from: Point; to: Point; tone: 'merge' | 'civic' }>;
}

interface CityMapProps {
  model: CityModel;
  layout: CityLayout;
  fx: CityFx;
  selected: CitySelection | null;
  onSelect: (selection: CitySelection) => void;
  /** Beads present when the page first loaded; anything new spawns from the mayor. */
  initialBeads: ReadonlySet<string>;
}

export function CityMap({ model, layout, fx, selected, onSelect, initialBeads }: CityMapProps) {
  const beadIndex = indexBeads(model);
  const mergeIds = new Set(
    model.rigs.flatMap((r) => [
      ...r.mergeQueue.map((b) => b.id),
      ...(r.refinery?.bead ? [r.refinery.bead.id] : []),
    ]),
  );
  const readyIds = new Set(model.rigs.flatMap((r) => r.ready.map((b) => b.id)));
  const isSelected = (kind: CitySelection['kind'], id: string) =>
    selected?.kind === kind && selected.id === id;
  const actorProps = (a: CityActor) => ({
    actor: a,
    selected: isSelected('actor', a.id),
    onSelect: () => onSelect({ kind: 'actor', id: a.id }),
  });

  return (
    <svg
      className="city-map block w-full h-auto"
      viewBox={`${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.w} ${VIEWBOX.h}`}
      role="group"
      aria-label="Animated town map of the city: mayor, rigs, polecats, witness, refinery and their beads"
    >
      <defs>
        <pattern id="city-belt" width="16" height="10" patternUnits="userSpaceOnUse">
          <path d="M0 10 L8 0" stroke="oklch(var(--rule))" strokeWidth="1.5" />
        </pattern>
      </defs>

      <Ground layout={layout} />

      <g>
        {fx.scans.map((s) => (
          <line
            key={s.key}
            className="city-scan"
            x1={s.from.x}
            y1={s.from.y}
            x2={s.to.x}
            y2={s.to.y}
            stroke={s.tone === 'merge' ? 'var(--city-merge)' : 'var(--city-civic)'}
            strokeDasharray="4 5"
            strokeWidth={1.5}
          />
        ))}
      </g>

      <g>
        {model.mayor && (
          <Figure
            {...actorProps(model.mayor)}
            at={layout.mayor}
            sprite={spriteFor(model.mayor, { slinging: fx.slinging })}
          />
        )}
        {model.boot && (
          <Figure {...actorProps(model.boot)} at={layout.boot} sprite={spriteFor(model.boot)} />
        )}
        {model.dogs.slice(0, layout.dogs.length).map((d, i) => {
          const errand = fx.dogs.get(d.id);
          return (
            <Figure
              key={d.id}
              {...actorProps(d)}
              at={errand?.at ?? layout.dogs[i]!}
              moving="dog"
              flip={errand?.dir === -1}
              sprite={spriteFor(d, { running: errand !== undefined })}
              hideLabels
            />
          );
        })}
        {model.visitors.slice(0, layout.visitors.length).map((v, i) => (
          <Visitor key={v.id} {...actorProps(v)} at={layout.visitors[i]!} />
        ))}
        {layout.hiddenVisitors > 0 && (
          <text
            x={layout.visitors[layout.visitors.length - 1]!.x + 34}
            y={HALL.y - 14}
            fontSize={11}
          >
            +{layout.hiddenVisitors}
          </text>
        )}
        {model.deacon && <Deacon {...actorProps(model.deacon)} />}

        {layout.districts.map((d) => (
          <g key={d.rig.name}>
            {d.rig.witness && (
              <Figure
                {...actorProps(d.rig.witness)}
                at={d.witness}
                sprite={spriteFor(d.rig.witness, { nudging: fx.nudging.has(d.rig.witness.id) })}
              />
            )}
            {d.rig.refinery && (
              <Figure
                {...actorProps(d.rig.refinery)}
                at={d.refinery}
                sprite={spriteFor(d.rig.refinery)}
              />
            )}
            {d.rig.polecats.slice(0, d.slots.length).map((p, i) => (
              <Figure
                key={p.id}
                {...actorProps(p)}
                at={d.slots[i]!}
                sprite={spriteFor(p)}
                contextBar
              >
                {p.bead && !p.asleep && (
                  <Bubble
                    bead={p.bead}
                    onSelect={() => onSelect({ kind: 'bead', id: p.bead!.id })}
                  />
                )}
              </Figure>
            ))}
          </g>
        ))}
      </g>

      <g>
        {[...layout.beads].map(([id, at]) => {
          const bead = beadIndex.get(id);
          if (!bead) return null;
          const tone = mergeIds.has(id) ? 'merge' : readyIds.has(id) ? 'open' : 'work';
          return (
            <BeadToken
              key={id}
              bead={bead}
              at={at}
              tone={tone}
              spawn={initialBeads.has(id) ? undefined : layout.mayorHand}
              selected={isSelected('bead', id)}
              onSelect={() => onSelect({ kind: 'bead', id })}
            />
          );
        })}
      </g>

      <g aria-hidden="true">
        {fx.envelopes.map((e) => (
          <Travel key={e.key} from={e.from} to={e.to}>
            <rect
              x={-8}
              y={-6}
              width={16}
              height={11}
              rx={2}
              fill="oklch(var(--surface))"
              stroke="oklch(var(--fg-muted))"
            />
            <path d="M-8 -6 L0 1 L8 -6" fill="none" stroke="oklch(var(--fg-muted))" />
          </Travel>
        ))}
        {fx.sparks.map((s) => (
          <circle
            key={s.key}
            className="city-spark"
            cx={s.at.x}
            cy={s.at.y}
            r={6}
            fill="none"
            stroke="oklch(var(--ok))"
            strokeWidth={2}
          />
        ))}
      </g>
    </svg>
  );
}

function Ground({ layout }: { layout: CityLayout }) {
  return (
    <g aria-hidden="true">
      <rect
        x={20}
        y={STREET_Y - 10}
        width={1160}
        height={20}
        rx={10}
        fill="oklch(var(--surface-tint))"
      />
      <text x={1170} y={STREET_Y + 4} textAnchor="end" fontSize={10} className="city-caps">
        deacon patrol
      </text>
      <Sprite name="bldg-townhall" at={HALL} size={170} />
      <text x={HALL.x} y={HALL.y + 16} textAnchor="middle" fontSize={10} className="city-caps">
        TOWN HALL
      </text>
      <Sprite name="bldg-kennel" at={KENNEL} size={110} />
      <text x={KENNEL.x} y={KENNEL.y + 16} textAnchor="middle" fontSize={10} className="city-caps">
        KENNEL · ORDERS
      </text>
      {layout.districts.length === 0 && (
        <text x={VIEWBOX.w / 2} y={DISTRICT_TOP + 120} textAnchor="middle" fontSize={15}>
          No rigs registered in this city yet.
        </text>
      )}
      {layout.districts.map((d) => (
        <District key={d.rig.name} d={d} />
      ))}
      {layout.hiddenRigs > 0 && (
        <text x={1170} y={DISTRICT_TOP - 8} textAnchor="end" fontSize={11}>
          +{layout.hiddenRigs} more rigs on the Agents page
        </text>
      )}
    </g>
  );
}

function District({ d }: { d: DistrictLayout }) {
  const { rig } = d;
  return (
    <g>
      <rect
        x={d.ox}
        y={DISTRICT_TOP}
        width={d.w}
        height={DISTRICT_HEIGHT}
        rx={8}
        fill="none"
        stroke="oklch(var(--rule))"
        strokeWidth={1.5}
      />
      <text x={d.ox + 18} y={238} fontSize={15} fontWeight={600} className="city-name">
        {rig.name}
      </text>
      <text x={d.ox + 18} y={256} fontSize={11}>
        {`rig${rig.branch ? ` · ${rig.branch}` : ''} · ${rig.mergedToday} merged today`}
      </text>
      <rect
        x={d.ox + 18}
        y={272}
        width={170}
        height={96}
        rx={4}
        fill="none"
        stroke="oklch(var(--rule))"
        strokeDasharray="3 3"
      />
      <text x={d.ox + 26} y={288} fontSize={10} className="city-caps">
        {`READY · ${rig.readyTotal}`}
      </text>
      {d.slots.map((s, i) => (
        <Sprite key={i} name="bldg-bench" at={{ x: s.x + 50, y: s.y - 2 }} size={74} />
      ))}
      {d.overflow > 0 && (
        <text x={d.slots[d.slots.length - 1]!.x + 50} y={572} textAnchor="middle" fontSize={11}>
          +{d.overflow} more polecats
        </text>
      )}
      <Sprite name="bldg-tower" at={d.tower} size={130} />
      <rect
        x={d.beltStart.x - 10}
        y={592}
        width={d.beltEnd.x - d.beltStart.x + 20}
        height={16}
        rx={8}
        fill="url(#city-belt)"
        stroke="oklch(var(--rule))"
      />
      <text x={d.ox + 18} y={582} fontSize={10} className="city-caps">
        {`MERGE QUEUE · ${rig.mergeQueue.length}`}
      </text>
      <Sprite name="bldg-gate" at={d.gate} size={100} />
      <text x={d.gate.x} y={664} textAnchor="middle" fontSize={11}>
        {truncate(rig.branch ?? 'main', 11)}
      </text>
    </g>
  );
}

function Sprite({ name, at, size }: { name: string; at: Point; size: number }) {
  const href = spriteUrl(name);
  if (!href) return null;
  return <image href={href} x={at.x - size / 2} y={at.y - size} width={size} height={size} />;
}

interface FigureProps {
  actor: CityActor;
  at: Point;
  sprite: string;
  selected: boolean;
  onSelect: () => void;
  flip?: boolean;
  moving?: 'dog';
  hideLabels?: boolean;
  contextBar?: boolean;
  children?: ReactNode;
}

function Figure({
  actor,
  at,
  sprite,
  selected,
  onSelect,
  flip,
  moving,
  hideLabels,
  contextBar,
  children,
}: FigureProps) {
  const size = SPRITE_SIZE[actor.role];
  const status = statusLine(actor);
  const classes = [
    'city-hit',
    'city-fade',
    moving === 'dog' ? 'city-dog' : '',
    selected ? 'city-selected' : '',
    actor.stalled ? 'city-stalled' : '',
    actor.role === 'polecat' && actor.pose === 'tool' ? 'city-tooling' : '',
  ].join(' ');
  return (
    <g
      className={classes}
      style={{ transform: `translate(${at.x}px, ${at.y}px)`, opacity: actor.asleep ? 0.8 : 1 }}
      {...selectable(onSelect, `${actor.label}, ${status}`)}
    >
      <title>{`${actor.rig ? `${actor.rig} · ` : ''}${actor.label} · ${status}`}</title>
      <rect
        className="city-focus"
        x={-size * 0.32}
        y={-size * 0.88}
        width={size * 0.64}
        height={size * 0.88 + 36}
        rx={6}
        fill="transparent"
        stroke="transparent"
        strokeWidth={1.5}
      />
      <g transform={flip ? 'scale(-1,1)' : undefined}>
        <g className="city-bob">
          {sprite && (
            <image href={spriteUrl(sprite)} x={-size / 2} y={-size} width={size} height={size} />
          )}
        </g>
      </g>
      {!hideLabels && (
        <>
          <text y={18} textAnchor="middle" fontSize={12.5} className="city-name">
            {truncate(actor.label, 14)}
          </text>
          <text y={32} textAnchor="middle" fontSize={11}>
            {truncate(status, 17)}
          </text>
        </>
      )}
      {contextBar && (
        <>
          <rect x={-30} y={38} width={60} height={3} rx={1.5} fill="oklch(var(--rule))" />
          <rect
            x={-30}
            y={38}
            width={(60 * Math.min(100, actor.contextPct ?? 0)) / 100}
            height={3}
            rx={1.5}
            fill={actor.stalled ? 'oklch(var(--accent))' : 'var(--city-work)'}
          />
        </>
      )}
      {children}
    </g>
  );
}

function Deacon({
  actor,
  selected,
  onSelect,
}: {
  actor: CityActor;
  selected: boolean;
  onSelect: () => void;
}) {
  const size = SPRITE_SIZE.deacon;
  const status = statusLine(actor);
  const walking = !actor.asleep;
  return (
    <g transform={`translate(${PATROL.from},${STREET_Y + 4})`}>
      <g
        className={`city-hit ${walking ? 'city-patrol' : ''} ${selected ? 'city-selected' : ''}`}
        {...selectable(onSelect, `${actor.label}, ${status}`)}
      >
        <title>{`${actor.label} · ${status}`}</title>
        <rect
          className="city-focus"
          x={-size * 0.32}
          y={-size * 0.88}
          width={size * 0.64}
          height={size * 0.88 + 36}
          rx={6}
          fill="transparent"
          stroke="transparent"
          strokeWidth={1.5}
        />
        <g className={walking ? 'city-face' : undefined} opacity={actor.asleep ? 0.8 : 1}>
          {walking ? (
            <>
              <image
                className="city-walk-a"
                href={spriteUrl('deacon-walk-1')}
                x={-size / 2}
                y={-size}
                width={size}
                height={size}
              />
              <image
                className="city-walk-b"
                href={spriteUrl('deacon-walk-2')}
                x={-size / 2}
                y={-size}
                width={size}
                height={size}
              />
              <image
                className="city-still"
                href={spriteUrl('deacon-idle')}
                x={-size / 2}
                y={-size}
                width={size}
                height={size}
              />
            </>
          ) : (
            <image
              href={spriteUrl('deacon-idle')}
              x={-size / 2}
              y={-size}
              width={size}
              height={size}
            />
          )}
        </g>
        <text y={18} textAnchor="middle" fontSize={12.5} className="city-name">
          {actor.label}
        </text>
        <text y={32} textAnchor="middle" fontSize={11}>
          {truncate(status, 17)}
        </text>
      </g>
    </g>
  );
}

function Visitor({
  actor,
  at,
  selected,
  onSelect,
}: {
  actor: CityActor;
  at: Point;
  selected: boolean;
  onSelect: () => void;
}) {
  const status = statusLine(actor);
  return (
    <g
      className={`city-hit ${selected ? 'city-selected' : ''}`}
      style={{ transform: `translate(${at.x}px, ${at.y}px)`, opacity: actor.asleep ? 0.6 : 1 }}
      {...selectable(onSelect, `${actor.label}, ${status}`)}
    >
      <title>{`${actor.template} · ${actor.label} · ${status}`}</title>
      <circle
        className="city-focus"
        cy={-20}
        r={18}
        fill="oklch(var(--surface-tint))"
        stroke="oklch(var(--rule))"
        strokeWidth={1.5}
      />
      <text y={-16} textAnchor="middle" fontSize={11} className="city-name">
        {actor.label.slice(0, 2).toUpperCase()}
      </text>
      <text y={14} textAnchor="middle" fontSize={11}>
        {truncate(actor.label, 10)}
      </text>
    </g>
  );
}

function Bubble({ bead, onSelect }: { bead: CityBead; onSelect: () => void }) {
  return (
    <g
      className="city-hit"
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <rect
        x={-56}
        y={-128}
        width={112}
        height={42}
        rx={6}
        fill="oklch(var(--surface))"
        stroke="oklch(var(--rule))"
      />
      <path d="M-5 -86 L0 -79 L5 -86" fill="oklch(var(--surface))" stroke="oklch(var(--rule))" />
      <rect x={-4} y={-88} width={8} height={3} fill="oklch(var(--surface))" />
      <text x={-48} y={-113} fontSize={10.5}>
        {`${bead.id} · ${bead.type}`}
      </text>
      <text x={-48} y={-97} fontSize={12} className="city-name">
        {truncate(bead.title || bead.id, 17)}
      </text>
    </g>
  );
}

function BeadToken({
  bead,
  at,
  tone,
  spawn,
  selected,
  onSelect,
}: {
  bead: CityBead;
  at: Point;
  tone: 'open' | 'work' | 'merge';
  spawn: Point | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const pos = useArrival(at, spawn);
  const fill =
    tone === 'open'
      ? 'oklch(var(--surface))'
      : tone === 'work'
        ? 'var(--city-work)'
        : 'var(--city-merge)';
  const stroke = tone === 'open' ? 'oklch(var(--fg-faint))' : fill;
  return (
    <g
      className={`city-hit city-moving ${selected ? 'city-selected' : ''}`}
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      {...selectable(onSelect, `bead ${bead.id}, ${bead.title}`)}
    >
      <title>{`${bead.id} · ${bead.title} · ${bead.status}`}</title>
      <circle
        className="city-focus"
        r={10}
        fill="transparent"
        stroke="transparent"
        strokeWidth={1.5}
      />
      <circle r={6} fill={fill} stroke={stroke} strokeWidth={2} />
    </g>
  );
}

function Travel({ from, to, children }: { from: Point; to: Point; children: ReactNode }) {
  const pos = useArrival(to, from);
  return (
    <g className="city-moving" style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
      {children}
    </g>
  );
}

/** Render at `spawn` for one frame, then at `at`, so the CSS transition animates the arrival. */
function useArrival(at: Point, spawn: Point | undefined): Point {
  const [arrived, setArrived] = useState(spawn === undefined);
  useEffect(() => {
    if (arrived) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setArrived(true)));
    return () => cancelAnimationFrame(id);
  }, [arrived]);
  return arrived || spawn === undefined ? at : spawn;
}

function selectable(onSelect: () => void, label: string) {
  return {
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onClick: onSelect,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect();
      }
    },
  };
}

export function statusLine(actor: CityActor): string {
  if (actor.asleep) return 'asleep';
  if (actor.state === 'failed') return 'failed';
  if (actor.quietMinutes !== undefined) return `quiet ${actor.quietMinutes}m`;
  if (actor.role === 'refinery' && actor.bead) return `merging ${actor.bead.id}`;
  return actor.activity ?? actor.state;
}

function indexBeads(model: CityModel): Map<string, CityBead> {
  const index = new Map<string, CityBead>();
  for (const rig of model.rigs) {
    for (const b of [...rig.ready, ...rig.mergeQueue]) index.set(b.id, b);
  }
  for (const a of model.actors) if (a.bead) index.set(a.bead.id, a.bead);
  return index;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
