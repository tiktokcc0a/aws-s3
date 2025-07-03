// ===================================================================================
// ### shared/browser_setup.js (V4.2 - 最终参数修复版) ###
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
            "isIpCreateLanguage": false,
            "displayLanguages": "en-US",
            "languages": "en-US"
        }
    });

    if (!createRes.success) throw new Error(`[${instanceId}] 创建浏览器失败: ${createRes.msg}`);
    
    const browserId = createRes.data.id;
    const openRes = await openBrowser({ id: browserId, args: isHeadless ? ['--headless=new'] : [] });
    
    if (!openRes.success) {
        // 如果打开失败，也要尝试删除已创建的配置文件
        try { await deleteBrowser(browserId); } catch (e) {}
        throw new Error(`[${instanceId}] 打开浏览器失败: ${openRes.msg}`);
    }

    const browser = await puppeteer.connect({ browserWSEndpoint: openRes.data.ws, defaultViewport: null });
    const page = (await browser.pages())[0] || await browser.newPage();
    console.log(`[浏览器设置 ${instanceId}] 浏览器 (ID: ${browserId}) 连接成功。`);
    
    return { browser, page, browserId };
}


async function tearDownBrowser(browserId) {
    if (!browserId) return;
    console.log(`[清理 ${browserId}] 开始执行清理流程...`);

    // 步骤 1: 关闭浏览器窗口
    try {
        // --- 核心修复点: 直接传递字符串ID ---
        const closeRes = await closeBrowser(browserId);
        // ------------------------------------
        
        if (closeRes && closeRes.success) {
            console.log(`[清理 ${browserId}] 浏览器窗口已成功关闭。`);
        } else {
            console.warn(`[清理 ${browserId}] 关闭浏览器窗口时API返回失败或未成功: ${closeRes?.msg || '未知错误'}`);
        }
    } catch (error) {
        console.error(`[清理 ${browserId}] 调用关闭API时发生网络错误: ${error.message}`);
    }

    // 保留2秒延迟，确保进程完全退出
    console.log(`[清理 ${browserId}] 等待2秒，确保浏览器进程完全退出...`);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 步骤 2: 删除浏览器配置文件
    try {
        console.log(`[清理 ${browserId}] 正在发送删除命令...`);
        
        // --- 核心修复点: 直接传递字符串ID ---
        const deleteRes = await deleteBrowser(browserId);
        // ------------------------------------

        if (deleteRes && deleteRes.success) {
            console.log(`[清理 ${browserId}] ✅ 浏览器配置文件已成功删除。清理完成！`);
        } else {
            throw new Error(`删除浏览器配置文件时API返回失败: ${deleteRes?.msg || '未知错误'}`);
        }
    } catch (error) {
        console.error(`[清理 ${browserId}] ❌ 清理浏览器时发生最终错误: ${error.message}`);
        throw error;
    }
}

module.exports = { setupBrowser, tearDownBrowser };