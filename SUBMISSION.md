# Submission Note

**Live API:** https://take-home-assignment-the-untested-api-b1ki.onrender.com/tasks
(This is a JSON API with no frontend — root `/` returns "Cannot GET /", which is expected.
Hitting `/tasks` shows the current list.)

## What I'd test next with more time
- Concurrent writes to the in-memory store (e.g. two requests updating the same task at once).
- Timezone handling for `dueDate` / the overdue calculation in `/tasks/stats`.
- Behavior at large data volumes (hundreds/thousands of tasks), since pagination and filtering
  are both O(n) scans over the array today.
- Boundary values for `limit`/`page` more exhaustively (there's currently no upper cap on `limit`).

## What surprised me in the codebase
- `PUT /tasks/:id` does an unwhitelisted `{ ...task, ...fields }` merge, so a request body can
  overwrite `id` and `createdAt`, or add arbitrary new fields — I was able to move a task's id
  to `"hacked"` this way. This felt like the most consequential bug of the ones I found.
- Several validators use falsy checks (`if (body.status && ...)`), so an empty string or `null`
  silently skips validation instead of being rejected.
- The pagination offset was 0-based math applied to a 1-based API (`page * limit` instead of
  `(page - 1) * limit`), so `page=1` never returned the first page of results.

## Questions I'd ask before shipping this to production
- Is pagination meant to be 1-based? (I assumed yes, based on the README's own example.)
- Should reassigning an already-assigned task via `PATCH /tasks/:id/assign` overwrite silently,
  or should it be rejected (409) unless explicitly cleared first? I went with overwrite since
  nothing in the spec suggested one-shot assignment, but it's a real design choice either way.
- Should `completedAt` clear if a task's status moves away from `done` after being completed?
- What's the intended auth/authz model — is `assignee` meant to be a free-text name, or should
  it validate against a known set of users?

Full bug-by-bug write-up (what's expected, what actually happens, how I found it, and what a fix
looks like) is in [`task-api/BUGS.md`](./task-api/BUGS.md).
