import { chromium } from 'playwright'

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
})

const page = await browser.newPage()
await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' })
await page.click('#start-btn')

const readState = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()))

await page.keyboard.press('ArrowLeft')
await page.keyboard.press('ArrowUp')
await page.keyboard.press('ArrowRight')

let state = await readState()
if (state.moveCount !== 3 || state.player.x !== 3 || state.player.z !== 3) {
  throw new Error(`Unexpected baseline state: ${JSON.stringify(state)}`)
}

await page.keyboard.press('KeyZ')
state = await readState()
if (state.moveCount !== 2 || state.player.x !== 2 || state.player.z !== 3) {
  throw new Error(`Undo failed: ${JSON.stringify(state)}`)
}

await page.keyboard.press('KeyR')
state = await readState()
if (state.moveCount !== 0 || state.player.x !== 3 || state.player.z !== 4 || state.mode !== 'playing') {
  throw new Error(`Restart failed: ${JSON.stringify(state)}`)
}

await page.keyboard.press('KeyE')
await page.keyboard.press('KeyM')
await page.keyboard.press('ArrowUp')
state = await readState()
if (state.camera.quarterTurnsClockwise !== 1 || state.camera.mappingMode !== 'camera' || state.player.x !== 4 || state.player.z !== 4) {
  throw new Error(`Rotate/mapping check failed: ${JSON.stringify(state)}`)
}

console.log(JSON.stringify({ ok: true, checks: ['move', 'undo', 'restart', 'camera-rotate', 'mapping-toggle'] }))
await browser.close()
