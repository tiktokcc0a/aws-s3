// ===================================================================================
// ### modules/09_select_support_plan.js (增加强制重载) ###
// ===================================================================================
const config = require('../shared/config');
const { humanLikeClick } = require('../shared/utils');

async function selectSupportPlan(page, data) {
    console.log("[模块9] 准备进入支持计划页面...");
    // 【重要修正】使用 page.reload() 强制刷新激活页面
    console.log("[模块9] 正在刷新页面以激活...");
    await page.reload({ waitUntil: 'networkidle0' });

    console.log("[模块9] 等待并选择支持计划...");
    await page.waitForSelector(config.SUPPORT_PLAN_SUBMIT_BUTTON, { visible: true, timeout: 180000 });
    
    const clicked = await humanLikeClick(page, config.SUPPORT_PLAN_SUBMIT_BUTTON);
    if (!clicked) {
        throw new Error("[模块9] 点击 'Complete sign up' 按钮失败。");
    }
    console.log("[模块9] 支持计划选择完毕，注册完成。");
}

module.exports = { selectSupportPlan };