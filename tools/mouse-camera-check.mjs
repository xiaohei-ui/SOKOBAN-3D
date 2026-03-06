import { chromium } from 'playwright'

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
})

const page = await browser.newPage({ viewport: { width: 1280, height: 760 } })
await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' })
await page.click('#start-btn')

const readState = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()))

const before = await readState()
const canvas = page.locator('canvas')
const box = await canvas.boundingBox()
if (!box) {
  throw new Error('No canvas bounding box found')
}

await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
await page.mouse.down()
await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.42, { steps: 12 })
await page.mouse.up()
await page.mouse.wheel(0, 420)
await page.waitForTimeout(260)

const after = await readState()

if (before.camera.yawDegrees === after.camera.yawDegrees) {
  throw new Error(`Yaw did not change: before=${before.camera.yawDegrees}, after=${after.camera.yawDegrees}`)
}

if (before.camera.zoomRatio === after.camera.zoomRatio) {
  throw new Error(`Zoom ratio did not change: before=${before.camera.zoomRatio}, after=${after.camera.zoomRatio}`)
}

console.log(JSON.stringify({
  ok: true,
  before: before.camera,
  after: after.camera,
}))

await browser.close()
