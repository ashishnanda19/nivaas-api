import type { Scheduler } from '../lib/queue.js'
import { runLateFees } from '../modules/billing/service.js'
import { purgeExpiredPhotos } from '../modules/visitors/service.js'
import { markOverdue } from '../modules/complaints/service.js'

const DAY = 24 * 3600 * 1000

export function registerJobs(s: Scheduler) {
  s.register(
    { name: 'late-fees', everyMs: DAY, run: () => runLateFees() },
    { name: 'visitor-photo-retention', everyMs: DAY, run: () => purgeExpiredPhotos() },
    { name: 'complaints-overdue', everyMs: 5 * 60 * 1000, run: () => markOverdue() },
  )
}
