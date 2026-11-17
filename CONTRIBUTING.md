# Contributing to @particle-academy/fancy-trading-ui

Notes for anyone, human or agent, working ON this package's code. How to USE the
package is in [AGENTS.md](./AGENTS.md); what it is, is in [README.md](./README.md).
`CLAUDE.md` is a symlink to this file, so Claude Code reads these notes when it
works in this repo.

## Commands

```bash
npm run build   # tsup
npm run dev     # tsup --watch
npm run lint    # tsc --noEmit && eslint .
npm test        # vitest run
npm run clean   # remove dist/
```

## Tests

vitest, in `tests/` (`setup.ts`, `render.tsx` helpers). Some suites guard the
package's rules rather than one component:

- `tests/packaging.test.ts` greps the built bundle so `lightweight-charts` never
  enters the root entry point's graph.
- `tests/no-advice.test.ts` scans `src/` for advice / signal vocabulary and fails
  the build if it appears.
- `tests/fancy-exclusive.test.ts` fails on hand-rolled HTML (a `<table>`, a bare
  `<button>`) where a Fancy primitive exists. Its scanners are each proven to
  fire on a known offender, not merely to pass.

## Dependencies

`dependencies` is `{}`. `lightweight-charts` is an optional peer used only by
the `/chart` entry; `@particle-academy/fancy-auto-common` is an optional peer
and is never hard-imported. The `/safety` entry stays React-free.

## Changelog

Update `CHANGELOG.md` in the same commit as the change.
