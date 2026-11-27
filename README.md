# diff-speed

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![make.fun · rank](https://make.fun/badge/diff-speed-01-run-20261126/muhammadaldy198/diff-speed/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![make.fun · reward](https://make.fun/badge/diff-speed-01-run-20261126/muhammadaldy198/diff-speed/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

A fast drop-in for makefun-diff 1.0.0 — answers exactly as it does on every
case, faster. `solve.js` is a dependency-free ES module whose `run(input)`
returns make.fun's own patch of `{ old, new }` as one JSON string.

## How it works

The implementation follows the competition rule exactly: longest common
prefix, then longest common suffix, then Myers's greedy search with a
deletion winning every deletion/insertion tie, no edge-diagonal pruning,
and every run of equal lines followed to its end. Speed comes only from
the implementation: lines are interned to integer ids, the Myers V-history
lives in one flat `Int32Array`, and the patch is formatted with a single
array push per line plus one join. No third-party code, no native modules.

## Run

The harness runs `node main.ts`: it reads every case from
`/input/cases.json`, answers each with `run`, and writes
`/output/answers.json`.
