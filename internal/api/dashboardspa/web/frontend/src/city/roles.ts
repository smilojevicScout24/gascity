// One-line "what does this agent do" for the City detail panel, condensed
// from the Gastown pack's role prompts. An agent's own `description` (packs
// may set one) wins over these.

import type { CityActor, CityRole } from './model';

const ROLE_SUMMARY: Readonly<Record<Exclude<CityRole, 'visitor'>, string>> = {
  mayor:
    'Town coordinator: files work as beads and slings them to rig polecats; only codes when that is faster.',
  deacon:
    'Town-wide night watch: closes gates, tracks cross-rig convoys, checks witnesses and refineries keep moving, dispatches maintenance.',
  boot: 'Deacon watchdog: every patrol answers one question, is the deacon stuck?',
  dog: 'Utility worker: runs a maintenance formula (such as the shutdown dance for a stuck agent), then exits.',
  witness:
    'Rig health monitor: spots stuck polecats, recovers orphaned beads, watches the merge queue, escalates to the mayor. Never writes code.',
  refinery:
    'Rig merge queue: takes branches polecats hand off, runs checks, merges or opens a PR, rejects failures. Never writes code.',
  polecat:
    'Rig worker: claims a bead, implements it in its own worktree, pushes a branch and hands it to the refinery.',
};

export function roleSummary(actor: CityActor): string {
  if (actor.description) return actor.description;
  if (actor.role === 'visitor') {
    return actor.pack ? `Agent from the ${actor.pack} pack.` : 'Agent from another pack.';
  }
  return ROLE_SUMMARY[actor.role];
}
