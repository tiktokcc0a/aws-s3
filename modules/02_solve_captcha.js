// ===================================================================================
// ### modules/02_solve_captcha.js (最终集成版) ###
// ===================================================================================
const config = require('../shared/config');
// 【集成】引入打码平台需要的核心模块
const axios = require('axios').default;
const { URLSearchParams } = require('url');

/**
 * 解决通用图片验证码。
 * 本模块是功能完整的执行单元。
 * @param {import('puppeteer').Page} page - Puppeteer的Page对象。
 * @param {object} data - 包含账户信息的对象。
 */
async function solveCaptcha(page, data) {
    console.log('[模块2] 开始处理【通用图片验证码】...');

    // 定义选择器和超时时间
    const captchaIframeSelector = config.COMMON_CAPTCHA_IFRAME_SELECTOR;
    const captchaImageSelector = config.INITIAL_CAPTCHA_IMAGE_SELECTOR;
    const captchaInputSelector = config.INITIAL_CAPTCHA_INPUT_SELECTOR;
    const captchaSubmitSelector = config.INITIAL_CAPTCHA_SUBMIT_SELECTOR;
    const timeout = 60000; // 将超时时间统一设置为60秒，为打码平台提供充足时间

    try {
        // 步骤 1: 等待验证码iframe加载完成
        console.log(`[模块2] 等待验证码iframe: "${captchaIframeSelector}" 加载... (超时: ${timeout / 1000}秒)`);
        const iframeElement = await page.waitForSelector(captchaIframeSelector, { visible: true, timeout });
        const frame = await iframeElement.contentFrame();
        if (!frame) {
            throw new Error("无法获取验证码iframe的contentFrame。");
        }
        console.log('[模块2] 验证码iframe加载成功。');

        // 步骤 2: 在iframe内部，等待图片元素加载完成
        console.log(`[模块2] 在iframe内部等待图片: "${captchaImageSelector}" 加载... (超时: ${timeout / 1000}秒)`);
        await frame.waitForSelector(captchaImageSelector, { visible: true, timeout });
        console.log('[模块2] 验证码图片加载成功。');

        // =======================================================================
        // 【已填充】这里是集成的核心打码逻辑
        // =======================================================================
        
        // 1. 在frame内部获取图片src
        const imageUrl = await frame.$eval(captchaImageSelector, img => img.src);
        console.log(`[模块2] 成功获取图片URL: ${imageUrl.substring(0, 100)}...`);

        // 2. 调用天天识图API
        console.log('[模块2] 正在请求天天识图API进行识别...');
        const postData = new URLSearchParams({
            'username': config.TTSHITU_USERNAME, 'password': config.TTSHITU_PASSWORD, 'typeid': config.TTSHITU_TYPEID,
            'image': Buffer.from((await axios.get(imageUrl, { responseType: 'arraybuffer' })).data).toString('base64')
        }).toString();
        
        const solveResponse = await axios.post(config.TTSHITU_API_URL, postData, { 
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 50000 // 为打码API本身设置一个超时
        });
        
        console.log('[模块2] 收到天天识图响应:', JSON.stringify(solveResponse.data));
        if (!solveResponse.data.success) throw new Error("天天识图打码失败: " + solveResponse.data.message);
        
        const captchaCode = solveResponse.data.data.result.toLowerCase();
        console.log(`[模块2] 打码成功，识别结果: ${captchaCode}`);

        // 3. 在frame内部填写验证码
        await frame.type(captchaInputSelector, captchaCode, { delay: 100 });

        // 4. 在frame内部点击提交按钮
        await frame.click(captchaSubmitSelector);
        console.log('[模块2] 验证码已提交。');
        
        // 检查iframe是否消失作为成功的标志
        console.log(`[模块2] 等待成功标志 (iframe消失)... (超时: 15秒)`);
        await page.waitForFunction(
            (selector) => !document.querySelector(selector), 
            { timeout: 15000 },
            captchaIframeSelector
        );

        console.log('[模块2] 验证码成功通过！');

    } catch (error) {
        console.error(`[模块2] 处理验证码时发生错误: ${error.message}`);
        
        // 核心改造逻辑：一旦发生任何错误，就执行“重置”流程
        console.log('[模块2] 发生不可恢复的错误，准备刷新页面以重启工作流...');
        try {
            await page.reload({ waitUntil: 'networkidle0' });
            console.log('[模块2] 页面已刷新。');
        } catch (reloadError) {
            console.error(`[模块2] 尝试刷新页面时也发生错误: ${reloadError.message}`);
            throw new Error(`页面刷新失败，可能浏览器已关闭: ${reloadError.message}`);
        }

        // 抛出异常，立即终止本模块，让main_controller接管
        throw new Error("验证码模块执行失败，已通过刷新页面触发工作流重置。");
    }
}

module.exports = { solveCaptcha };