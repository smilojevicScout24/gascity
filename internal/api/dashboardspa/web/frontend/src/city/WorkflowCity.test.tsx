import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveCity } from './model';
import { WorkflowCity } from './WorkflowCity';
import type { SupervisorSession } from '../supervisor/sessionReads';
import type { SupervisorBead } from '../supervisor/beadReads';
import type { SupervisorAgent } from '../supervisor/agentReads';
import { spriteUrl } from './sprites';

const session = (id: string, template: string): SupervisorSession => ({
  id,
  template,
  session_name: id,
  title: id,
  rig: 'project',
  state: 'active',
  activity: 'tool',
  running: true,
  attached: false,
  provider: 'claude',
  created_at: '2026-10-18T10:00:00Z',
});

describe('WorkflowCity', () => {
  afterEach(cleanup);
  it('depicts configured bead maintenance dogs with their existing dog artwork', () => {
    const model = deriveCity({
      sessions: [],
      agents: [
        { name: 'bd.dog-1', pool: 'bd.dog', running: false, state: 'stopped' } as SupervisorAgent,
      ],
      rigs: [],
      beads: [],
      now: 0,
    });
    render(<WorkflowCity model={model} selected={null} onSelect={() => {}} />);
    const dog = screen.getByRole('button', { name: 'bd.dog-1, asleep' });
    expect(dog.querySelector('img')?.getAttribute('src')).toBe(spriteUrl('dog-idle'));
    expect(dog.querySelector('.workflow-unknown')).toBeNull();
  });
  it('renders actual workflow jobs, accessible selection, and their assigned work', () => {
    const model = deriveCity({
      sessions: [
        { ...session('worker', 'gc.implementation-worker'), active_bead: 'task-1' },
        session('reviewer', 'gc.implementation-reviewer'),
      ],
      rigs: [],
      beads: [
        {
          id: 'task-1',
          title: 'Build the approved change',
          status: 'in_progress',
          issue_type: 'task',
          created_at: '2026-10-18T10:00:00Z',
        } as SupervisorBead,
      ],
      now: Date.parse('2026-10-18T10:01:00Z'),
    });
    const select = vi.fn();
    render(<WorkflowCity model={model} selected={null} onSelect={select} />);
    fireEvent.click(screen.getByRole('button', { name: 'Implementation worker, tool' }));
    expect(select).toHaveBeenLastCalledWith({ kind: 'actor', id: 'worker' });
    fireEvent.click(screen.getByRole('button', { name: 'bead task-1, Build the approved change' }));
    expect(select).toHaveBeenLastCalledWith({ kind: 'bead', id: 'task-1' });
    expect(screen.getByRole('region', { name: 'Review bureau' })).toBeTruthy();
    expect(screen.queryByText('mayor')).toBeNull();
    expect(screen.queryByText('deacon')).toBeNull();
  });
  it('keeps unknown roles visible with their real identity', () => {
    const model = deriveCity({
      sessions: [session('custom-worker', 'custom.audit')],
      rigs: [],
      beads: [],
      now: 0,
    });
    render(<WorkflowCity model={model} selected={null} onSelect={() => {}} />);
    expect(screen.getByRole('region', { name: 'Other agents' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'custom-worker, tool' })).toBeTruthy();
  });
});
