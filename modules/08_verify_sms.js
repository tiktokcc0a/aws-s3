// ===================================================================================
// ### modules/08_verify_sms.js (V2.0 - 增加红窗ES预判) ###
// ===================================================================================
const axios = require('axios').default;
const config = require('../shared/config');
const { humanLikeType, humanLikeClick } = require('../shared/utils');
const { fetchNewPhoneNumber } = require('../shared/api_helper');

async function verifySms(page, data) {
    console.log("[模块8] 开始执行短信验证模块...");

    // --- 【核心修改】在模块开头加入“红窗ES”预判 ---
    try {
        console.log("[模块8] 正在进行“红窗ES”预判 (超时: 6秒)...");
        const redWindowSelector = 'div[data-analytics-alert="error"] ::-p-text(Sorry, there was an error processing your request)';
        await page.waitForSelector(redWindowSelector, { visible: true, timeout: 6000 });
        
        // 如果上面的waitForSelector没有抛出错误，说明找到了元素
        console.error("[模块8] 预判成功：检测到“红窗ES”错误！");
        throw new Error("红窗ES"); // 主动抛出错误，让主控捕获

    } catch (error) {
        if (error.message === "红窗ES") {
            // 如果是我们自己抛出的错误，就直接再次抛出
            throw error;
        }
        // 如果是超时错误，说明没找到红窗，这是我们期望的，所以忽略错误，继续执行
        console.log("[模块8] 预判正常：6秒内未检测到“红窗ES”。");
    }
    // --------------------------------------------------

    console.log("[模块8] 等待并填写短信验证码...");

    try {
        console.log(`[模块8] 正在使用高可靠性方法检测OTP输入框 ('${config.IDENTITY_SMS_PIN_INPUT_SELECTOR}')...`);
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

    if (!smsCode) {
        console.error("[模块8] 在80秒内未能获取到短信验证码。启动更换手机号流程...");
        try {
            const countryCode = data.country_code || 'DE'; 
            const newPhoneInfo = await fetchNewPhoneNumber(countryCode);
            data.phone_number_id = newPhoneInfo.phone_number_id;
            data.phone_number = newPhoneInfo.phone_number;
            data.phone_number_url = newPhoneInfo.phone_number_url;
            console.log(`[模块8] 已将当前任务的手机号更新为: ${data.phone_number}`);
            await page.reload({ waitUntil: 'networkidle0' });
            throw new Error("PHONE_NUMBER_UPDATED_AND_RELOADED");
        } catch (updateError) {
             if (updateError.message === "PHONE_NUMBER_UPDATED_AND_RELOADED") throw updateError;
            throw new Error(`[模块8] 更换手机号流程失败: ${updateError.message}`);
        }
    }

    await humanLikeType(page, config.IDENTITY_SMS_PIN_INPUT_SELECTOR, smsCode);
    await humanLikeClick(page, config.IDENTITY_CONTINUE_BUTTON_SELECTOR);
    console.log("[模块8] 短信验证码提交完毕。");
    
    console.log("[模块8] 进入20秒观察期，并行监控成功或失败标志...");

    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve('timeout'), 20000));
    const successPromise = page.waitForSelector(config.SUPPORT_PLAN_SUBMIT_BUTTON, { visible: true, timeout: 20000 }).then(() => 'success').catch(() => null);
    const redWindowPromise = page.waitForSelector('div[data-analytics-alert="error"] ::-p-text(Sorry, there was an error processing your request)', { visible: true, timeout: 20000 }).then(() => 'red_window').catch(() => null);
    const deadCardPromise = page.waitForSelector('div[data-analytics-alert="error"] ::-p-text(There was a problem with your payment information)', { visible: true, timeout: 20000 }).then(() => 'dead_card').catch(() => null);

    const outcome = await Promise.race([ successPromise, redWindowPromise, deadCardPromise, timeoutPromise ]);

    switch (outcome) {
        case 'success':
            console.log("[模块8] 观察期内检测到成功标志 (support页面)，流程继续。");
            break;
        case 'red_window':
            console.error("[模块8] 观察期内检测到错误：红窗！");
            throw new Error("红窗");
        case 'dead_card':
            console.error("[模块8] 观察期内检测到错误：死卡！");
            throw new Error("死卡");
        case 'timeout':
            console.log("[模块8] 20秒观察期结束，未检测到明确的成功或失败标志。将返回主循环继续等待。");
            break;
        default:
            console.log("[模块8] 观察期内所有监控均未触发，将返回主循环继续等待。");
            break;
    }
}

module.exports = { verifySms };