---
name: trackbox-creative-production
description: Turn a brief into reviewable visual assets. Route to explore, moodboard, positioning, offer, ads, scene, shot, or polish, then read the matching file under resources/.
---

# Creative Production

This folder is one skill. The entry file only chooses the step. The procedure for that step is in `resources/`. Read that file before producing directions, prompts, or images.

## When to use
- The user gives a broad creative goal ("make campaign assets", "I need visuals for the launch") and the specific step is ambiguous.
- A creative project spans multiple stages and needs sequencing.
- The user doesn't know which step they need.

## When not to use
- The user already named a step ("write me 25 ad concepts"). Open that file directly.
- The task is product design or prototyping, not visual asset creation.

## Pipeline

Direction is locked first. Assets are generated against that direction. Winners are polished last.

```
DIRECTION                 ASSETS                          FINISH
explore ──────────────┐
moodboard ────────────┼──►  scene  ──────────────┐
positioning ──────────┘     shot                  ├──►  polish
                            ads-explorer          │
                            offer ────────────────┘
```

## Routing

| User intent | Read |
|---|---|
| "what style / which look", no direction locked | [explore](resources/explore.md) |
| "align the team", "reference board", "territories" | [moodboard](resources/moodboard.md) |
| "make visuals match our strategy/positioning" | [positioning](resources/positioning.md) |
| "sell this offer/deal/bundle", "promo creative" | [offer](resources/offer.md) |
| "ad concepts", "variations to test", "25 ads" | [ads-explorer](resources/ads-explorer.md) |
| "product in use", "lifestyle shot", "show it being used" | [scene](resources/scene.md) |
| "different angles", "PDP/ecommerce set", "shot list" | [shot](resources/shot.md) |
| "finalize", "clean up", "production-ready", "fix artifacts" | [polish](resources/polish.md) |

## How to orchestrate
1. Check for a locked direction. If none exists, start with [explore](resources/explore.md), [moodboard](resources/moodboard.md), or [positioning](resources/positioning.md). Do not generate final assets against an unlocked direction.
2. Route asset generation to [scene](resources/scene.md), [shot](resources/shot.md), [ads-explorer](resources/ads-explorer.md), or [offer](resources/offer.md).
3. Finish deliverables through [polish](resources/polish.md).
4. Carry the locked direction and prompt stub into every later step.

## Worked example
Request: "We're launching a coffee subscription. I need everything — a look, a hero, some ads, and a clean set for the site."

1. No look locked → [explore](resources/explore.md). User picks "Warm Ritual" and the stub is saved.
2. Hero lifestyle → [scene](resources/scene.md), reusing the stub.
3. Ad test batch → [ads-explorer](resources/ads-explorer.md), reusing the stub.
4. Site product set → [shot](resources/shot.md), reusing the stub.
5. Finish winners → [polish](resources/polish.md).

## Quality bar
- A direction is locked before any final asset is produced.
- Every later step receives the same locked direction and stub.
- On a multi-stage request, show the plan before execution.

## Tooling
Image generation happens inside the step files via a text-to-image tool. If none is available, those files return prompts to run manually. This entry file still sequences the work.
