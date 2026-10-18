// Town-map geometry in SVG user units (viewBox 0 -55 1200 755). Sprites are
// square with feet on the bottom edge, so every actor position is a feet point.

import type { CityModel, CityRig } from './model';

export interface Point {
  x: number;
  y: number;
}

export const VIEWBOX = { x: 0, y: -55, w: 1200, h: 755 } as const;
export const STREET_Y = 182;
export const HALL: Point = { x: 600, y: 125 };
export const KENNEL: Point = { x: 120, y: 128 };
export const DISTRICT_TOP = 210;
export const DISTRICT_HEIGHT = 470;
export const PATROL = { from: 220, to: 1110 } as const;

/** Rendered sprite sizes; the drawn character is ~85% of this height. */
export const SPRITE_SIZE = {
  mayor: 92,
  deacon: 86,
  polecat: 92,
  witness: 80,
  refinery: 90,
  boot: 64,
  dog: 74,
  visitor: 44,
} as const;

const SLOT_W = 116;
const MAX_DISTRICTS = 3;
const MAX_DOGS = 3;
const MIN_BENCHES = 4;
const MAX_VISITORS = 5;

export interface DistrictLayout {
  rig: CityRig;
  ox: number;
  w: number;
  slots: Point[];
  overflow: number;
  readySlot: (i: number) => Point;
  tower: Point;
  witness: Point;
  gate: Point;
  gateInlet: Point;
  beltStart: Point;
  beltEnd: Point;
  beltSlot: (i: number) => Point;
  beltCapacity: number;
  refinery: Point;
}

export interface CityLayout {
  districts: DistrictLayout[];
  hiddenRigs: number;
  mayor: Point;
  mayorHand: Point;
  boot: Point;
  dogs: Point[];
  visitors: Point[];
  hiddenVisitors: number;
  actors: Map<string, Point>;
  beads: Map<string, Point>;
}

export function layoutCity(model: CityModel): CityLayout {
  const shown = model.rigs.slice(0, MAX_DISTRICTS);
  const gap = 30;
  const w = shown.length === 0 ? 0 : (VIEWBOX.w - 40 - gap * (shown.length - 1)) / shown.length;
  const districts = shown.map((rig, i) => district(rig, 20 + i * (w + gap), w));

  const mayor = { x: HALL.x + 112, y: HALL.y + 4 };
  const boot = { x: KENNEL.x + 210, y: KENNEL.y };
  const dogs = Array.from({ length: MAX_DOGS }, (_, i) => ({
    x: KENNEL.x + 78 + i * 38,
    y: KENNEL.y,
  }));
  const visitors = Array.from({ length: MAX_VISITORS }, (_, i) => ({ x: 900 + i * 58, y: HALL.y }));

  const actors = new Map<string, Point>();
  const beads = new Map<string, Point>();
  if (model.mayor) actors.set(model.mayor.id, mayor);
  if (model.boot) actors.set(model.boot.id, boot);
  model.dogs.slice(0, MAX_DOGS).forEach((d, i) => actors.set(d.id, dogs[i]!));
  model.visitors.slice(0, MAX_VISITORS).forEach((v, i) => actors.set(v.id, visitors[i]!));
  if (model.deacon) actors.set(model.deacon.id, { x: PATROL.from, y: STREET_Y + 4 });

  for (const d of districts) {
    d.rig.ready.forEach((b, i) => beads.set(b.id, d.readySlot(i)));
    d.rig.polecats.slice(0, d.slots.length).forEach((p, i) => {
      const slot = d.slots[i]!;
      actors.set(p.id, slot);
      if (p.bead && !p.asleep) beads.set(p.bead.id, { x: slot.x + 56, y: slot.y - 128 });
    });
    if (d.rig.witness) actors.set(d.rig.witness.id, d.witness);
    if (d.rig.refinery) {
      actors.set(d.rig.refinery.id, d.refinery);
      if (d.rig.refinery.bead) beads.set(d.rig.refinery.bead.id, d.beltEnd);
    }
    d.rig.mergeQueue.slice(0, d.beltCapacity).forEach((b, i) => beads.set(b.id, d.beltSlot(i + 1)));
  }

  return {
    districts,
    hiddenRigs: Math.max(0, model.rigs.length - shown.length),
    mayor,
    mayorHand: { x: mayor.x + 20, y: mayor.y - 62 },
    boot,
    dogs,
    visitors,
    hiddenVisitors: Math.max(0, model.visitors.length - MAX_VISITORS),
    actors,
    beads,
  };
}

function district(rig: CityRig, ox: number, w: number): DistrictLayout {
  // Draw only as many benches as the rig needs (at least a few), up to what fits.
  const fit = Math.max(1, Math.floor((w - 90) / SLOT_W));
  const slotCount = Math.min(fit, Math.max(MIN_BENCHES, rig.polecats.length));
  const slots = Array.from({ length: slotCount }, (_, i) => ({ x: ox + 72 + i * SLOT_W, y: 520 }));
  const gx = ox + w - 125;
  const beltStart = { x: ox + 40, y: 600 };
  const beltEnd = { x: gx - 62, y: 600 };
  return {
    rig,
    ox,
    w,
    slots,
    overflow: Math.max(0, rig.polecats.length - slotCount),
    readySlot: (i) => ({ x: ox + 34 + (i % 7) * 22, y: 312 + Math.floor(i / 7) * 22 }),
    tower: { x: ox + w - 112, y: 345 },
    witness: { x: ox + w - 54, y: 345 },
    gate: { x: gx, y: 648 },
    gateInlet: { x: gx, y: 612 },
    beltStart,
    beltEnd,
    beltSlot: (i) => ({ x: beltEnd.x - i * 26, y: beltEnd.y }),
    beltCapacity: Math.max(0, Math.floor((beltEnd.x - beltStart.x) / 26) - 1),
    refinery: { x: ox + w - 56, y: 640 },
  };
}
