import type { CityActor, CityModel } from './model';
import type { CitySelection } from './CityMap';
import { spriteFor, spriteUrl, workflowPortrait } from './sprites';
import { workflowDistricts, workflowRole, WORKFLOW_STAGES } from './workflow';

export function WorkflowCity({
  model,
  selected,
  onSelect,
}: {
  model: CityModel;
  selected: CitySelection | null;
  onSelect: (selection: CitySelection) => void;
}) {
  const districts = workflowDistricts(model);
  return (
    <div className="workflow-city" aria-label="Live delivery workflow city">
      <div className="workflow-intro">
        <span className="workflow-eyebrow">THE DELIVERY CITY</span>
        <h2>From an idea to delivered work</h2>
        <p>
          Planning, implementation and review follow the running formula. Each district is a real
          project; each resident is a configured agent.
        </p>
      </div>
      {districts.length === 0 && (
        <p className="p-6 text-fg-muted">No projects or agents are registered yet.</p>
      )}
      {districts.map((district) => (
        <section className="workflow-district" key={district.name} aria-label={district.name}>
          <header>
            <h3>{district.name}</h3>
            <span>
              {district.actors.filter((a) => !a.asleep).length} awake · {district.actors.length}{' '}
              agents
            </span>
          </header>
          <div className="workflow-street">
            {WORKFLOW_STAGES.filter(
              (stage) => stage.id !== 'support' || district.stages.has('support'),
            ).map((stage) => (
              <section className="workflow-office" key={stage.id} aria-label={stage.label}>
                <div className="workflow-building">
                  <img src={spriteUrl(`bldg-${stage.building}`)} alt="" />
                  <h4>{stage.label}</h4>
                </div>
                {(district.stages.get(stage.id) ?? []).length === 0 && (
                  <p className="workflow-vacant">No configured agents</p>
                )}
                {(district.stages.get(stage.id) ?? []).map((actor) => (
                  <Resident
                    key={actor.id}
                    actor={actor}
                    selected={selected?.kind === 'actor' && selected.id === actor.id}
                    onSelect={onSelect}
                  />
                ))}
              </section>
            ))}
          </div>
          {(model.rigs.find((r) => r.name === district.name)?.ready.length ?? 0) > 0 && (
            <div className="workflow-ready">
              <span>Ready for assignment</span>
              {model.rigs
                .find((r) => r.name === district.name)
                ?.ready.map((bead) => (
                  <button
                    key={bead.id}
                    type="button"
                    onClick={() => onSelect({ kind: 'bead', id: bead.id })}
                  >
                    {bead.title || bead.id}
                  </button>
                ))}
            </div>
          )}
        </section>
      ))}
      <p className="workflow-footnote">
        Assignments and activity update live. Office order describes disciplines; the formula
        controls dependencies, parallel work and review loops.
      </p>
    </div>
  );
}

function Resident({
  actor,
  selected,
  onSelect,
}: {
  actor: CityActor;
  selected: boolean;
  onSelect: (selection: CitySelection) => void;
}) {
  const role = workflowRole(actor.template);
  const portrait = workflowPortrait(actor.template) ?? (spriteUrl(spriteFor(actor)) || undefined);
  const state = actor.asleep
    ? 'asleep'
    : actor.stalled
      ? 'needs attention'
      : (actor.activity ?? actor.state);
  return (
    <article
      className={`workflow-resident ${actor.asleep ? 'is-asleep' : 'is-awake'} ${actor.stalled ? 'is-stalled' : ''}`}
    >
      <button
        type="button"
        className="workflow-person"
        aria-label={`${role?.label ?? actor.label}, ${state}`}
        aria-pressed={selected}
        onClick={() => onSelect({ kind: 'actor', id: actor.id })}
      >
        {portrait ? (
          <img
            src={portrait}
            alt=""
            className={actor.pose === 'tool' || actor.pose === 'think' ? 'is-working' : ''}
          />
        ) : (
          <span className="workflow-unknown" aria-hidden="true">
            ◇
          </span>
        )}
        <strong>{role?.label ?? actor.label}</strong>
        <small>{actor.label}</small>
        <span className="workflow-state">{state}</span>
      </button>
      {actor.bead && (
        <button
          type="button"
          key={actor.bead.id}
          className="workflow-task"
          onClick={() => onSelect({ kind: 'bead', id: actor.bead!.id })}
          aria-label={`bead ${actor.bead.id}, ${actor.bead.title}`}
        >
          {actor.bead.title || actor.bead.id}
        </button>
      )}
    </article>
  );
}
