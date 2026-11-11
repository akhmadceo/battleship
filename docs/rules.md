# Tidebound rules (paper prototype, v0)

These are the rules to test on graph paper in Milestone 0. The code in `packages/shared` implements the parts marked ✅.

## Board and fleet
- ✅ 10×10 sea per team. Columns А–К (no Й), rows 1–10. Cells are called like «Д-4».
- ✅ Classic fleet of 10 ships: 1 Ironclad (4 cells), 2 Corvettes (3), 3 Cutters (2), 4 Skiffs (1).
- ✅ Ships are straight lines and may not overlap or touch, not even diagonally.
- In co-op the team's ships are split between players (2 players: 5 each; 3: 4/3/3; 4: 3/3/2/2).

## A round
1. **Plan (15 s, ends early when everyone is Ready).** Each ship afloat may give one move and one fire order.
2. **Resolve.** All orders are resolved at the same moment, so a ship sunk this round still fires. ✅
3. **Reveal.** The results play out on the 3D sea.

## Orders
- ✅ **Fire:** one shell at a cell; the Ironclad fires two.
- ✅ **Move:** shift the ship up to 1 cell (Cutters 2) without turning. Moves happen before shells land, so a ship can dodge. A move that would leave the sea or touch another own ship is refused.
- Abilities instead of firing (Milestone 3): Corvette sonar 3×3, Skiff spotter buoy, quick repair.

## Results
- ✅ «мимо» (miss): the cell is marked.
- ✅ «ранил» (hit): the cell is marked as hit.
- ✅ «убил» (sunk): the ship's cells are revealed and every cell around it is marked empty.
- ✅ Hitting a part of a ship that is already damaged gives «repeat». A cell marked as a miss can be shot again, since ships move.
- ✅ A team wins when the whole enemy fleet is sunk; if both fleets go down in the same round it is a draw.

## Fog of war
- ✅ A team only ever sees its own ships, its marks on the enemy sea, enemy ships that are sunk, and how many enemy ships of each class are still afloat (`viewFor`). Enemy movements are filtered out of the event list (`eventsFor`). The server sends nothing else.
