# Tidebound

A co-op 3D low-poly take on the classic «Морской бой» (Battleship), played in the browser.

2–4 friends share one fleet and hunt a hidden enemy armada on a 10×10 sea, calling cells like «Д-4» and getting «мимо / ранил / убил» back.

## Layout

```
packages/shared/   rules engine: grid, fleet placement, round resolver, team views (pure TypeScript)
apps/client/       Babylon.js game (Milestone 1)
apps/server/       Colyseus authoritative server (Milestone 2)
docs/rules.md      paper-prototype rules
```

## Develop

Requires Node 20+ and pnpm (`corepack enable`).

```
pnpm install
pnpm test        # rules tests (Vitest)
pnpm typecheck
pnpm build
```
