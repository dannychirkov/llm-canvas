const test = require('node:test')
const assert = require('node:assert/strict')
const { createLoader } = require('./loadSource')

test('desktop admission serializes same-profile storage, allows independent owners, and releases idempotently', async () => {
  const previousMode = process.env.LLM_CANVAS_DESKTOP
  const previousSend = Object.getOwnPropertyDescriptor(process, 'send')
  const previousConnected = Object.getOwnPropertyDescriptor(process, 'connected')
  try {
    process.env.LLM_CANVAS_DESKTOP = '1'
    const { acquireStorageLock } = createLoader()('src/lib/storageLock.ts')
    await assert.rejects(acquireStorageLock('/private/profile/owner'), /unavailable/)
    Object.defineProperty(process, 'send', { value: () => {}, configurable: true })
    Object.defineProperty(process, 'connected', { value: true, configurable: true })
    const first = await acquireStorageLock('/private/profile/owner')
    const independent = await acquireStorageLock('/private/profile/other-owner')
    await assert.rejects(acquireStorageLock('/private/profile/owner', 15), /busy/)
    let secondStarted = false
    const secondPending = acquireStorageLock('/private/profile/owner', 1000).then(release => { secondStarted = true; return release })
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(secondStarted, false)
    await first()
    const second = await secondPending
    await first() // Old releases must not release a successor's reservation.
    await assert.rejects(acquireStorageLock('/private/profile/owner', 15), /busy/)
    await second()
    await independent()
    const final = await acquireStorageLock('/private/profile/owner')
    await final()
    await assert.rejects(acquireStorageLock('/private/profile/owner', -1), /unavailable/)
  } finally {
    if (previousMode === undefined) delete process.env.LLM_CANVAS_DESKTOP
    else process.env.LLM_CANVAS_DESKTOP = previousMode
    if (previousSend) Object.defineProperty(process, 'send', previousSend)
    else delete process.send
    if (previousConnected) Object.defineProperty(process, 'connected', previousConnected)
    else delete process.connected
  }
})
