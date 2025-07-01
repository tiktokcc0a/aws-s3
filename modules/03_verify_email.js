// ===================================================================================
// ### modules/03_verify_email.js ###
// ===================================================================================
const axios = require('axios').default;
const config = require('../shared/config');
const { humanLikeType, humanLikeClick } = require('../shared/utils');

async function verifyEmail(page, data) {
    console.log("[模块3] 等待并填写邮箱验证码...");
    await page.waitForSelector(config.OTP_INPUT_SELECTOR, { visible: true, timeout: 180000 });
    const [emailAddress, emailPassword] = data.mailbox.split('----');
    for (let attempts = 0; attempts < 40; attempts++) {
        try {
            const url = `${config.EMAIL_API_BASE_URL}?email=${emailAddress}&password=${emailPassword}&email_provider=domain`;
            const response = await axios.get(url, { timeout: 20000 });
            if (response.data && response.data.verification_code) {
                console.log(`[模块3] 成功获取到邮箱验证码: ${response.data.verification_code}`);
                await humanLikeType(page, config.OTP_INPUT_SELECTOR, response.data.verification_code);
                await humanLikeClick(page, config.OTP_SUBMIT_BUTTON_SELECTOR);
                console.log("[模块3] 邮箱验证码提交完毕。");
                return;
            }
        } catch (error) { 
            console.error(`[模块3] 获取邮箱验证码时发生错误 (尝试 ${attempts+1}/40): ${error.message}`); 
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    throw new Error("[模块3] 在40次尝试后，仍未能获取到邮箱验证码。");
}

module.exports = { verifyEmail };