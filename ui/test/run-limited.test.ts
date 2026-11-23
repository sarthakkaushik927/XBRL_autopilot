import { describe, expect, it } from 'vitest'
import { runLimited } from '../electron/main/util/run-limited'

/** Tasks that finish when the test says so, recording which ran together. */
function gatedTasks() {
  const started: number[] = []
  const gates = new Map<number, { open: () => void; fail: (e: Error) => void }>()
  let running = 0
  let mostAtOnce = 0
  const task = (i: number) =>
    new Promise<void>((resolve, reject) => {
      started.push(i)
      mostAtOnce = Math.max(mostAtOnce, ++running)
      const done = () => running--
      gates.set(i, { open: () => (done(), resolve()), fail: (e) => (done(), reject(e)) })
    })
  return { task, started, gates, mostAtOnce: () => mostAtOnce }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('runLimited', () => {
  it('runs at most `limit` tasks at once, starting them in index order', async () => {
    const t = gatedTasks()
    const run = runLimited(7, 3, t.task)
    await tick()
    expect(t.started).toEqual([0, 1, 2])
    t.gates.get(1)!.open()
    await tick()
    expect(t.started).toEqual([0, 1, 2, 3])
    for (let i = 0; i < 7; i++) {
      t.gates.get(i)?.open()
      await tick()
    }
    for (const g of t.gates.values()) g.open()
    expect(await run).toBe(true)
    expect(t.started).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(t.mostAtOnce()).toBe(3)
  })

  it('with firstAlone, the first task finishes before the others start', async () => {
    const t = gatedTasks()
    const run = runLimited(4, 3, t.task, { firstAlone: true })
    await tick()
    expect(t.started).toEqual([0])
    t.gates.get(0)!.open()
    await tick()
    expect(t.started).toEqual([0, 1, 2, 3])
    for (const g of t.gates.values()) g.open()
    expect(await run).toBe(true)
  })

  it('starts nothing after an abort, lets the running tasks finish and resolves false', async () => {
    const t = gatedTasks()
    const ctl = new AbortController()
    let finished = false
    const run = runLimited(6, 2, t.task, { signal: ctl.signal }).then((all) => ((finished = true), all))
    await tick()
    ctl.abort()
    t.gates.get(0)!.open()
    await tick()
    expect(finished).toBe(false) // task 1 is still running
    t.gates.get(1)!.open()
    expect(await run).toBe(false)
    expect(t.started).toEqual([0, 1])
  })

  it('an abort after the last task started still resolves true', async () => {
    const t = gatedTasks()
    const ctl = new AbortController()
    const run = runLimited(2, 2, t.task, { signal: ctl.signal })
    await tick()
    ctl.abort()
    for (const g of t.gates.values()) g.open()
    expect(await run).toBe(true)
  })

  it('starts nothing after a failure and rejects with the first error', async () => {
    const t = gatedTasks()
    const run = runLimited(6, 2, t.task)
    await tick()
    t.gates.get(0)!.fail(new Error('batch 0 failed'))
    await tick()
    t.gates.get(1)!.fail(new Error('batch 1 failed'))
    await expect(run).rejects.toThrow('batch 0 failed')
    expect(t.started).toEqual([0, 1])
  })

  it('does nothing for no tasks, and nothing when already aborted', async () => {
    const t = gatedTasks()
    expect(await runLimited(0, 4, t.task)).toBe(true)
    const ctl = new AbortController()
    ctl.abort()
    expect(await runLimited(3, 4, t.task, { signal: ctl.signal })).toBe(false)
    expect(t.started).toEqual([])
  })
})
