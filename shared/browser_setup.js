// ===================================================================================
// ### shared/browser_setup.js (V3 - 更新语言配置) ###
// ===================================================================================
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { openBrowser, closeBrowser, createBrowser, deleteBrowser } = require('../request');
puppeteer.use(StealthPlugin());

const FINGERPRINT_OPTIONS = [
    { coreVersion: '136', os: 'Win32', osVersion: '11', platform: 'Win32' }
];

async function setupBrowser(instanceId, isHeadless = false, proxyPort, browserIndex) {
    const fingerprint = FINGERPRINT_OPTIONS[browserIndex % FINGERPRINT_OPTIONS.length];
    console.log(`[浏览器设置 ${instanceId}] 使用端口 ${proxyPort} 和指纹:`, fingerprint);

    const createRes = await createBrowser({
        name: `AWS-WF-${instanceId}`,
        remark: `AWS工作流实例 ${instanceId}`,
        proxyMethod: 2,
        proxyType: 'socks5',
        host: '127.0.0.1',
        port: proxyPort.toString(),
        browserFingerPrint: {
            ...fingerprint,
            // 【核心修改】按照您的最新要求更新语言相关配置
            "isIpCreateLanguage": false,
            "displayLanguages": "en-US",
            "languages": "en-US"
        }
    });

    if (!createRes.success) throw new Error(`[${instanceId}] 创建浏览器失败: ${createRes.msg}`);
    
    const browserId = createRes.data.id;
    const openRes = await openBrowser({ id: browserId, args: isHeadless ? ['--headless=new'] : [] });
    
    if (!openRes.success) {
        await deleteBrowser(browserId);
        throw new Error(`[${instanceId}] 打开浏览器失败: ${openRes.msg}`);
    }

    const browser = await puppeteer.connect({ browserWSEndpoint: openRes.data.ws, defaultViewport: null });
    const page = (await browser.pages())[0] || await browser.newPage();
    console.log(`[浏览器设置 ${instanceId}] 浏览器 (ID: ${browserId}) 连接成功。`);
    
    return { browser, page, browserId };
}

async function tearDownBrowser(browserId) {
    if (browserId) {
        try {
            console.log(`正在关闭并删除浏览器 (ID: ${browserId})...`);
            await closeBrowser(browserId);
            await deleteBrowser(browserId);
            console.log(`浏览器 (ID: ${browserId}) 已成功关闭并删除。`);
        } catch (error) {
            console.error(`清理浏览器 (ID: ${browserId}) 时出错: ${error.message}`);
        }
    }
}

module.exports = { setupBrowser, tearDownBrowser };