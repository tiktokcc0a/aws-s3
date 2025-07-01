// shared/browser_setup.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { openBrowser, closeBrowser, createBrowser } = require('../request');
puppeteer.use(StealthPlugin());
async function setupBrowser(instanceId, isHeadless = false) {
    const createRes = await createBrowser({ name: `AWS-Workflow-${instanceId}`, remark: `AWS工作流实例 ${instanceId}`, proxyMethod: 2, proxyType: 'socks5', host: '127.0.0.1', port: '45000', browserFingerPrint: { coreVersion: '136', os: 'Win32', osVersion: '11', isIpCreateLanguage: true } });
    if (!createRes.success) throw new Error(`创建浏览器失败: ${createRes.msg}`);
    const browserId = createRes.data.id;
    const openRes = await openBrowser({ id: browserId, args: isHeadless ? ['--headless=new'] : [] });
    if (!openRes.success) throw new Error(`打开浏览器失败: ${openRes.msg}`);
    const browser = await puppeteer.connect({ browserWSEndpoint: openRes.data.ws, defaultViewport: null });
    const page = (await browser.pages())[0] || await browser.newPage();
    console.log(`[浏览器设置] [实例 ${instanceId}] 浏览器 (ID: ${browserId}) 连接成功。`);
    return { browser, page, browserId };
}
async function tearDownBrowser(browserId) { if (browserId) { console.log(`正在关闭浏览器 (ID: ${browserId})...`); await closeBrowser(browserId); } }
module.exports = { setupBrowser, tearDownBrowser };