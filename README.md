# claude-implement-plan-tracker

A Claude Code plugin that always shows the whole plan in a pane:

```
2/5 done · ~45 min left · task list
✓ 1. Read ticket (~5 min)
✓ 2. Write OpenSpec proposal (~15 min)
▶ 3. Implement context functions (~20 min)
○ 4. Add tests (~10 min)
○ 5. Commit and open PR (~5 min)
> Add a step after the current one
```

- Every step, with `✓` done, `▶` current, `○` pending
- A `done/total` count and the time left
- A text box to add a step, also while Claude is working
- A status line entry: `Plan 2/5 · ~45 min left ▶ Implement context functions`

## Time left

The plugin asks Claude to end each step with an estimate, for example `(~10 min)`.

- Before any step is done, the time left is the sum of Claude's estimates.
- After steps are done, the plugin measures how long each one took. It scales Claude's estimates by actual time / estimated time.
- Steps without an estimate use the average measured time.
- The current step's elapsed time is subtracted.

## Add a step while Claude works

Press `ctrl+x tab` to focus the pane, `Tab` to the text box, type the step, and press `Enter`. The step goes after the current step.

- Task list: the plugin rewrites the task list (or creates a task) with the new step.
- OpenSpec: the plugin writes a `- [ ]` line into `tasks.md` after the current step.
- Claude gets a note about the new step with the result of its next tool call, so it sees the edit without stopping. If Claude is idle, the note goes with your next message.

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
