# Working in this repository

For anyone, human or automated, making changes here.

- **Branch:** work lands on `main`. Never force-push or rewrite history.
- **Checks before every commit:** `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke`. All must pass.
- **Commits:** authored as the project owner. No co-author lines, session links, or tool attribution in commit messages, code, or docs.
- **One task, one commit.** Message format: `<area>: <what changed> (<task id>)`.
- **Plan and queue:** [docs/project/PROJECT.md](docs/project/PROJECT.md) says what is being built and why. [docs/project/TASKS.md](docs/project/TASKS.md) is the task queue. [docs/project/LOOP.md](docs/project/LOOP.md) has the rules for unattended runs and the code conventions for `src/fx/`.
- **Do not** change `.github/`, add dependencies, or edit `LOOP.md` or this file unless the task you are doing says so.
