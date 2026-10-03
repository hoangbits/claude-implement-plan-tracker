# claude-implement-plan-tracker

A Claude Code plugin that always shows the whole plan in a pane:

```
2/5 done · task list
✓ 1. Read ticket
✓ 2. Write OpenSpec proposal
▶ 3. Implement context functions
○ 4. Add tests
○ 5. Commit and open PR
```

- Every step, with `✓` done, `▶` current, `○` pending
- A `done/total` count
- A status line entry: `Plan 2/5 ▶ Implement context functions`

## Plan source

1. Claude Code's task list (`TodoWrite`, or `TaskCreate` / `TaskUpdate` / `TaskList`) for the main conversation.
2. When there is no task list: the checkboxes in the newest `openspec/changes/<change>/tasks.md` (the `archive` folder is skipped). The pane refreshes when that file changes and at the end of each turn.

## Install

```
/plugin marketplace add hoangbits/claude-implement-plan-tracker
/plugin install implement-plan-tracker@implement-plan-tracker
```

The plugin uses Claude Code function hooks (early access). It needs a Claude Code build with plugin function hooks.

## Use

- The pane opens at session start. In a terminal narrower than 144 columns, it waits until you open it.
- Type `/plan` to open the pane at any time.
- `ctrl+x tab` moves focus to the pane. `Esc` or `ctrl+x x` closes it.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
