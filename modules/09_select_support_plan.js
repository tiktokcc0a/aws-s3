// ===================================================================================
// ### modules/09_select_support_plan.js (V3 - 优化超时) ###
// ===================================================================================
const config = require('../shared/config');
const { humanLikeClick } = require('../shared/utils');

async function selectSupportPlan(page, data) {
    console.log("[模块9] 等待并选择支持计划...");
    
    // 【核心修改】将等待超时时间从180秒缩短为35秒
    await page.waitForSelector(config.SUPPORT_PLAN_SUBMIT_BUTTON, { visible: true, timeout: 35000 });
    
    const clicked = await humanLikeClick(page, config.SUPPORT_PLAN_SUBMIT_BUTTON);
    if (!clicked) {
        throw new Error("[模块9] 点击 'Complete sign up' 按钮失败。");
    }
    console.log("[模块9] 支持计划选择完毕，注册完成。");
}

module.exports = { selectSupportPlan };