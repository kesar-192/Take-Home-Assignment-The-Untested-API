const request = require('supertest');
const app = require('../src/app');
const taskService = require('../src/services/taskService');

const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
const createTask = async (body = {}) =>
  (await request(app).post('/tasks').send({ title: 'Task', ...body })).body;

beforeEach(() => {
  taskService._reset();
});

describe('POST /tasks', () => {
  test('creates a task and returns 201', async () => {
    const res = await request(app).post('/tasks').send({ title: 'Write tests', priority: 'high' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Write tests', priority: 'high', status: 'todo', completedAt: null });
    expect(res.body.id).toBeDefined();
  });

  test.each([
    ['missing title', {}],
    ['blank title', { title: '   ' }],
    ['non-string title', { title: 42 }],
    ['invalid status', { title: 'x', status: 'pending' }],
    ['invalid priority', { title: 'x', priority: 'urgent' }],
    ['invalid dueDate', { title: 'x', dueDate: 'not-a-date' }],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await request(app).post('/tasks').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.any(String));
  });

  test('does not store a task when validation fails', async () => {
    await request(app).post('/tasks').send({ title: '' });
    expect(taskService.getAll()).toHaveLength(0);
  });

  test('BUG: malformed JSON returns 400, not 500', async () => {
    const res = await request(app).post('/tasks').set('Content-Type', 'application/json').send('{bad json');
    expect(res.status).toBe(400);
  });

  test('BUG: creating with status=done sets completedAt', async () => {
    const res = await request(app).post('/tasks').send({ title: 'x', status: 'done' });
    expect(res.body.completedAt).not.toBeNull();
  });

  test('BUG: rejects non-string description and non-string dueDate', async () => {
    const res = await request(app).post('/tasks').send({ title: 'x', description: 123, dueDate: 5 });
    expect(res.status).toBe(400);
  });
});

describe('GET /tasks', () => {
  test('returns an empty array when there are no tasks', async () => {
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns all tasks', async () => {
    await createTask({ title: 'A' });
    await createTask({ title: 'B' });

    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(res.body.map((t) => t.title)).toEqual(['A', 'B']);
  });

  describe('?status filter', () => {
    beforeEach(async () => {
      await createTask({ title: 'A', status: 'todo' });
      await createTask({ title: 'B', status: 'in_progress' });
      await createTask({ title: 'C', status: 'done' });
    });

    test('filters by status', async () => {
      const res = await request(app).get('/tasks?status=in_progress');
      expect(res.body.map((t) => t.title)).toEqual(['B']);
    });

    test('unknown status yields an empty list', async () => {
      const res = await request(app).get('/tasks?status=bogus');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    test('BUG: partial status ("do") does not match "todo" and "done"', async () => {
      const res = await request(app).get('/tasks?status=do');
      expect(res.body).toEqual([]);
    });

    test('BUG: status filter can be combined with pagination', async () => {
      await createTask({ title: 'D', status: 'todo' });
      await createTask({ title: 'E', status: 'todo' });
      const res = await request(app).get('/tasks?status=todo&page=1&limit=2');
      expect(res.body.map((t) => t.title)).toEqual(['A', 'D']);
    });
  });

  describe('pagination', () => {
    beforeEach(async () => {
      for (let i = 1; i <= 12; i++) await createTask({ title: `T${i}` });
    });

    test('BUG: page=1&limit=5 returns the first five tasks', async () => {
      const res = await request(app).get('/tasks?page=1&limit=5');
      expect(res.body.map((t) => t.title)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
    });

    test('BUG: page=2&limit=5 returns tasks 6-10', async () => {
      const res = await request(app).get('/tasks?page=2&limit=5');
      expect(res.body.map((t) => t.title)).toEqual(['T6', 'T7', 'T8', 'T9', 'T10']);
    });

    test('defaults to page 1 / limit 10 when only one param is given', async () => {
      const res = await request(app).get('/tasks?limit=3');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
    });

    test('falls back to defaults for non-numeric values', async () => {
      const res = await request(app).get('/tasks?page=abc&limit=xyz');
      expect(res.status).toBe(200);
      expect(res.body.length).toBeLessThanOrEqual(10);
    });

    test('a page past the end returns an empty array', async () => {
      const res = await request(app).get('/tasks?page=50&limit=5');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    test('BUG: negative page or limit is rejected or clamped, not silently empty', async () => {
      const res = await request(app).get('/tasks?page=-1&limit=5');
      expect(res.status === 400 || res.body.length > 0).toBe(true);
    });
  });
});

describe('PUT /tasks/:id', () => {
  test('updates the given fields', async () => {
    const task = await createTask({ title: 'Old' });
    const res = await request(app).put(`/tasks/${task.id}`).send({ title: 'New', priority: 'high' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: task.id, title: 'New', priority: 'high' });
  });

  test('returns 404 for an unknown id', async () => {
    const res = await request(app).put('/tasks/nope').send({ title: 'x' });
    expect(res.status).toBe(404);
  });

  test.each([
    ['blank title', { title: '' }],
    ['invalid status', { status: 'finished' }],
    ['invalid priority', { priority: 'urgent' }],
    ['invalid dueDate', { dueDate: 'garbage' }],
  ])('rejects %s with 400', async (_label, body) => {
    const task = await createTask();
    const res = await request(app).put(`/tasks/${task.id}`).send(body);
    expect(res.status).toBe(400);
  });

  test('validation runs before the 404 check', async () => {
    const res = await request(app).put('/tasks/nope').send({ title: '' });
    expect(res.status).toBe(400);
  });

  test('BUG: cannot overwrite id, createdAt or add unknown fields', async () => {
    const task = await createTask();
    const res = await request(app)
      .put(`/tasks/${task.id}`)
      .send({ id: 'hacked', createdAt: '1999-01-01T00:00:00.000Z', foo: 'bar' });

    expect(res.body.id).toBe(task.id);
    expect(res.body.createdAt).toBe(task.createdAt);
    expect(res.body.foo).toBeUndefined();
  });

  test('BUG: setting status to done sets completedAt', async () => {
    const task = await createTask();
    const res = await request(app).put(`/tasks/${task.id}`).send({ status: 'done' });
    expect(res.body.completedAt).not.toBeNull();
  });

  test('BUG: empty-string status is rejected', async () => {
    const task = await createTask();
    const res = await request(app).put(`/tasks/${task.id}`).send({ status: '' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /tasks/:id', () => {
  test('deletes a task and returns 204 with no body', async () => {
    const task = await createTask();
    const res = await request(app).delete(`/tasks/${task.id}`);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(taskService.getAll()).toHaveLength(0);
  });

  test('returns 404 for an unknown id', async () => {
    const res = await request(app).delete('/tasks/nope');
    expect(res.status).toBe(404);
  });

  test('deleting twice returns 404 the second time', async () => {
    const task = await createTask();
    await request(app).delete(`/tasks/${task.id}`);
    const res = await request(app).delete(`/tasks/${task.id}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /tasks/:id/complete', () => {
  test('marks the task done and sets completedAt', async () => {
    const task = await createTask();
    const res = await request(app).patch(`/tasks/${task.id}/complete`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(res.body.completedAt).not.toBeNull();
  });

  test('returns 404 for an unknown id', async () => {
    const res = await request(app).patch('/tasks/nope/complete');
    expect(res.status).toBe(404);
  });

  test('BUG: keeps the original priority', async () => {
    const task = await createTask({ priority: 'high' });
    const res = await request(app).patch(`/tasks/${task.id}/complete`);
    expect(res.body.priority).toBe('high');
  });

  test('BUG: completing an already-done task keeps the original completedAt', async () => {
    const task = await createTask();
    const first = await request(app).patch(`/tasks/${task.id}/complete`);
    await new Promise((r) => setTimeout(r, 15));
    const second = await request(app).patch(`/tasks/${task.id}/complete`);
    expect(second.body.completedAt).toBe(first.body.completedAt);
  });
});

describe('GET /tasks/stats', () => {
  test('returns zeroed stats when empty', async () => {
    const res = await request(app).get('/tasks/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });

  test('returns counts by status and the overdue count', async () => {
    await createTask({ status: 'todo', dueDate: daysFromNow(-3) });
    await createTask({ status: 'in_progress' });
    await createTask({ status: 'done', dueDate: daysFromNow(-3) });

    const res = await request(app).get('/tasks/stats');
    expect(res.body).toEqual({ todo: 1, in_progress: 1, done: 1, overdue: 1 });
  });

  test('is not swallowed by the /:id routes', async () => {
    const res = await request(app).get('/tasks/stats');
    expect(res.body).toHaveProperty('overdue');
  });
});
