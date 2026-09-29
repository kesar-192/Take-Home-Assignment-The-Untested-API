const taskService = require('../src/services/taskService');

const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

beforeEach(() => {
  taskService._reset();
});

describe('taskService.create', () => {
  test('creates a task with defaults', () => {
    const task = taskService.create({ title: 'Write tests' });

    expect(task).toMatchObject({
      title: 'Write tests',
      description: '',
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      completedAt: null,
    });
    expect(task.id).toEqual(expect.any(String));
    expect(new Date(task.createdAt).toString()).not.toBe('Invalid Date');
  });

  test('respects provided fields', () => {
    const due = daysFromNow(3);
    const task = taskService.create({
      title: 'T',
      description: 'desc',
      status: 'in_progress',
      priority: 'high',
      dueDate: due,
    });

    expect(task).toMatchObject({ description: 'desc', status: 'in_progress', priority: 'high', dueDate: due });
  });

  test('gives each task a unique id', () => {
    const a = taskService.create({ title: 'A' });
    const b = taskService.create({ title: 'B' });
    expect(a.id).not.toBe(b.id);
  });
});

describe('taskService.getAll / findById', () => {
  test('getAll returns empty array when there are no tasks', () => {
    expect(taskService.getAll()).toEqual([]);
  });

  test('getAll returns every task', () => {
    taskService.create({ title: 'A' });
    taskService.create({ title: 'B' });
    expect(taskService.getAll()).toHaveLength(2);
  });

  test('getAll returns a new array, so pushing to it does not change the store', () => {
    taskService.create({ title: 'A' });
    taskService.getAll().push({ id: 'x' });
    expect(taskService.getAll()).toHaveLength(1);
  });

  test('findById returns the task, or undefined when missing', () => {
    const task = taskService.create({ title: 'A' });
    expect(taskService.findById(task.id)).toEqual(task);
    expect(taskService.findById('nope')).toBeUndefined();
  });
});

describe('taskService.getByStatus', () => {
  beforeEach(() => {
    taskService.create({ title: 'A', status: 'todo' });
    taskService.create({ title: 'B', status: 'in_progress' });
    taskService.create({ title: 'C', status: 'done' });
    taskService.create({ title: 'D', status: 'todo' });
  });

  test('returns only tasks with the exact status', () => {
    const result = taskService.getByStatus('todo');
    expect(result.map((t) => t.title)).toEqual(['A', 'D']);
  });

  test('returns empty array when nothing matches', () => {
    expect(taskService.getByStatus('bogus')).toEqual([]);
  });

  test('BUG: partial status strings must not match (substring match)', () => {
    // "do" is a substring of both "todo" and "done"
    expect(taskService.getByStatus('do')).toEqual([]);
  });
});

describe('taskService.getPaginated', () => {
  beforeEach(() => {
    for (let i = 1; i <= 12; i++) taskService.create({ title: `T${i}` });
  });

  test('page 1 returns the first `limit` tasks (pagination offset fixed)', () => {
    const result = taskService.getPaginated(1, 5);
    expect(result.map((t) => t.title)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
  });

  test('last partial page returns the remaining tasks (pagination offset fixed)', () => {
    const result = taskService.getPaginated(3, 5);
    expect(result.map((t) => t.title)).toEqual(['T11', 'T12']);
  });

  test('a page beyond the data returns an empty array', () => {
    expect(taskService.getPaginated(99, 5)).toEqual([]);
  });
});

describe('taskService.getStats', () => {
  test('returns zeros when empty', () => {
    expect(taskService.getStats()).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });

  test('counts tasks by status', () => {
    taskService.create({ title: 'A', status: 'todo' });
    taskService.create({ title: 'B', status: 'todo' });
    taskService.create({ title: 'C', status: 'in_progress' });
    taskService.create({ title: 'D', status: 'done' });

    expect(taskService.getStats()).toEqual({ todo: 2, in_progress: 1, done: 1, overdue: 0 });
  });

  test('counts past-due, unfinished tasks as overdue', () => {
    taskService.create({ title: 'late todo', dueDate: daysFromNow(-2) });
    taskService.create({ title: 'late in progress', status: 'in_progress', dueDate: daysFromNow(-1) });
    expect(taskService.getStats().overdue).toBe(2);
  });

  test('does not count done, future, or undated tasks as overdue', () => {
    taskService.create({ title: 'late but done', status: 'done', dueDate: daysFromNow(-5) });
    taskService.create({ title: 'future', dueDate: daysFromNow(5) });
    taskService.create({ title: 'no date' });
    expect(taskService.getStats().overdue).toBe(0);
  });
});

describe('taskService.update', () => {
  test('merges fields into the task and persists them', () => {
    const task = taskService.create({ title: 'Old', priority: 'low' });
    const updated = taskService.update(task.id, { title: 'New' });

    expect(updated).toMatchObject({ id: task.id, title: 'New', priority: 'low' });
    expect(taskService.findById(task.id).title).toBe('New');
  });

  test('returns null for an unknown id', () => {
    expect(taskService.update('nope', { title: 'x' })).toBeNull();
  });

  test('BUG: protected fields (id, createdAt) cannot be overwritten', () => {
    const task = taskService.create({ title: 'A' });
    const updated = taskService.update(task.id, { id: 'hacked', createdAt: '1999-01-01T00:00:00.000Z' });

    expect(updated.id).toBe(task.id);
    expect(updated.createdAt).toBe(task.createdAt);
  });
});

describe('taskService.remove', () => {
  test('removes an existing task and returns true', () => {
    const task = taskService.create({ title: 'A' });
    expect(taskService.remove(task.id)).toBe(true);
    expect(taskService.getAll()).toEqual([]);
  });

  test('returns false for an unknown id', () => {
    expect(taskService.remove('nope')).toBe(false);
  });
});

describe('taskService.assignTask', () => {
  test('sets the assignee on the task', () => {
    const task = taskService.create({ title: 'A' });
    const updated = taskService.assignTask(task.id, 'Priya');

    expect(updated.assignee).toBe('Priya');
    expect(taskService.findById(task.id).assignee).toBe('Priya');
  });

  test('overwrites an existing assignee', () => {
    const task = taskService.create({ title: 'A' });
    taskService.assignTask(task.id, 'Priya');
    const updated = taskService.assignTask(task.id, 'Sam');

    expect(updated.assignee).toBe('Sam');
  });

  test('returns null for an unknown id', () => {
    expect(taskService.assignTask('nope', 'Priya')).toBeNull();
  });

  test('does not change other fields', () => {
    const task = taskService.create({ title: 'A', priority: 'high', status: 'in_progress' });
    const updated = taskService.assignTask(task.id, 'Priya');

    expect(updated).toMatchObject({ title: 'A', priority: 'high', status: 'in_progress' });
  });
});

describe('taskService.completeTask', () => {
  test('marks the task done and sets completedAt', () => {
    const task = taskService.create({ title: 'A' });
    const done = taskService.completeTask(task.id);

    expect(done.status).toBe('done');
    expect(new Date(done.completedAt).toString()).not.toBe('Invalid Date');
    expect(taskService.findById(task.id).status).toBe('done');
  });

  test('returns null for an unknown id', () => {
    expect(taskService.completeTask('nope')).toBeNull();
  });

  test('BUG: completing a task keeps its priority', () => {
    const task = taskService.create({ title: 'A', priority: 'high' });
    expect(taskService.completeTask(task.id).priority).toBe('high');
  });
});
