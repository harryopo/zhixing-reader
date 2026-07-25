import { chromium } from 'playwright'

async function getBrowserDebuggerUrl() {
  const res = await fetch('http://127.0.0.1:9222/json/version')
  const data = await res.json()
  return data.webSocketDebuggerUrl
}

async function getAppPage(browser) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      const url = page.url()
      if (!url.startsWith('devtools://')) {
        return page
      }
    }
  }
  throw new Error('App page not found in CDP targets')
}

async function main() {
  const browserUrl = await getBrowserDebuggerUrl()
  const browser = await chromium.connectOverCDP(browserUrl)
  const page = await getAppPage(browser)
  console.log('URL:', page.url())
  console.log('Title:', await page.title())

  const navDaily = await page.$('[data-dom-id="nav-daily"]')
  const ctaStart = await page.$('[data-dom-id="cta-start"]')
  console.log('nav-daily exists:', !!navDaily)
  console.log('cta-start exists:', !!ctaStart)

  if (navDaily) {
    const text = await navDaily.textContent()
    const href = await navDaily.getAttribute('href')
    console.log('nav-daily text:', text, 'href:', href)
  }

  // Try clicking via JS
  await page.evaluate(() => {
    const el = document.querySelector('[data-dom-id="nav-daily"]')
    if (el) {
      console.log('Clicking nav-daily')
      el.click()
    }
  })
  await page.waitForTimeout(2000)
  console.log('URL after click:', page.url())

  await browser.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
