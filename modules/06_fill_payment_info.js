// ===================================================================================
// ### modules/06_fill_payment_info.js (V3.0 - 增加Cookie处理) ###
// ===================================================================================
const { humanLikeType, humanLikeClick, getMonthName } = require('../shared/utils');

async function fillPaymentInfo(page, data, config) {
    console.log("[模块6] 进入模块，等待并填写支付信息...");

    // 【核心修复】在模块开头加入Cookie横幅处理逻辑
    try {
        const cookieAcceptButtonSelector = 'button[data-id="awsccc-cb-btn-accept"]';
        console.log('[模块6] 正在检查Cookie横幅...');
        const acceptButton = await page.waitForSelector(cookieAcceptButtonSelector, { timeout: 5000 });
        if (acceptButton) {
            await acceptButton.click();
            console.log('[模块6] Cookie横幅已点击“Accept”。');
            await new Promise(resolve => setTimeout(resolve, 1000)); // 等待横幅消失
        }
    } catch (error) {
        console.log('[模块6] 未发现Cookie横幅，或已处理，继续执行...');
    }
    
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