# Bug Report — Task Manager API

Found by writing the Jest/Supertest suite in `tests/`. Each bug below has a
failing test named `BUG: ...` that reproduces it; run `npx jest -t "BUG"` to
see all of them at once.

---

## 1. Pagination is off by one page (FIXED — see below)

**Expected:** `?page=1&limit=5` returns the first 5 tasks.
**Actual:** `?page=1&limit=5` returned tasks 6–10. Page 1 was unreachable,
and the last page of data was silently dropped (`page=3&limit=5` on 12
tasks returned `[]` instead of the last 2).
**How found:** `taskService.test.js` → `getPaginated`, and the matching
route test.
**Cause:** `getPaginated` computed `offset = page * limit` instead of
`(page - 1) * limit`, i.e. it assumed 0-based pages while the API is
documented and used as 1-based.
**Fix:** see "Bug fixed" section below.

---

## 2. Status filter does a substring match, not an exact match

**Expected:** `?status=todo` returns only `todo` tasks.
**Actual:** `?status=do` returns both `todo` and `done` tasks, because
`getByStatus` uses `status.includes(status)`.
**How found:** `taskService.test.js` and `tasks.routes.test.js`,
`BUG: partial status ... does not match`.
**Fix:** `tasks.filter((t) => t.status === status)`.

---

## 3. `status` and `page`/`limit` query params are mutually exclusive

**Expected:** `?status=todo&page=1&limit=2` filters by status, then
paginates the filtered result (this is implied by the README listing both
as query params on the same endpoint).
**Actual:** the route checks `status` first and returns immediately,
ignoring `page`/`limit` entirely.
**How found:** `tasks.routes.test.js` →
`BUG: status filter can be combined with pagination`.
**Fix:** apply the status filter first (if present), then paginate
whatever `page`/`limit` produce over that filtered list, instead of two
separate early-return branches.

---

## 4. Completing a task resets its priority to `medium`

**Expected:** `PATCH /tasks/:id/complete` changes `status` and
`completedAt` only.
**Actual:** `completeTask` hardcodes `priority: 'medium'` on the updated
object, silently downgrading a `high`-priority task.
**How found:** `taskService.test.js` and `tasks.routes.test.js` →
`BUG: ... keeps the original priority`.
**Fix:** drop the `priority: 'medium'` line from the spread in
`completeTask` so the existing value is preserved.

---

## 5. Re-completing a task overwrites its original `completedAt`

