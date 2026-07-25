import { chromium } from 'playwright'
import fs from 'fs'

const OUT_DIR = 'C:/Users/Lenovo/AppData/Local/Temp'

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

async function safeClick(page, selector, timeout = 3000) {
  try {
    await page.waitForSelector(selector, { timeout })
    await page.click(selector)
    return true
  } catch {
    return false
  }
}

async function cdpScreenshot(page, filename) {
  const client = await page.context().newCDPSession(page)
  await client.send('Page.bringToFront')
  const { data } = await client.send('Page.captureScreenshot', { format: 'png' })
  const outPath = `${OUT_DIR}/${filename}`
  fs.writeFileSync(outPath, Buffer.from(data, 'base64'))
  console.log('Saved', outPath)
  await client.detach()
}

async function main() {
  const browserUrl = await getBrowserDebuggerUrl()
  console.log('Connecting to', browserUrl)
  const browser = await chromium.connectOverCDP(browserUrl)
  const page = await getAppPage(browser)
  console.log('Using page', page.url())

  // 1. 每日学习 dashboard
  await page.evaluate(() => {
    window.location.hash = '#/daily-learning'
    window.location.reload()
  })
  await page.waitForTimeout(3500)

  const guideDismissed = await safeClick(page, 'button:has-text("知道了")')
  if (guideDismissed) {
    console.log('Guide dismissed')
    await page.waitForTimeout(300)
  }

  await cdpScreenshot(page, 'zhixing-daily-dashboard.png')

  // 点击"开始今日学习"
  await page.click('[data-dom-id="cta-start"]')
  await page.waitForTimeout(1500)

  await cdpScreenshot(page, 'zhixing-article-view.png')

  // 点击第一个英文段落展开翻译
  const firstPara = page.locator('p').first()
  await firstPara.click()
  await page.waitForTimeout(800)
  await cdpScreenshot(page, 'zhixing-article-translation.png')

  // 2. 智能体编排
  await page.evaluate((p) => { window.location.hash = p }, '#/agent-orchestration')
  await page.waitForTimeout(2000)

  const promptTitle = page.locator('text=系统提示词').first()
  await promptTitle.scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  await cdpScreenshot(page, 'zhixing-agent-prompt.png')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
