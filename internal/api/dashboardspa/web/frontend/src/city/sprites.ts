// Sprite URLs resolved through Vite so they ship content-hashed under
// assets/ (immutable-cached by the embedded SPA handler).

import type { CityActor } from './model';

const URLS = import.meta.glob<string>('./sprites/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

export function spriteUrl(name: string): string {
  return URLS[`./sprites/${name}.webp`] ?? '';
}

const VARIANTS = ['a', 'b', 'c'] as const;

export interface ActorFx {
  slinging?: boolean;
  nudging?: boolean;
  running?: boolean;
}

/** Sprite name for an actor's current state; transient fx (from events) override. */
export function spriteFor(actor: CityActor, fx: ActorFx = {}): string {
  switch (actor.role) {
    case 'polecat':
      return `polecat-${VARIANTS[actor.variant]}-${actor.pose}`;
    case 'mayor':
      return fx.slinging ? 'mayor-sling' : 'mayor-idle';
    case 'witness':
      return fx.nudging ? 'witness-nudge' : 'witness-idle';
    case 'refinery':
      return actor.bead ? 'refinery-merge' : 'refinery-idle';
    case 'dog':
      return fx.running ? 'dog-run' : 'dog-idle';
    case 'boot':
      return 'boot-idle';
    case 'deacon':
      return 'deacon-idle';
    case 'visitor':
      return '';
  }
}
