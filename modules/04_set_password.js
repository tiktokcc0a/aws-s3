// ===================================================================================
// ### modules/04_set_password.js ###
// ===================================================================================
const config = require('../shared/config');
const { humanLikeType, humanLikeClick } = require('../shared/utils');

async function setPassword(page, data) {
    console.log("[模块4] 等待并设置密码...");
    await page.waitForSelector(config.PASSWORD_INPUT_SELECTOR, { visible: true, timeout: 180000 });
    await humanLikeType(page, config.PASSWORD_INPUT_SELECTOR, data.password);
    await humanLikeType(page, config.RE_PASSWORD_INPUT_SELECTOR, data.password);
    await humanLikeClick(page, config.CREATE_PASSWORD_SUBMIT_SELECTOR);
    console.log("[模块4] 密码设置并提交完毕。");
}

module.exports = { setPassword };