export type StepStatus = 'pending' | 'in_progress' | 'completed'

export type Step = { id: string; text: string; status: StepStatus }

export type PlanSource = 'todos' | 'tasks'

export type Plan = { source: PlanSource; steps: Step[] }

export type OpenSpecPlan = { change: string; steps: Step[] }

declare module 'claude-code' {
  interface PluginState {
    'implement-plan-tracker': { plan: Plan | null; openspec: OpenSpecPlan | null }
  }
}
