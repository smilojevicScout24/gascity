import { describe, expect, it } from 'vitest';
import { deriveCity } from './model';
import { hasWorkflowAgents, workflowDistricts, workflowRole } from './workflow';
import type { SupervisorSession } from '../supervisor/sessionReads';
import type { SupervisorAgent } from '../supervisor/agentReads';

describe('workflow presentation', () => {
  it('uses workflow jobs and preserves unknown roles', () => {
    expect(workflowRole('project/gc.implementation-worker')?.stage).toBe('implement');
    expect(workflowRole('gc.design-author')?.label).toBe('Designer');
    expect(workflowRole('gc.review-synthesizer')?.stage).toBe('review');
    expect(workflowRole('gc.publisher')?.stage).toBe('publish');
    expect(workflowRole('custom.other')).toBeUndefined();
  });
  it('keeps configured native workers visible while asleep and detects their view', () => {
    const model = deriveCity({
      sessions: [],
      agents: [
        {
          name: 'project/gc.implementation-worker',
          rig: 'project',
          running: false,
          state: 'stopped',
        } as SupervisorAgent,
      ],
      rigs: [],
      beads: [],
      now: 0,
    });
    expect(model.actors).toHaveLength(1);
    expect(model.actors[0]?.asleep).toBe(true);
    expect(hasWorkflowAgents(model.actors)).toBe(true);
    expect(workflowDistricts(model)[0]?.stages.get('implement')).toHaveLength(1);
  });
  it('does not switch a Gastown city to the native presentation', () => {
    const model = deriveCity({
      sessions: [{ id: 'one', template: 'gastown.polecat', state: 'active' } as SupervisorSession],
      rigs: [],
      beads: [],
      now: 0,
    });
    expect(hasWorkflowAgents(model.actors)).toBe(false);
  });
  it('retains unknown agents in a support office without inventing a workflow role', () => {
    const model = deriveCity({
      sessions: [{ id: 'one', template: 'custom.other', state: 'active' } as SupervisorSession],
      rigs: [],
      beads: [],
      now: 0,
    });
    expect(workflowDistricts(model)[0]?.stages.get('support')?.[0]?.id).toBe('one');
  });
});
