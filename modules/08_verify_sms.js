// ===================================================================================
// ### modules/08_verify_sms.js (采用更健壮的检测逻辑) ###
// ===================================================================================
const axios = require('axios').default;
const config = require('../shared/config');
const { humanLikeType, humanLikeClick } = require('../shared/utils');

async function verifySms(page, data) {
    console.log("[模块8] 等待并填写短信验证码...");

    // 【重要修正】采用更健壮的 waitForFunction 来检测元素
    try {
        console.log(`[模块8] 正在使用高可靠性方法检测OTP输入框 ('${config.IDENTITY_SMS_PIN_INPUT_SELECTOR}')...`);
        // 短暂延时，应对极快的UI渲染
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        await page.waitForFunction(
            (selector) => {
                const el = document.querySelector(selector);
                // 确保元素存在且可见
                return el && (el.offsetWidth > 0 || el.offsetHeight > 0);
            },
            { timeout: 60000 }, // 等待60秒
            config.IDENTITY_SMS_PIN_INPUT_SELECTOR
        );
        console.log("[模块8] OTP输入框已成功检测到！");
    } catch (e) {
        throw new Error(`[模块8] 在60秒内未能检测到可见的OTP输入框。错误: ${e.message}`);
    }
    
    let smsCode = null;
    for (let attempts = 0; attempts < 40; attempts++) {
        try {
            const response = await axios.get(data.phone_number_url, { timeout: 20000 });
            if (typeof response.data === 'string') {
                const match = response.data.match(/\b(\d{4,6})\b/);
                if (match && match[1]) smsCode = match[1];
            } else if (response.data?.verification_code || response.data?.code) {
                 smsCode = response.data.verification_code || response.data.code;
            }
            if (smsCode) {
                console.log(`[模块8] 成功获取到短信验证码: ${smsCode}`);
                break;
            }
        } catch (error) {
             console.error(`[模块8] 获取短信验证码时发生错误 (尝试 ${attempts+1}/40): ${error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
    }

    if (!smsCode) throw new Error("[模块8] 在40次尝试后，仍未能获取到短信验证码。");

    await humanLikeType(page, config.IDENTITY_SMS_PIN_INPUT_SELECTOR, smsCode);
    await humanLikeClick(page, config.IDENTITY_CONTINUE_BUTTON_SELECTOR);
    console.log("[模块8] 短信验证码提交完毕。");
}

module.exports = { verifySms };