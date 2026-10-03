import type { Step, StepStatus, Timing } from '../types'

type Todo = { content: string; status: StepStatus; activeForm?: string }
type TaskRow = { id: string; subject: string; status: StepStatus }
type TaskPatch = { taskId: string; subject?: string; status?: StepStatus | 'deleted' }

const CHECKBOX = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/

export const fromTodos = (todos: readonly Todo[]): Step[] =>
  todos.map((todo, i) => ({
    id: String(i),
    text: todo.content,
    status: todo.status,
    activeForm: todo.activeForm,
  }))

export const fromTaskList = (tasks: readonly TaskRow[]): Step[] =>
  tasks.map(task => ({ id: task.id, text: task.subject, status: task.status }))

export const addTask = (steps: Step[], id: string, subject: string): Step[] => [
  ...steps.filter(step => step.id !== id),
  { id, text: subject, status: 'pending' },
]

export const patchTask = (steps: Step[], { taskId, subject, status }: TaskPatch): Step[] =>
  status === 'deleted'
    ? steps.filter(step => step.id !== taskId)
    : steps.map(step =>
        step.id === taskId
          ? { ...step, text: subject ?? step.text, status: status ?? step.status }
          : step,
      )

export const parseTasksMd = (text: string): Step[] =>
  text.split('\n').flatMap((line, i) => {
    const match = CHECKBOX.exec(line)
    const label = match?.[2]
    if (!match || label === undefined) return []
    const status: StepStatus = match[1] === ' ' ? 'pending' : 'completed'

    return [{ id: String(i), text: label, status }]
  })

export const currentIndex = (steps: readonly Step[]): number => {
  const active = steps.findIndex(step => step.status === 'in_progress')

  return active >= 0 ? active : steps.findIndex(step => step.status === 'pending')
}

export const doneCount = (steps: readonly Step[]): number =>
  steps.filter(step => step.status === 'completed').length

export const isTasksMd = (path: string): boolean =>
  /(^|\/)openspec\/changes\/(?!archive\/)[^/]+\/tasks\.md$/.test(path)

const ESTIMATE = /\(~\s*(\d+(?:\.\d+)?)\s*(min|m|h|hr|hrs|hours?)\)/i
const MINUTE = 60_000
const MIN_MEASURED = 5_000

export const estimateMs = (text: string): number | null => {
  const match = ESTIMATE.exec(text)
  if (!match?.[1] || !match[2]) return null
  const amount = Number(match[1])

  return match[2].toLowerCase().startsWith('h') ? amount * 60 * MINUTE : amount * MINUTE
}

export const stepKey = (step: Step): string => step.text.replace(ESTIMATE, '').trim()

export const trackTiming = (steps: readonly Step[], timing: Timing, now: number): Timing => {
  const at = currentIndex(steps)
  const next: Timing = {}
  for (const [i, step] of steps.entries()) {
    const key = stepKey(step)
    const old = timing[key]
    if (step.status === 'completed') {
      next[key] = { startedAt: old?.startedAt ?? now, finishedAt: old?.finishedAt ?? now }
    } else if (i === at) {
      next[key] = { startedAt: old?.startedAt ?? now }
    }
  }

  return next
}

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0)

export const remainingMs = (steps: readonly Step[], timing: Timing, now: number): number | null => {
  const measured = steps.flatMap(step => {
    const time = timing[stepKey(step)]
    const took = time?.finishedAt === undefined ? 0 : time.finishedAt - time.startedAt
    if (step.status !== 'completed' || took < MIN_MEASURED) return []

    return [{ took, estimate: estimateMs(step.text) }]
  })
  const left = steps.filter(step => step.status !== 'completed')
  const estimates = left.map(step => estimateMs(step.text))
  const known = estimates.filter((ms): ms is number => ms !== null)
  const average =
    measured.length > 0
      ? sum(measured.map(one => one.took)) / measured.length
      : known.length > 0
        ? sum(known) / known.length
        : null
  if (average === null) return null

  const isCalibrated = measured.length > 0 && measured.every(one => one.estimate !== null)
  const ratio = isCalibrated
    ? sum(measured.map(one => one.took)) / sum(measured.map(one => one.estimate ?? 0))
    : 1
  const current = steps[currentIndex(steps)]

  return sum(
    left.map((step, i) => {
      const estimate = estimates[i] ?? null
      const full = estimate !== null && (isCalibrated || measured.length === 0) ? estimate * ratio : average
      const startedAt = step === current ? timing[stepKey(step)]?.startedAt : undefined

      return startedAt === undefined ? full : Math.max(0, full - (now - startedAt))
    }),
  )
}

export const formatDuration = (ms: number): string => {
  const minutes = Math.max(1, Math.round(ms / MINUTE))
  const hours = Math.floor(minutes / 60)

  return hours === 0 ? `${minutes} min` : `${hours} h ${minutes % 60} min`
}

export const insertAfterCurrent = (steps: readonly Step[], step: Step): Step[] => {
  const at = currentIndex(steps)
  const cut = at < 0 ? steps.length : at + 1

  return [...steps.slice(0, cut), step, ...steps.slice(cut)]
}

export const insertTaskLine = (markdown: string, steps: readonly Step[], text: string): string => {
  const lines = markdown.split('\n')
  const current = steps[currentIndex(steps)]
  const anchor = current ? Number(current.id) : Number(steps.at(-1)?.id ?? lines.length - 1)
  const indent = /^\s*/.exec(lines[anchor] ?? '')?.[0] ?? ''

  return [...lines.slice(0, anchor + 1), `${indent}- [ ] ${text}`, ...lines.slice(anchor + 1)].join('\n')
}
