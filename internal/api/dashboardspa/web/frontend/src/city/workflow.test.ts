import { describe, expect, it } from 'vitest';
import { deriveCity } from './model';
import { hasWorkflowAgents, workflowDistricts, workflowRole } from './workflow';
import type { SupervisorSession } from '../supervisor/sessionReads';
import type { SupervisorAgent } from '../supervisor/agentReads';
import { roleSummary } from './roles';

describe('workflow presentation', () => {
  it('groups the configured Gas City, Superpowers and extension roles by their actual duties', () => {
    const stages = {
      'gc.feature-refiner': 'plan',
      'gc.quality-judge': 'review',
      'superpowers.brainstorming': 'plan',
      'superpowers.writing-plans': 'plan',
      'superpowers.implementer': 'implement',
      'superpowers.review-fixer': 'implement',
      'superpowers.spec-reviewer': 'review',
      'superpowers.plan-reviewer': 'review',
      'superpowers.code-reviewer': 'review',
      'superpowers.code-quality-reviewer': 'review',
      'superpowers.finisher': 'publish',
      'delivery-pipeline.delivery-orchestrator': 'coordinate',
      'sol-pre-push-review.sol-reviewer': 'review',
      'cycle-retrospective.retrospective-analyst': 'support',
    };
    for (const [template, stage] of Object.entries(stages)) {
      expect(workflowRole(`project/${template}`)?.stage, template).toBe(stage);
    }
  });
  it('retains every configured agent in workflow mode, including unknown roles and other packs', () => {
    const names = [
      'gc.feature-refiner',
      'gc.quality-judge',
      'superpowers.brainstorming',
      'sol-pre-push-review.sol-reviewer',
      'delivery-pipeline.delivery-orchestrator',
      'custom.helper',
    ];
    const model = deriveCity({
      sessions: [],
      agents: names.map(
        (name) =>
          ({
            name: `project/${name}`,
            rig: 'project',
            running: false,
            state: 'stopped',
          }) as SupervisorAgent,
      ),
      rigs: [],
      beads: [],
      now: 0,
    });
    expect(model.actors).toHaveLength(names.length);
    expect(model.actors.every((actor) => actor.asleep)).toBe(true);
    expect(
      workflowDistricts(model)[0]
        ?.stages.get('support')
        ?.map((a) => a.alias),
    ).toContain('project/custom.helper');
  });
  it('does not count a configured running agent without a reported session as an awake session', () => {
    const model = deriveCity({
      sessions: [],
      agents: [{ name: 'custom.helper', running: true, state: 'idle' } as SupervisorAgent],
      rigs: [],
      beads: [],
      now: 0,
    });
    expect(model.actors).toHaveLength(1);
    expect(model.actors[0]?.asleep).toBe(false);
    expect(model.counts.awake).toBe(0);
  });
  it('uses the planning coordinator description in workflow mode and keeps the Gastown description', () => {
    const model = deriveCity({
      sessions: [{ id: 'one', template: 'mayor', state: 'active' } as SupervisorSession],
      rigs: [],
      beads: [],
      now: 0,
    });
    expect(roleSummary(model.mayor!, 'gascity')).toContain('Clarifies the request');
    expect(roleSummary(model.mayor!, 'gastown')).toContain('polecats');
  });
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
