# Location Mapping Fixtures

One module (`runner.*.ts`) in four revisions. In `v1`, `return exec(cmd);` appears twice
(lines 9 and 14) with identical text but different surroundings, which is the case that
line-number or text-only matching gets wrong.

- `v1` — baseline. Findings are anchored on lines 9 and 14.
- `v2` — code inserted above and between the functions, so both lines shift. Each finding
  must follow its own call, not the look-alike.
- `v3` — the flagged line at 9 is edited in place; its surroundings are unchanged (`modified`).
- `v4-rewritten` — the flagged code no longer exists (`lost`).
