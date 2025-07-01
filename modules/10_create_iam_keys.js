// ===================================================================================
// ### modules/10_create_iam_keys.js (V6 - 模块内循环重试版) ###
// ===================================================================================
const fs = require('fs').promises;
const path = require('path');
const config = require('../shared/config');
const { humanLikeClick } = require('../shared/utils');

async function createIamKeys(page, data) {
    const MAX_RETRIES = 3;
    const ELEMENT_WAIT_TIMEOUT = 70000;
    const NAVIGATION_TIMEOUT = 180000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`[模块10] 第 ${attempt}/${MAX_RETRIES} 次尝试...`);
        try {
            console.log("[模块10] 开始并行等待关键元素出现...");
            await Promise.all([
                page.waitForSelector(config.IAM_UNDERSTAND_CHECKBOX, { visible: true, timeout: ELEMENT_WAIT_TIMEOUT }),
                page.waitForSelector(config.IAM_CREATE_KEY_BUTTON, { visible: true, timeout: ELEMENT_WAIT_TIMEOUT })
            ]);

            console.log("[模块10] 关键元素均已加载，准备执行操作...");

            // 尝试处理新手引导提示框
            try {
                const nextButtonSelector = 'button.awsui-button-variant-primary[data-testid="aws-onboarding-next-button"]';
                await page.click(nextButtonSelector, { timeout: 5000 });
                console.log('[模块10] 已成功点击新手引导框的"Next"按钮。');
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (e) {
                console.log('[模块10] 未发现新手引导框，或已处理。');
            }

            await page.click(config.IAM_UNDERSTAND_CHECKBOX);
            await page.click(config.IAM_CREATE_KEY_BUTTON);

            await page.waitForSelector(config.IAM_DOWNLOAD_BUTTON, { visible: true, timeout: ELEMENT_WAIT_TIMEOUT });
            await humanLikeClick(page, config.IAM_SHOW_SECRET_BUTTON);
            await page.waitForSelector(config.IAM_SECRET_KEY_VALUE, { visible: true, timeout: 5000 });

            const accessKey = await page.$eval(config.IAM_ACCESS_KEY_VALUE, el => el.textContent.trim());
            const secretKey = await page.$eval(config.IAM_SECRET_KEY_VALUE, el => el.textContent.trim());

            if (!accessKey || !secretKey) throw new Error("未能提取到Access Key或Secret Key。");
            console.log(`[模块10] 密钥提取成功！`);

            const contentToSave = [data.account, data.password, accessKey, secretKey, data.country_full_name].join('\t');
            const saveDir = config.KEY_SAVE_PATH;
            const filePath = path.join(saveDir, `${data.account}.txt`);

            await fs.mkdir(saveDir, { recursive: true });
            await fs.writeFile(filePath, contentToSave, 'utf-8');
            console.log(`[模块10] ✅✅✅ 最终成功！账号信息已保存到: ${filePath}`);

            return { status: 'final_success' }; // 成功，跳出函数

        } catch (error) {
            console.error(`[模块10] 第 ${attempt} 次尝试失败: ${error.message}`);
            if (attempt >= MAX_RETRIES) {
                throw new Error(`模块10在 ${MAX_RETRIES} 次尝试后仍未成功，最终失败。`);
            }
            
            console.log(`[模块10] 准备刷新页面后进行下一次尝试...`);
            try {
                await page.reload({ waitUntil: 'load', timeout: NAVIGATION_TIMEOUT });
            } catch (reloadError) {
                throw new Error(`模块10在尝试刷新页面时发生致命错误: ${reloadError.message}`);
            }
        }
    }
}

module.exports = { createIamKeys };