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
    label: 'Sol reviewer',
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
  'feature-refiner': {
    label: 'Feature refiner',
    stage: 'plan',
    sprite: 'planner',
    summary: 'Refines the feature scope and acceptance criteria before implementation.',
  },
  'quality-judge': {
    label: 'Quality judge',
    stage: 'review',
    sprite: 'reviewer',
    summary: 'Evaluates the workflow’s quality evidence and records its verdict.',
  },
  brainstorming: {
    label: 'Brainstorming',
    stage: 'plan',
    sprite: 'planner',
    summary: 'Explores the request and develops the design with the operator.',
  },
  'writing-plans': {
    label: 'Implementation planner',
    stage: 'plan',
    sprite: 'planner',
    summary: 'Writes the implementation plan and its verification steps.',
  },
  implementer: {
    label: 'Implementer',
    stage: 'implement',
    sprite: 'engineer',
    summary: 'Implements the assigned plan and verifies the resulting change.',
  },
  'review-fixer': {
    label: 'Review fixer',
    stage: 'implement',
    sprite: 'engineer',
    summary: 'Resolves review findings and verifies the fixes.',
  },
  'spec-reviewer': {
    label: 'Specification reviewer',
    stage: 'review',
    sprite: 'reviewer',
    summary: 'Reviews the work against the approved specification.',
  },
  'plan-reviewer': {
    label: 'Plan reviewer',
    stage: 'review',
    sprite: 'reviewer',
    summary: 'Reviews the implementation plan before work begins.',
  },
  'code-reviewer': {
    label: 'Code reviewer',
    stage: 'review',
    sprite: 'reviewer',
    summary: 'Reviews the implementation and reports actionable findings.',
  },
  'code-quality-reviewer': {
    label: 'Code quality reviewer',
    stage: 'review',
    sprite: 'reviewer',
    summary: 'Reviews code quality, maintainability and verification coverage.',
  },
  finisher: {
    label: 'Finisher',
    stage: 'publish',
    sprite: 'publisher',
    summary: 'Handles the workflow’s final verification and delivery handoff.',
  },
  'delivery-orchestrator': {
    label: 'Delivery orchestrator',
    stage: 'coordinate',
    sprite: 'planner',
    summary: 'Coordinates the configured build, review and delivery stages.',
  },
  'retrospective-analyst': {
    label: 'Retrospective analyst',
    stage: 'support',
    sprite: 'reviewer',
    summary: 'Analyses completed delivery cycles and records lessons for later work.',
  },
  'ux-auditor': {
    label: 'UX auditor',
    stage: 'review',
    sprite: 'reviewer',
    summary: 'Reviews the assigned user journey and records UX findings.',
  },
  'weekly-reporter': {
    label: 'Report writer',
    stage: 'support',
    sprite: 'publisher',
    summary: 'Summarises the available audit findings into a report when assigned.',
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

export function hasWorkflowAgents(
  actors: readonly Pick<CityActor, 'template' | 'pack'>[],
): boolean {
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
