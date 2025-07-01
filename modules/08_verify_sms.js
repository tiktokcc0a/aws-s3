// ===================================================================================
// ### modules/08_verify_sms.js (重试机制优化版) ###
// ===================================================================================
const axios = require('axios').default;
const config = require('../shared/config');
const { humanLikeType, humanLikeClick } = require('../shared/utils');
// 【新增】引入API助手
const { fetchNewPhoneNumber } = require('../shared/api_helper');

async function verifySms(page, data) {
    console.log("[模块8] 等待并填写短信验证码...");

    // 【重要修正】采用更健壮的 waitForFunction 来检测元素 (逻辑保持不变)
    try {
        console.log(`[模块8] 正在使用高可靠性方法检测OTP输入框 ('${config.IDENTITY_SMS_PIN_INPUT_SELECTOR}')...`);
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        await page.waitForFunction(
            (selector) => {
                const el = document.querySelector(selector);
                return el && (el.offsetWidth > 0 || el.offsetHeight > 0);
            },
            { timeout: 60000 },
            config.IDENTITY_SMS_PIN_INPUT_SELECTOR
        );
        console.log("[模块8] OTP输入框已成功检测到！");
    } catch (e) {
        throw new Error(`[模块8] 在60秒内未能检测到可见的OTP输入框。错误: ${e.message}`);
    }
    
    let smsCode = null;
    // 【修改】将原来的40次尝试 (200秒) 改为16次 (80秒)
    for (let attempts = 0; attempts < 16; attempts++) {
        try {
            const response = await axios.get(data.phone_number_url, { timeout: 4500 });
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
             console.log(`[模块8] 获取短信验证码时发生网络错误 (尝试 ${attempts+1}/16): ${error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // 【修改】超时后的处理逻辑
    if (!smsCode) {
        console.error("[模块8] 在80秒内未能获取到短信验证码。启动更换手机号流程...");
        
        try {
            // 1. 获取国家代码，这里假设它存储在data.country_code中
            const countryCode = data.country_code || 'SE'; 
            const newPhoneInfo = await fetchNewPhoneNumber(countryCode);

            // 2. 替换当前窗口的手机号信息
            data.phone_number_id = newPhoneInfo.phone_number_id;
            data.phone_number = newPhoneInfo.phone_number;
            data.phone_number_url = newPhoneInfo.phone_number_url;
            console.log(`[模块8] 已将当前任务的手机号更新为: ${data.phone_number}`);

            // 3. 刷新页面，让主控制器重新执行上一步(07_enter_phone_number)
            console.log("[模块8] 刷新页面以使用新手机号重新开始验证...");
            await page.reload({ waitUntil: 'networkidle0' });
            
            // 4. 抛出一个特殊错误，让模块重试机制捕获，但不计入失败次数
            throw new Error("PHONE_NUMBER_UPDATED_AND_RELOADED");

        } catch (updateError) {
             if (updateError.message === "PHONE_NUMBER_UPDATED_AND_RELOADED") {
                throw updateError; // 将特殊错误继续上抛
             }
            throw new Error(`[模块8] 更换手机号流程失败: ${updateError.message}`);
        }
    }

    await humanLikeType(page, config.IDENTITY_SMS_PIN_INPUT_SELECTOR, smsCode);
    await humanLikeClick(page, config.IDENTITY_CONTINUE_BUTTON_SELECTOR);
    console.log("[模块8] 短信验证码提交完毕。");
}

module.exports = { verifySms };