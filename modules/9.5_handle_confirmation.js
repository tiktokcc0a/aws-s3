// ===================================================================================
// ### modules/9.5_handle_confirmation.js ###
// ===================================================================================
const config = require('../shared/config');

/**
 * 模块9.5: 处理注册完成后的等待和跳转
 * @param {import('puppeteer').Page} page - Puppeteer Page 对象
 */
async function handleConfirmation(page) {
    console.log("[模块9.5] 已进入注册确认(confirmation)页面。");
    const waitTime = 50; // 等待50秒
    console.log(`[模块9.5] 开始等待 ${waitTime} 秒，以便AWS后台完全处理账户创建...`);
    
    await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
    
    console.log(`[模块9.5] 等待结束，准备跳转至IAM密钥创建页面...`);
    await page.goto(config.AWS_IAM_WIZARD_URL, { waitUntil: 'networkidle0' });
    console.log("[模块9.5] 已成功导航至IAM页面。");
}

module.exports = { handleConfirmation };