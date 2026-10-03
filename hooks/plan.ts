import type { Step, StepStatus } from '../types'

type Todo = { content: string; status: StepStatus }
type TaskRow = { id: string; subject: string; status: StepStatus }
type TaskPatch = { taskId: string; subject?: string; status?: StepStatus | 'deleted' }

const CHECKBOX = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/

export const fromTodos = (todos: readonly Todo[]): Step[] =>
  todos.map((todo, i) => ({ id: String(i), text: todo.content, status: todo.status }))

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
