import type { Scheduler } from '../lib/queue.js'
import { runLateFees } from '../modules/billing/service.js'
import { markOverdue } from '../modules/complaints/service.js'

const DAY = 24 * 3600 * 1000

export function registerJobs(s: Scheduler) {
  s.register(
    { name: 'late-fees', everyMs: DAY, run: () => runLateFees() },
    { name: 'complaints-overdue', everyMs: 5 * 60 * 1000, run: () => markOverdue() },
  )
}
