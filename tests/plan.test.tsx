import { expect, test } from 'claude-code/testing'

import { currentIndex, doneCount, isTasksMd, parseTasksMd } from '../hooks/plan'

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
