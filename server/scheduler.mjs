// Share in-flight work between the server timers and an external cron trigger.
export function createScheduler(service, { pollInterval, onError = () => {} }) {
  const active = new Map()
  let jobsTimer = null, syncTimer = null
  function once(key, work) {
    if (active.has(key)) return active.get(key)
    const task = Promise.resolve().then(work).finally(() => active.delete(key))
    active.set(key, task)
    return task
  }
  const jobs = () => once('jobs', () => service.runJobs())
  const sync = () => once('sync', () => service.syncCalendars())
  const runCycle = () => once('cycle', async () => { await sync(); await jobs() })
  return {
    runCycle,
    start() {
      if (jobsTimer) return
      jobsTimer = setInterval(() => void jobs().catch(onError), 2000)
      syncTimer = setInterval(() => void sync().catch(onError), pollInterval)
      jobsTimer.unref(); syncTimer.unref()
      void runCycle().catch(onError)
    },
    stop() { clearInterval(jobsTimer); clearInterval(syncTimer); jobsTimer = null; syncTimer = null },
    async drain() { await Promise.allSettled([...active.values()]) },
  }
}
