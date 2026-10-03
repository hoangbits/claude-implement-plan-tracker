import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { OpenSpecPlan, Plan, Step } from '../types'
import {
  addTask,
  currentIndex,
  doneCount,
  fromTaskList,
  fromTodos,
  isTasksMd,
  parseTasksMd,
  patchTask,
} from './plan'

const PANE = 'plan'
const TITLE = 'Plan'
const CHANGES = 'openspec/changes'

const plan = atom({ plugin: 'implement-plan-tracker', key: 'plan' } as const, null)
const openspec = atom({ plugin: 'implement-plan-tracker', key: 'openspec' } as const, null)

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

const refreshOpenSpec = async ($: EngineInterface): Promise<void> => {
  const change = await newestChange($).catch(() => null)
  const steps = change
    ? parseTasksMd(await $.fs.read(`${CHANGES}/${change}/tasks.md`))
    : []
  await update($, openspec, () => (change ? { change, steps } : null))
}

const refreshStatus = async ($: EngineInterface): Promise<void> => {
  const view = shown(await read($, plan), await read($, openspec))
  if (!view) {
    $.ui.status(undefined)

    return
  }
  const step = view.steps[currentIndex(view.steps)]
  const now = step ? ` ▶ ${step.text.slice(0, 40)}` : ' ✓ all done'
  $.ui.status(`Plan ${doneCount(view.steps)}/${view.steps.length}${now}`)
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
  await refreshStatus($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'plan',
      description: 'Show every step of the current plan in a pane',
    })
    await refreshOpenSpec($)
    await refreshStatus($)
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'plan' }, async $ => {
    await refreshOpenSpec($)
    await refreshStatus($)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Plan pane opened.' }
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
      await setSteps($, 'tasks', () => fromTaskList(ran.result.tasks))
    }

    return ran
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const path = 'file_path' in e && typeof e.file_path === 'string' ? e.file_path : ''
    if (isTasksMd(path)) {
      await refreshOpenSpec($)
      await refreshStatus($)
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    await refreshOpenSpec($)
    await refreshStatus($)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const view = shown(await read($, plan), await read($, openspec))

    if (!view) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No plan yet.</Text>
          <Text dimColor>It shows the task list, or the newest OpenSpec tasks.md.</Text>
        </Box>
      )
    }

    const at = currentIndex(view.steps)
    const done = doneCount(view.steps)

    return (
      <Box flexDirection="column">
        <Text bold>
          {done}/{view.steps.length} done <Text dimColor>· {view.label}</Text>
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
      </Box>
    )
  })
}