**Expected:** completing an already-`done` task is a no-op (or at least
doesn't change when it was originally completed).
**Actual:** `completeTask` always sets a fresh `completedAt`, so calling
`/complete` twice moves the timestamp forward.
**How found:** `tasks.routes.test.js` →
`BUG: completing an already-done task keeps the original completedAt`.
**Fix:** in `completeTask`, only set `completedAt` if the task isn't
already `done` (or if `completedAt` is currently `null`).

---

## 6. `PUT /tasks/:id` allows mass assignment

**Expected:** a client can only update the editable task fields (`title`,
`description`, `status`, `priority`, `dueDate`).
**Actual:** `update` does `{ ...tasks[index], ...fields }` with no
whitelist, so a request body can overwrite `id` and `createdAt`, or add
arbitrary new keys. Overwriting `id` is the serious one — I was able to
give a task the id `hacked` and then read/write it via
`/tasks/hacked`, since nothing enforces uniqueness or immutability of ids.
**How found:** `taskService.test.js` and `tasks.routes.test.js` →
`BUG: ... cannot overwrite id, createdAt or add unknown fields`.
**Fix:** whitelist the mergeable fields in `update`
(`const { title, description, status, priority, dueDate } = fields;` then
merge only those), or strip `id`/`createdAt` before merging.

---

## 7. `completedAt` isn't set when a task is created or PUT as `done`

**Expected:** any task whose `status` is `done` has a non-null
`completedAt`.
**Actual:** `create` and `update` never touch `completedAt`, so
`POST /tasks` with `status: 'done'`, or `PUT /tasks/:id` with
`status: 'done'`, leaves `completedAt: null`. Only the dedicated
`/complete` route sets it. This makes the invariant "done tasks have a
completedAt" false in general, which is exactly the kind of thing
`/tasks/stats`-style reporting or a UI would rely on.
**How found:** `tasks.routes.test.js` →
`BUG: creating with status=done sets completedAt` and
`BUG: setting status to done sets completedAt`.
**Fix:** in `create`, default `completedAt` to `new Date().toISOString()`
when `status === 'done'`; in `update`, set `completedAt` when the merged
`status` becomes `done` (and consider clearing it if status moves away
from `done`).

---

## 8. Validation is inconsistent / too loose

**Expected:** `description` and `dueDate` should have the same "must be
the right type" scrutiny as `title`.
**Actual:**
- `validateUpdateTask` accepts `status: ''` because `if (body.status && ...)`
  treats an empty string as "not provided" rather than "invalid".
- `priority: null` on create bypasses the `if (body.priority && ...)` check
  the same way, and gets stored as-is (`priority: null` on the task).
- Nothing validates `description` (a number is accepted and stored) or
  checks that `dueDate` is a string before `Date.parse` coerces it —
  `dueDate: 5` is accepted and parsed as a 1970 timestamp, which then
  quietly inflates the `overdue` count in `/tasks/stats`.
**How found:** `tasks.routes.test.js` →
`BUG: rejects non-string description and non-string dueDate`,
`BUG: empty-string status is rejected`.
**Fix:** switch the falsy checks (`if (body.status && ...)`) to explicit
`!== undefined` checks so empty string / null are validated instead of
skipped, and add type checks for `description` (string) and `dueDate`
(string, in addition to the existing `Date.parse` check).

---

## 9. Malformed JSON bodies return 500 instead of 400

**Expected:** a bad JSON body (e.g. `{bad json`) is a client error → 400.
**Actual:** `express.json()` throws a `SyntaxError` with `err.status =
400`, but the error handler in `app.js` ignores `err.status` and always
responds 500.
**How found:** `tasks.routes.test.js` →
`BUG: malformed JSON returns 400, not 500`.
**Fix:** `res.status(err.status || 500).json({ error: ... })` in the error
handler, or a dedicated check for `err.type === 'entity.parse.failed'`.

---

## 10. Negative/invalid pagination values are silently swallowed

**Expected:** `?page=-1` or `?limit=-2` either 400s or falls back to a
sane default, the same way non-numeric values already fall back via
`parseInt(x) || 1`.
**Actual:** `parseInt('-1') || 1` evaluates to `-1` (truthy), so a
negative page/limit is passed straight to `Array.slice`, which
(depending on the combination) returns an empty array or an unexpectedly
large one. There's also no upper cap on `limit`, so `?limit=100000` is
accepted as-is.
**How found:** `tasks.routes.test.js` →
`BUG: negative page or limit is rejected or clamped, not silently empty`.
**Fix:** clamp `pageNum`/`limitNum` to `>= 1` (and cap `limitNum` at some
maximum, e.g. 100) after parsing.

---

## Smaller / lower-priority observations

- `?status=bogus` returns `200` with `[]` rather than `400` — arguably
  fine (an unknown filter just matches nothing), but worth confirming
  with the team since it's inconsistent with how `status` is validated
  everywhere else.
- The paginated response is a bare array with no `total`/`totalPages`
  metadata, so a client can't tell if it's on the last page.
- `taskService.findById`/`getAll` return live references into the
  in-memory array in some call paths (e.g. `create` returns the actual
  object that was pushed), so a caller that mutates the returned object
  mutates the store. Not exploitable over HTTP since Express
  re-serializes the response, but worth knowing if the service is ever
  used outside a request/response cycle.
- The README documents `status` values as `pending | in-progress |
  completed` and calls `PUT` a "full update"; the actual code uses
  `todo | in_progress | done` and `PUT` is a partial merge. Docs vs. code
  disagree.

---

## Bug fixed: pagination offset (#1)

`taskService.js`, `getPaginated`:

```diff
 const getPaginated = (page, limit) => {
-  const offset = page * limit;
+  const offset = (page - 1) * limit;
   return tasks.slice(offset, offset + limit);
 };
```

This was picked because it's a one-line, unambiguous fix (the README's own
example — `?page=1&limit=10` — only makes sense as 1-based pagination),
and it turns 4 previously-failing tests green without touching anything
else. The corresponding `BUG:` tests in `taskService.test.js` and
`tasks.routes.test.js` were renamed to drop the `BUG:` prefix now that
they pass.
