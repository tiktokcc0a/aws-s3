// ===================================================================================
// ### modules/10_create_iam_keys.js (超时与返回状态优化版) ###
// ===================================================================================
const fs = require('fs').promises;
const path = require('path');
const config = require('../shared/config');
const { humanLikeClick } = require('../shared/utils');

/**
 * 模块10: 创建并保存IAM Access Key
 * @param {import('puppeteer').Page} page - Puppeteer Page 对象
 * @param {object} data - 单条注册数据
 * @returns {Promise<object|undefined>} - 成功时返回一个特殊状态对象
 */
async function createIamKeys(page, data) {
    console.log("[模块10] 已处于IAM页面，开始创建密钥...");

    // 【修改】将等待超时时间调整为更合理的60秒
    const timeout = 60000;

    const checkboxElement = await page.waitForSelector(config.IAM_UNDERSTAND_CHECKBOX, { visible: true, timeout });
    await checkboxElement.evaluate(el => el.click());

    const buttonElement = await page.waitForSelector(config.IAM_CREATE_KEY_BUTTON, { visible: true, timeout });
    await buttonElement.evaluate(el => el.click());

    await page.waitForSelector(config.IAM_DOWNLOAD_BUTTON, { visible: true, timeout });
    await humanLikeClick(page, config.IAM_SHOW_SECRET_BUTTON);
    // 这个等待时间可以短一些，因为是本地UI变化
    await page.waitForSelector(config.IAM_SECRET_KEY_VALUE, { visible: true, timeout: 5000 });

    const accessKey = await page.$eval(config.IAM_ACCESS_KEY_VALUE, el => el.textContent.trim());
    const secretKey = await page.$eval(config.IAM_SECRET_KEY_VALUE, el => el.textContent.trim());

    if (!accessKey || !secretKey) throw new Error("[模块10] 未能提取到Access Key或Secret Key。");
    console.log(`[模块10] 密钥提取成功！`);

    const contentToSave = [data.account, data.password, accessKey, secretKey, data.country_full_name].join('\t');
    const saveDir = config.KEY_SAVE_PATH;
    const filePath = path.join(saveDir, `${data.account}.txt`);

    await fs.mkdir(saveDir, { recursive: true });
    await fs.writeFile(filePath, contentToSave, 'utf-8');
    console.log(`[模块10] ✅✅✅ 最终成功！账号信息已保存到: ${filePath}`);
    
    // 【新增】返回一个明确的成功状态，用于主控制器判断
    return { status: 'final_success' };
}

module.exports = { createIamKeys };