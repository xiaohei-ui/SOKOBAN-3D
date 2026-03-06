import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] })
const page = await browser.newPage()
await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' })
await page.click('#start-btn')
await page.keyboard.press('KeyF')
const entered = await page.evaluate(() => !!document.fullscreenElement)
if (entered) {
  await page.keyboard.press('Escape')
}
const exited = await page.evaluate(() => !document.fullscreenElement)
console.log(JSON.stringify({ entered, exited }))
await browser.close()
