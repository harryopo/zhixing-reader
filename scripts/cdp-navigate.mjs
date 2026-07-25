import { chromium } from 'playwright'
import { execSync } from 'child_process'
import path from 'path'

const OUT_DIR = 'C:/Users/Lenovo/AppData/Local/Temp'
const CAPTURE_SCRIPT = path.resolve('scripts/capture-app.ps1')

function captureScreenshot(filename) {
  const outPath = path.join(OUT_DIR, filename)
  execSync(
    `powershell -ExecutionPolicy Bypass -File "${CAPTURE_SCRIPT}" -OutputPath "${outPath}"`,
    { stdio: 'inherit' }
  )
}

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

async function main() {
  const browserUrl = await getBrowserDebuggerUrl()
  console.log('Connecting to', browserUrl)
  const browser = await chromium.connectOverCDP(browserUrl)
  const page = await getAppPage(browser)
  console.log('Using page', page.url())

  // 0. 从首页开始：点击每日学习导航
  await page.click('[data-dom-id="nav-daily"]')
  await page.waitForTimeout(2500)

  const guideDismissed = await safeClick(page, 'button:has-text("知道了")')
  if (guideDismissed) {
    console.log('Guide dismissed')
    await page.waitForTimeout(300)
  }

  captureScreenshot('zhixing-daily-dashboard.png')

  // 1. 点击"开始今日学习"
  await page.click('[data-dom-id="cta-start"]')
  await page.waitForTimeout(1500)
  captureScreenshot('zhixing-article-view.png')

  // 2. 点击第一个英文段落展开翻译
  const firstPara = page.locator('p').first()
  await firstPara.click()
  await page.waitForTimeout(800)
  captureScreenshot('zhixing-article-translation.png')

  // 3. 返回首页再进入设置 → 智能体编排
  await page.click('[data-dom-id="nav-settings"]')
  await page.waitForTimeout(1500)
  await page.click('a[href="#/agent-orchestration"], [data-dom-id*="agent"]')
  await page.waitForTimeout(2000)

  const promptTitle = page.locator('text=系统提示词').first()
  await promptTitle.scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  captureScreenshot('zhixing-agent-prompt.png')

  await browser.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
