# Tidebound

A co-op 3D low-poly take on the classic «Морской бой» (Battleship), played in the browser.

2–4 friends share one fleet and hunt a hidden enemy armada on a 10×10 sea, calling cells like «Д-4» and getting «мимо / ранил / убил» back.

## Layout

```
packages/shared/   rules engine: grid, fleet placement, round resolver, team views (pure TypeScript)
apps/client/       Babylon.js browser game (Milestone 1: offline slice)
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
pnpm --filter @tidebound/client dev   # play at http://localhost:5173
```

## Controls (offline slice)

- Click enemy water to aim. Each ship fires once per round, the Ironclad twice; clicks fill ships in turn.
- WASD / arrows: plan a move for the active ship (a green ghost shows where it goes).
- Tab: next ship · F: aim view · M: map view · drag: look around · wheel: zoom.
- Space: fire. A round also fires on its own when the 20 s timer runs out.
- On phones: tap to aim, arrow pad to move, big Fire button.
