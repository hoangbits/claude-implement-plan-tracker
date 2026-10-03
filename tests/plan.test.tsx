import { expect, mock, test } from 'claude-code/testing'

import {
  currentIndex,
  doneCount,
  estimateMs,
  formatDuration,
  insertTaskLine,
  isTasksMd,
  parseTasksMd,
  remainingMs,
} from '../hooks/plan'

const TODOS = [
  { content: 'Read ticket', status: 'completed', activeForm: 'Reading ticket' },
  { content: 'Write code', status: 'in_progress', activeForm: 'Writing code' },
  { content: 'Add tests', status: 'pending', activeForm: 'Adding tests' },
] as const

const PANE_PROPS = {
  title: 'Plan',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const

test('parses OpenSpec tasks.md checkboxes', async () => {
  const steps = parseTasksMd('## 1. Setup\n- [x] 1.1 Add schema\n- [ ] 1.2 Add context\n- [ ] 1.3 Add UI\n')

  expect(steps.length).toBe(3)
  expect(doneCount(steps)).toBe(1)
  expect(currentIndex(steps)).toBe(1)
  expect(isTasksMd('/repo/openspec/changes/add-x/tasks.md')).toBe(true)
  expect(isTasksMd('/repo/openspec/changes/archive/add-x/tasks.md')).toBe(false)
})

test('pane shows every todo, the count and the current step', async ($, on) => {
  mock.clock(on)
  on('tool.call', { tool: 'TodoWrite' }, () => ({
    result: { oldTodos: [], newTodos: [...TODOS] },
  }))
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'implement-plan-tracker',
      surface,
      component: 'Pane',
      requestId: 'plan',
      props: PANE_PROPS,
    })

    expect(await ui.find({ type: 'Text', text: /1\/3 done/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /Write code/ }))?.props.color).toBe('cyan')
    expect((await ui.find({ type: 'Text', text: /Read ticket/ }))?.text).toBe('✓ 1. Read ticket')
    expect((await ui.find({ type: 'Text', text: /Add tests/ }))?.text).toBe('○ 3. Add tests')
    await ui.unmount()
  }
})

const MIN = 60_000

test('estimates time left from Claude estimates, then calibrates on measured steps', async () => {
  const steps = [
    { id: '0', text: 'Read ticket (~10 min)', status: 'completed' },
    { id: '1', text: 'Write code (~20 min)', status: 'in_progress' },
    { id: '2', text: 'Add tests (~1 h)', status: 'pending' },
  ] as const

  expect(estimateMs('Add tests (~1 h)')).toBe(60 * MIN)
  expect(remainingMs([...steps], {}, 0)).toBe(80 * MIN)

  const timing = {
    'Read ticket': { startedAt: 0, finishedAt: 20 * MIN },
    'Write code': { startedAt: 20 * MIN },
  }
  expect(remainingMs([...steps], timing, 30 * MIN)).toBe(150 * MIN)
  expect(formatDuration(150 * MIN)).toBe('2 h 30 min')
  expect(formatDuration(20 * MIN)).toBe('20 min')
})

test('inserts a tasks.md line after the current step', async () => {
  const markdown = '## 1. Setup\n- [x] 1.1 Add schema\n- [ ] 1.2 Add context\n- [ ] 1.3 Add UI'

  expect(insertTaskLine(markdown, parseTasksMd(markdown), 'Add index')).toBe(
    '## 1. Setup\n- [x] 1.1 Add schema\n- [ ] 1.2 Add context\n- [ ] Add index\n- [ ] 1.3 Add UI',
  )
})

test('a step added in the pane updates the task list and reaches Claude mid-turn', async ($, on) => {
  mock.clock(on)
  const written: string[][] = []
  on('tool.call', { tool: 'TodoWrite' }, (_, e) => {
    written.push(e.todos.map(todo => todo.content))

    return { result: { oldTodos: [], newTodos: [...e.todos] } }
  })
  on('tool.call', { tool: 'Read' }, () => ({ result: { type: 'text', file: { filePath: 'a', content: '', numLines: 0, startLine: 1, totalLines: 0 } } }))
  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })

  const ui = await $.ui.mount({
    plugin: 'implement-plan-tracker',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'plan',
    props: PANE_PROPS,
  })
  await ui.input({ key: 'add', text: 'Run mix format' })

  expect(written.at(-1)).toEqual(['Read ticket', 'Write code', 'Run mix format', 'Add tests'])
  expect((await ui.find({ type: 'Text', text: /Run mix format/ }))?.text).toBe('○ 3. Run mix format')

  const next = await $.tool.call({ tool: 'Read', file_path: 'a' })
  expect(next.context?.join(' ')).toContain('Run mix format')
  await ui.unmount()
})
