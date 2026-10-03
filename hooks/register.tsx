import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { OpenSpecPlan, Plan, Step } from '../types'
import {
  addTask,
  currentIndex,
  doneCount,
  formatDuration,
  fromTaskList,
  fromTodos,
  insertAfterCurrent,
  insertTaskLine,
  isTasksMd,
  parseTasksMd,
  patchTask,
  remainingMs,
  trackTiming,
} from './plan'

const PANE = 'plan'
const TITLE = 'Plan'
const CHANGES = 'openspec/changes'
const TICK_MS = 30_000

const ESTIMATE_RULE = [
  'When you write a task list (TodoWrite or TaskCreate) or OpenSpec tasks.md checkboxes,',
  'end each step with a time estimate in the form `(~N min)` or `(~N h)`,',
  'for example `Add migration (~5 min)`.',
].join(' ')

const plan = atom({ plugin: 'implement-plan-tracker', key: 'plan' } as const, null)
const openspec = atom({ plugin: 'implement-plan-tracker', key: 'openspec' } as const, null)
const timing = atom({ plugin: 'implement-plan-tracker', key: 'timing' } as const, {})
const tick = atom({ plugin: 'implement-plan-tracker', key: 'tick' } as const, 0)

const MARK: Record<Step['status'], string> = {
  completed: '✓',
  in_progress: '▶',
  pending: '○',
}

type Shown = { label: string; steps: Step[] }

const shown = (live: Plan | null, spec: OpenSpecPlan | null): Shown | null => {
  if (live && live.steps.length > 0) {
    return { label: live.source === 'todos' ? 'task list' : 'tasks', steps: live.steps }
  }
  if (spec && spec.steps.length > 0) {
    return { label: `openspec: ${spec.change}`, steps: spec.steps }
  }

  return null
}

const readShown = async ($: EngineInterface): Promise<Shown | null> =>
  shown(await read($, plan), await read($, openspec))

const timeLeft = async ($: EngineInterface, steps: Step[]): Promise<string> => {
  if (doneCount(steps) === steps.length) return ''
  const ms = remainingMs(steps, await read($, timing), await $.clock.now())

  return ms === null ? 'estimating…' : `~${formatDuration(ms)} left`
}

const newestChange = async ($: EngineInterface): Promise<string | null> => {
  if (!(await $.fs.exists(CHANGES))) return null
  const dirs = (await $.fs.list(CHANGES)).filter(
    entry => entry.kind === 'dir' && entry.name !== 'archive',
  )
  const stamped = await Promise.all(
    dirs.map(async dir => {
      const stat = await $.fs.stat(`${CHANGES}/${dir.name}/tasks.md`).catch(() => undefined)

      return { name: dir.name, mtimeMs: stat?.mtimeMs ?? -1 }
    }),
  )
  const newest = stamped
    .filter(one => one.mtimeMs >= 0)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]

  return newest?.name ?? null
}

const refresh = async ($: EngineInterface): Promise<void> => {
  const view = await readShown($)
  if (!view) {
    $.ui.status(undefined)

    return
  }
  const now = await $.clock.now()
  await update($, timing, old => trackTiming(view.steps, old, now))
  const step = view.steps[currentIndex(view.steps)]
  const left = await timeLeft($, view.steps)
  const current = step ? ` ▶ ${step.text.slice(0, 40)}` : ' ✓ all done'
  $.ui.status(`Plan ${doneCount(view.steps)}/${view.steps.length}${left ? ` · ${left}` : ''}${current}`)
}

const refreshOpenSpec = async ($: EngineInterface): Promise<void> => {
  const change = await newestChange($).catch(() => null)
  const steps = change ? parseTasksMd(await $.fs.read(`${CHANGES}/${change}/tasks.md`)) : []
  await update($, openspec, () => (change ? { change, steps } : null))
  await refresh($)
}

const setSteps = async (
  $: EngineInterface,
  source: Plan['source'],
  fn: (steps: Step[]) => Step[],
): Promise<void> => {
  await update($, plan, old => ({
    source,
    steps: fn(old?.source === source ? old.steps : []),
  }))
  await refresh($)
}

let notes: string[] = []
let isWriting = false

function takeNotes(): string[] {
  const taken = notes
  notes = []

  return taken
}

