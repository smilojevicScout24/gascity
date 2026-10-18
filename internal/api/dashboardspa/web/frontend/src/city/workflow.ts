import type { CityActor, CityModel } from './model';

export type WorkflowStage = 'coordinate' | 'plan' | 'implement' | 'review' | 'publish' | 'support';
export interface WorkflowRole {
  label: string;
  stage: WorkflowStage;
  sprite: string;
  summary: string;
}

// Presentation owned by this view, not orchestration policy. Templates and live
// assignments remain authoritative; unrecognised roles stay visible as support.
const ROLES: Readonly<Record<string, WorkflowRole>> = {
  'run-operator': {
    label: 'Workflow coordinator',
    stage: 'coordinate',
    sprite: 'planner',
    summary: 'Runs the delivery formula and coordinates its durable steps.',
  },
  mayor: {
    label: 'Planning coordinator',
    stage: 'coordinate',
    sprite: 'planner',
    summary: 'Clarifies the request and starts the appropriate delivery workflow.',
  },
  'requirements-planner': {
    label: 'Requirements planner',
    stage: 'plan',
    sprite: 'planner',
    summary: 'Clarifies requirements and acceptance criteria.',
  },
  'design-author': {
    label: 'Designer',
    stage: 'plan',
    sprite: 'planner',
    summary: 'Writes the implementation plan and design artifacts.',
  },
  'task-decomposer': {
    label: 'Task decomposer',
    stage: 'plan',
    sprite: 'planner',
    summary: 'Breaks the approved plan into tasks and dependencies.',
  },
  'implementation-worker': {
    label: 'Implementation worker',
    stage: 'implement',
    sprite: 'engineer',
    summary: 'Implements assigned work in its isolated workspace.',
  },
  'gap-analyst': {
    label: 'Gap analyst',
    stage: 'review',
    sprite: 'reviewer',
    summary: 'Checks the delivered work against requirements.',
  },
  'implementation-reviewer': {
    label: 'Implementation reviewer',
    stage: 'review',
    sprite: 'reviewer',
    summary: 'Reviews the implementation and records findings.',
  },
  'design-implementation-reviewer': {
    label: 'Design reviewer',
    stage: 'review',
    sprite: 'reviewer',
    summary: 'Reviews whether the proposed design can be implemented correctly.',
  },
  'design-test-risk-reviewer': {
    label: 'Test and risk reviewer',
    stage: 'review',
    sprite: 'reviewer',
    summary: 'Reviews verification coverage and implementation risk.',
  },
  'review-synthesizer': {
    label: 'Review coordinator',
    stage: 'review',
    sprite: 'reviewer',
    summary: 'Combines review findings into an actionable verdict.',
  },
  'sol-reviewer': {
    label: 'Code reviewer',
    stage: 'review',
    sprite: 'reviewer',
    summary: 'Runs the configured code review and verification lane.',
  },
  publisher: {
    label: 'Publisher',
    stage: 'publish',
    sprite: 'publisher',
    summary: 'Performs the workflow’s configured publication step.',
  },
  'issue-triager': {
    label: 'Issue triager',
    stage: 'plan',
    sprite: 'planner',
    summary: 'Investigates and classifies incoming issues.',
  },
};

export function workflowRole(template: string): WorkflowRole | undefined {
  const leaf =
    template
      .slice(template.lastIndexOf('/') + 1)
      .split('.')
      .pop() ?? '';
  return ROLES[leaf];
}

export function hasWorkflowAgents(actors: readonly CityActor[]): boolean {
  return actors.some(
    (actor) =>
      /(?:^|[/.])(?:gc|superpowers)\./.test(actor.template) || actor.pack === 'superpowers',
  );
}

export const WORKFLOW_STAGES: ReadonlyArray<{
  id: WorkflowStage;
  label: string;
  building: string;
}> = [
  { id: 'coordinate', label: 'Coordination', building: 'townhall' },
  { id: 'plan', label: 'Planning studio', building: 'townhall' },
  { id: 'implement', label: 'Engineering', building: 'bench' },
  { id: 'review', label: 'Review bureau', building: 'tower' },
  { id: 'publish', label: 'Release office', building: 'gate' },
  { id: 'support', label: 'Other agents', building: 'kennel' },
];

export interface WorkflowDistrict {
  name: string;
  actors: CityActor[];
  stages: Map<WorkflowStage, CityActor[]>;
}

export function workflowDistricts(model: CityModel): WorkflowDistrict[] {
  const names = [
    ...new Set([
      ...model.rigs.map((r) => r.name),
      ...model.actors.map((a) => a.rig).filter((r): r is string => !!r),
    ]),
  ];
  if (model.actors.some((a) => !a.rig)) names.unshift('City services');
  return names.map((name) => {
    const actors = model.actors.filter((a) => (name === 'City services' ? !a.rig : a.rig === name));
    const stages = new Map<WorkflowStage, CityActor[]>();
    for (const actor of actors) {
      const stage = workflowRole(actor.template)?.stage ?? 'support';
      stages.set(stage, [...(stages.get(stage) ?? []), actor]);
    }
    return { name, actors, stages };
  });
}
