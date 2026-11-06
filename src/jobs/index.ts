import type { Scheduler } from '../lib/queue.js'
import { runLateFees } from '../modules/billing/service.js'

const DAY = 24 * 3600 * 1000

export function registerJobs(s: Scheduler) {
  s.register({ name: 'late-fees', everyMs: DAY, run: () => runLateFees() })
}