async function addStep($: EngineInterface, raw: string): Promise<void> {
  const text = raw.trim()
  const live = await read($, plan)
  const spec = await read($, openspec)
  const view = shown(live, spec)
  if (!text || !view) return

  const current = view.steps[currentIndex(view.steps)]
  const after = current ? ` Do it right after the current step "${current.text}".` : ''
  isWriting = true
  try {
    if (live && live.steps.length > 0 && live.source === 'todos') {
      const steps = insertAfterCurrent(live.steps, { id: 'new', text, status: 'pending' })
      await $.tool.call({
        tool: 'TodoWrite',
        todos: steps.map(step => ({
          content: step.text,
          status: step.status,
          activeForm: step.activeForm ?? step.text,
        })),
      })
      await setSteps($, 'todos', () => steps)
      notes = [
        ...notes,
        `The user added a step to your task list from the plan pane: "${text}".${after} Keep it in the list when you update it.`,
      ]
    } else if (live && live.steps.length > 0) {
      const made = await $.tool.call({
        tool: 'TaskCreate',
        subject: text,
        description: 'Added by the user from the plan pane.',
      })
      if (made.deny === undefined && made.isError !== true) {
        const { id, subject } = made.result.task
        await setSteps($, 'tasks', steps => addTask(steps, id, subject))
      }
      notes = [...notes, `The user added a task from the plan pane: "${text}".${after}`]
    } else if (spec) {
      const path = `${CHANGES}/${spec.change}/tasks.md`
      await $.fs.write(path, insertTaskLine(await $.fs.read(path), spec.steps, text))
      await refreshOpenSpec($)
      notes = [...notes, `The user added a step to ${path} from the plan pane: "${text}".${after}`]
    }
  } finally {
    isWriting = false
  }
  $.ui.toast(`Step added: ${text}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'plan',
      description: 'Show every step of the current plan in a pane',
    })
    $.clock.every(TICK_MS, () => void update($, tick, n => n + 1))
    await refreshOpenSpec($)
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'plan' }, async $ => {
    await refreshOpenSpec($)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Plan pane opened.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)

    return {
      sections: [
        ...sections,
        { id: 'implement-plan-tracker:estimates', text: ESTIMATE_RULE, scope: 'session' },
      ],
    }
  })

  on('prompt.submit', ($, e, next) => {
    const taken = takeNotes()

    return taken.length === 0 ? next(e) : next({ ...e, context: [...(e.context ?? []), ...taken] })
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && ran.isError !== true) {
      await setSteps($, 'todos', () => fromTodos(e.todos))
    }

    return ran
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && ran.isError !== true) {
      const { id, subject } = ran.result.task
      await setSteps($, 'tasks', steps => addTask(steps, id, subject))
    }

    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && ran.isError !== true) {
      await setSteps($, 'tasks', steps => patchTask(steps, e))
    }

    return ran
  })

  on('tool.call', { tool: 'TaskList' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined && ran.isError !== true) {
      const { tasks } = ran.result
      await setSteps($, 'tasks', () => fromTaskList(tasks))
    }

    return ran
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const path = 'file_path' in e && typeof e.file_path === 'string' ? e.file_path : ''
    if (isTasksMd(path)) await refreshOpenSpec($)
    const canCarry = !isWriting && e.agentId === undefined && ran.deny === undefined
    if (!canCarry || notes.length === 0) return ran

    return { ...ran, context: [...(ran.context ?? []), ...takeNotes()] }
  })

  on('turn.complete', async ($, e, next) => {
    await refreshOpenSpec($)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text } = table
    const Input = 'Input' in table ? table.Input : undefined
    await read($, tick)
    const view = await readShown($)

    if (!view) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No plan yet.</Text>
          <Text dimColor>It shows the task list, or the newest OpenSpec tasks.md.</Text>
        </Box>
      )
    }

    const at = currentIndex(view.steps)
    const left = await timeLeft($, view.steps)

    return (
      <Box flexDirection="column">
        <Text bold>
          {doneCount(view.steps)}/{view.steps.length} done{left ? ` · ${left}` : ''}{' '}
          <Text dimColor>· {view.label}</Text>
        </Text>
        {view.steps.map((step, i) => (
          <Text
            key={`step_${step.id}`}
            wrap="truncate-end"
            bold={i === at}
            color={i === at ? 'cyan' : undefined}
            dimColor={step.status === 'completed'}
          >
            {MARK[i === at ? 'in_progress' : step.status]} {i + 1}. {step.text}
          </Text>
        ))}
        {Input && (
          <Input
            key="add"
            placeholder="Add a step after the current one"
            submitLabel="Add"
            onSubmit={(value: string) => void addStep($, value)}
          />
        )}
      </Box>
    )
  })
}
