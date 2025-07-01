// ===================================================================================
// ### modules/06_fill_payment_info.js (增加强制重载) ###
// ===================================================================================
const config = require('../shared/config');
const { humanLikeType, humanLikeClick, getMonthName } = require('../shared/utils');

async function fillPaymentInfo(page, data) {
    console.log("[模块6] 准备进入支付信息页面...");
    // 【重要修正】使用 page.reload() 强制刷新激活页面
    console.log("[模块6] 正在刷新页面以激活...");
    await page.reload({ waitUntil: 'networkidle0' });
    
    console.log("[模块6] 等待并填写支付信息...");
    await page.waitForSelector(config.PAYMENT_CARD_NUMBER_SELECTOR, { visible: true, timeout: 180000 });
    await humanLikeType(page, config.PAYMENT_CARD_NUMBER_SELECTOR, data['1step_number']);
    await humanLikeType(page, config.PAYMENT_CARD_HOLDER_NAME_SELECTOR, data.real_name);
    await humanLikeType(page, config.PAYMENT_CVV_SELECTOR, data['1step_code']);
    
    const month = parseInt(data['1step_month'], 10);
    const year = parseInt(data['1step_year'], 10);
    const formattedMonth = month < 10 ? `0${month}` : `${month}`;
    const targetMonthName = getMonthName(month);

    await page.click(config.PAYMENT_MONTH_TRIGGER_SELECTOR);
    const monthOptionSelector = `div.awsui-select-option[data-value="${formattedMonth}"][title="${targetMonthName}"]`;
    await page.waitForSelector(monthOptionSelector, { visible: true });
    await page.click(monthOptionSelector);

    await page.click(config.PAYMENT_YEAR_TRIGGER_SELECTOR);
    const yearOptionSelector = `div.awsui-select-option[data-value="${year}"][title="${year}"]`;
    await page.waitForSelector(yearOptionSelector, { visible: true });
    await page.click(yearOptionSelector);

    await humanLikeClick(page, config.PAYMENT_SUBMIT_BUTTON_SELECTOR);
    console.log("[模块6] 支付信息填写完毕。");
}

module.exports = { fillPaymentInfo };