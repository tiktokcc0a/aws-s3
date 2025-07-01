// ===================================================================================
// ### shared/api_helper.js (新增) ###
// ===================================================================================
const axios = require('axios').default;

/**
 * @typedef {object} NewPhoneInfo
 * @property {string} phone_number_id
 * @property {string} phone_number
 * @property {string} phone_number_url
 */

/**
 * 从主API获取一个新的手机号信息。
 * 总监，此处的实现依赖于API侧支持单独获取手机号的接口。
 * 目前我假设接口地址为 'https://api.small5.co/getNewNumber?country=SE'，请您确认或提供正确的接口。
 * @param {string} countryCode - 目标国家的两字母代码, e.g., 'SE'
 * @returns {Promise<NewPhoneInfo>}
 */
async function fetchNewPhoneNumber(countryCode) {
    console.log(`[API助手] 正在为国家 ${countryCode} 请求新的手机号...`);
    // 【待确认】这里的URL需要您提供一个仅用于获取新手机号的有效API端点。
    const apiUrl = `https://api.small5.co/getNewNumber?country=${countryCode}`;
    
    try {
        const response = await axios.get(apiUrl, { timeout: 30000 });
        if (response.data && response.data.success && response.data.data) {
            const { id, phone, url } = response.data.data;
            if (id && phone && url) {
                console.log(`[API助手] 成功获取到新手机号: ${phone}`);
                return {
                    phone_number_id: id,
                    phone_number: phone,
                    phone_number_url: url
                };
            }
        }
        throw new Error('API响应格式不正确或未包含有效手机号信息。');
    } catch (error) {
        console.error(`[API助手] 请求新手机号失败: ${error.message}`);
        throw error; // 将错误抛出，由调用方处理
    }
}

module.exports = { fetchNewPhoneNumber };