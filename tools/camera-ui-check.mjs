import { chromium } from 'playwright'

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
})

const page = await browser.newPage()
await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' })
await page.click('#start-btn')

const readState = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()))

let state = await readState()
if (state.camera.tilt !== 'Medium' || state.camera.zoom !== 'Mid') {
  throw new Error(`Unexpected initial camera state: ${JSON.stringify(state.camera)}`)
}

await page.keyboard.press('KeyT')
state = await readState()
if (state.camera.tilt !== 'High') {
  throw new Error(`Tilt up failed: ${JSON.stringify(state.camera)}`)
}

await page.keyboard.press('KeyG')
state = await readState()
if (state.camera.tilt !== 'Medium') {
  throw new Error(`Tilt down failed: ${JSON.stringify(state.camera)}`)
}

await page.keyboard.press('Minus')
state = await readState()
if (state.camera.zoom !== 'Far') {
  throw new Error(`Zoom out failed: ${JSON.stringify(state.camera)}`)
}

await page.keyboard.press('Equal')
state = await readState()
if (state.camera.zoom !== 'Mid') {
  throw new Error(`Zoom in failed: ${JSON.stringify(state.camera)}`)
}

await page.keyboard.press('KeyE')
state = await readState()
if (state.camera.yawDegrees !== 90) {
  throw new Error(`Yaw rotate failed: ${JSON.stringify(state.camera)}`)
}

console.log(JSON.stringify({ ok: true, checks: ['tilt-up', 'tilt-down', 'zoom-out', 'zoom-in', 'rotate'] }))
await browser.close()
