const { chromium } = require('playwright');

const BASE = 'http://localhost:5275';
const OUT = 'dogfood-output';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`[CONSOLE ERROR] ${msg.text()}`);
  });
  page.on('pageerror', err => errors.push(`[PAGE ERROR] ${err.message}`));

  await page.goto(BASE + '/#/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // === HOME PAGE ===
  console.log('=== 1. HOME ===');
  await page.screenshot({ path: `${OUT}/01-home.png`, fullPage: true });
  const bodyText = await page.locator('body').innerText();
  console.log('  Text length:', bodyText.length);

  // Check for placeholders
  for (const p of ['即将上线', '敬请期待', 'coming soon', '开发中']) {
    if (bodyText.includes(p)) console.log(`  ⚠️ PLACEHOLDER: "${p}"`);
  }

  // Count buttons and links
  const btns = await page.locator('button').count();
  const links = await page.locator('a').count();
  console.log(`  Buttons: ${btns}, Links: ${links}`);

  // Click sidebar navigation items
  const sidebarLinks = await page.locator('nav a, [class*="sidebar"] a, [class*="Sidebar"] a, aside a').all();
  console.log(`  Sidebar links: ${sidebarLinks.length}`);
  for (const link of sidebarLinks) {
    const text = (await link.textContent()).trim();
    const href = await link.getAttribute('href');
    console.log(`    - ${text} (${href})`);
  }

  // === Visit each sidebar page ===
  const pagesToVisit = [
    { name: 'bookshelf', hash: '#/bookshelf' },
    { name: 'knowledge-cards', hash: '#/knowledge-cards' },
    { name: 'chat', hash: '#/chat' },
    { name: 'daily-learning', hash: '#/daily-learning' },
    { name: 'vocabulary', hash: '#/vocabulary' },
    { name: 'methodologies', hash: '#/methodologies' },
    { name: 'notes', hash: '#/notes' },
    { name: 'stats', hash: '#/stats' },
    { name: 'admin', hash: '#/admin' },
    { name: 'settings', hash: '#/settings' },
  ];

  for (const pageConfig of pagesToVisit) {
    console.log(`\n=== ${pageConfig.name.toUpperCase()} ===`);
    try {
      await page.goto(BASE + '/#' + pageConfig.hash.split('#')[1], { waitUntil: 'networkidle', timeout: 10000 });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${OUT}/${pageConfig.name}.png`, fullPage: true });

      // Read page structure
      const heading = await page.locator('h1, h2, h3').first().textContent().catch(() => '(no heading)');
      const subHeadings = await page.locator('h1, h2, h3').allTextContents();
      console.log(`  Heading: ${heading}`);
      console.log(`  Sub-headings: ${subHeadings.slice(0, 5).join(' | ')}`);

      // Count interactive elements
      const pageBtns = await page.locator('button').count();
      const inputs = await page.locator('input, textarea, select').count();
      console.log(`  Buttons: ${pageBtns}, Inputs/Textareas: ${inputs}`);

      // Check for "dead" buttons (no onClick handler effect)
      const placeholders = await page.locator('text=即将上线, text=敬请期待, text=coming soon').count();
      if (placeholders > 0) console.log(`  ⚠️ ${placeholders} placeholder text(s)`);

      // Read visible buttons' text
      const btnTexts = await page.locator('button').allTextContents();
      const interestingBtns = btnTexts.filter(t => t.trim()).slice(0, 10);
      if (interestingBtns.length) console.log(`  Buttons: [${interestingBtns.join(', ')}]`);

      // Check if page has real data or is empty
      const cardsCount = await page.locator('[class*="card"], [class*="Card"], li, [class*="item"], [class*="Item"]').count();
      console.log(`  Content cards/items: ${cardsCount}`);

      // Try clicking the first real action button
      const actionBtns = await page.locator('button:not([class*="icon"]):not([class*="close"])').all();
      if (actionBtns.length > 0 && actionBtns[0]) {
        const btnText = (await actionBtns[0].textContent()).trim();
        console.log(`  First action button: "${btnText}"`);
      }
    } catch (e) {
      console.log(`  ❌ ERROR: ${e.message.slice(0, 100)}`);
      await page.screenshot({ path: `${OUT}/${pageConfig.name}-error.png` }).catch(() => {});
    }
  }

  // === Summary ===
  console.log(`\n\n=== DOGFOOD SUMMARY ===`);
  console.log(`Console/Page errors: ${errors.length}`);
  for (const err of errors.slice(0, 10)) console.log(`  ${err}`);

  await browser.close();
  console.log('\nDone. Screenshots in dogfood-output/');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
