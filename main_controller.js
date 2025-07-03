// ===================================================================================
// ### main_controller.js (V11.2 - 增加待机超时截图) ###
// ===================================================================================
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios').default;
const { setupBrowser, tearDownBrowser } = require('./shared/browser_setup');
const staticConfig = require('./shared/config');
const { NetworkWatcher } = require('./utils/network_watcher');

// --- 全局状态与配置 ---
const args = process.argv.slice(2);
const countryArg = args.find(arg => arg.startsWith('--country='));
const COUNTRY_CODE = countryArg ? countryArg.split('=')[1] : 'SE';
const pauseState = {};

const KNOWN_FAILURE_MESSAGES = [
    "出现分区", "死卡", "红窗", "EMAIL_API_TIMEOUT", "REGISTRATION_FAILED_INCOMPLETE", "红窗ES"
];

// --- 模块与工作流定义 ---
const modules = {
    '01_fillSignupForm': require('./modules/01_fill_signup_form').fillSignupForm,
    '02_solveCaptcha': require('./modules/02_solve_captcha').solveCaptcha,
    '03_verifyEmail': require('./modules/03_verify_email').verifyEmail,
    '04_setPassword': require('./modules/04_set_password').setPassword,
    '05_fillContactInfo': require('./modules/05_fill_contact_info').fillContactInfo,
    '06_fillPaymentInfo': require('./modules/06_fill_payment_info').fillPaymentInfo,
    '07_enterPhoneNumber': require('./modules/07_enter_phone_number').enterPhoneNumber,
    '08_verifySms': require('./modules/08_verify_sms').verifySms,
    '09_selectSupportPlan': require('./modules/09_select_support_plan').selectSupportPlan,
    '9.5_handleConfirmation': require('./modules/9.5_handle_confirmation').handleConfirmation,
    '10_createIamKeys': require('./modules/10_create_iam_keys').createIamKeys,
};
const WORKFLOWS = {
    'signup?request_type=register': ['01_fillSignupForm', '02_solveCaptcha', '03_verifyEmail', '04_setPassword'],
    '#/account': ['05_fillContactInfo'],
    '#/paymentinformation': ['06_fillPaymentInfo'],
    '#/identityverification': ['07_enterPhoneNumber', '02_solveCaptcha', '08_verifySms'],
    '#/support': ['09_selectSupportPlan'],
    'confirmation': ['9.5_handleConfirmation'],
    'security_credentials': ['10_createIamKeys']
};


// --- 配置生成器 ---
function generateDynamicConfig(countryCode) {
    console.log(`[配置生成器] 正在为国家代码 "${countryCode}" 生成动态配置...`);
    const countryData = require('./shared/combined_country_data.json');
    const countryInfo = Object.entries(countryData).find(([name, data]) => data.country_code === countryCode);
    if (!countryInfo) {
        throw new Error(`无法在 combined_country_data.json 中找到国家代码为 "${countryCode}" 的条目。`);
    }
    const [countryName, countryDetails] = countryInfo;
    const { dialing_code } = countryDetails;
    const dynamicConfig = {
        dynamicContactPhoneOptionSelector: `div[data-value="${countryCode}"][title="${countryName} (+${dialing_code})"]`,
        dynamicContactAddressOptionSelector: `div[data-value="${countryCode}"][title="${countryName}"]`,
        dynamicIdentityPhoneOptionSelector: `div[data-value="${countryCode}"][title="${countryName} (+${dialing_code})"]`
    };
    console.log('[配置生成器] 动态配置生成成功:', dynamicConfig);
    return dynamicConfig;
}


// --- 监听来自Python GUI的命令 ---
process.stdin.on('data', (data) => {
    const command = data.toString().trim();
    if (command.startsWith("PAUSE::")) {
        const instanceId = command.split("::")[1];
        if (instanceId) pauseState[instanceId] = true;
        console.log(`[主控] 收到命令: 暂停 ${instanceId}`);
    } else if (command.startsWith("RESUME::")) {
        const instanceId = command.split("::")[1];
        if (instanceId) delete pauseState[instanceId];
        console.log(`[主控] 收到命令: 恢复 ${instanceId}`);
    }
});


// --- 核心辅助函数 ---
async function executeFixProcess(instanceId, port, page, reason) {
    console.log(`[${instanceId} FIX] 触发原因: ${reason}. 开始执行FIX流程...`);
    try {
        console.log(`[${instanceId} FIX] 正在为端口 ${port} 请求更换IP (国家: ${COUNTRY_CODE})...`);
        const response = await axios.post('http://localhost:8080/api/proxy/start', {
            line: "Line A (AS Route)", country_code: COUNTRY_CODE, start_port: port, count: 1, time: 30
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 25000 });
        console.log(`[${instanceId} FIX] IP更换API响应:`, response.data);
        console.log(`[${instanceId} FIX] IP更换成功，准备刷新页面...`);
        await page.reload({ waitUntil: 'load', timeout: 180000 });
        console.log(`[${instanceId} FIX] 页面刷新成功。FIX流程完成！`);
        return true;
    } catch (error) {
        console.error(`[${instanceId} FIX] FIX流程执行失败! 错误: ${error.message}`);
        return false;
    }
}
async function saveFailedCardInfo(data) {
    try {
        const info = [data['1step_number'], `${data['1step_month']}/${data['1step_year']}`, data['1step_code'], data.real_name].join('|');
        const filePath = path.join(__dirname, 'data', 'Not used cards.txt');
        await fs.appendFile(filePath, info + '\n', 'utf-8');
        console.log(`[错误处理] 已将卡信息保存至 ${path.basename(filePath)}`);
    } catch (error) {
        console.error(`[错误处理] 保存卡信息失败: ${error.message}`);
    }
}

// --- 主工作流函数 ---
async function runWorkflow(signupData, browserIndex, finalConfig) {
    const MAX_MODULE_RETRIES = 3;
    const NAVIGATION_TIMEOUT = 180000;
    const MAX_STANDBY_TIME = 70000;
    const STANDBY_CHECK_INTERVAL = 5000;
    const PROXY_PORT = 45000 + browserIndex;
    const IS_HEADLESS = process.argv.includes('--headless');
    const instanceId = `W${browserIndex + 1}`;
    signupData.country_code = COUNTRY_CODE;
    let page, browserId = null;
    let networkWatcher = null;
    const sharedState = { networkInterrupted: false };

    const reportStatus = (status, details = "") => {
        const account = signupData.account || 'N/A';
        console.log(`STATUS_UPDATE::${JSON.stringify({ instanceId, account, status, details: details.substring(0, 150) })}`);
    };

    try {
        reportStatus("初始化", `启动浏览器，端口: ${PROXY_PORT}...`);
        ({ page, browserId } = await setupBrowser(instanceId, IS_HEADLESS, PROXY_PORT, browserIndex));
        networkWatcher = new NetworkWatcher(sharedState, instanceId);
        networkWatcher.start();
        const workflowState = {};
        let standbyTime = 0;
        page.on('load', () => {
            const loadedUrl = page.url();
            console.log(`[${instanceId} 事件] 页面加载: ${loadedUrl.substring(0, 80)}...`);
            for (const urlPart in WORKFLOWS) { if (loadedUrl.includes(urlPart)) { workflowState[urlPart] = 0; } }
        });
        await page.goto(finalConfig.AWS_SIGNUP_URL, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT });
        let lastActiveWorkflowKey = 'signup?request_type=register';
        let allWorkflowsComplete = false;

        mainLoop: while (!allWorkflowsComplete) {
            if (pauseState[instanceId]) {
                reportStatus("暂停中", "用户手动暂停");
                while (pauseState[instanceId]) { await new Promise(resolve => setTimeout(resolve, 2000)); }
                reportStatus("运行中", "已从暂停中恢复...");
            }
            if (sharedState.networkInterrupted) {
                reportStatus("网络中断", "检测到中断，执行FIX...");
                const fixSuccess = await executeFixProcess(instanceId, PROXY_PORT, page, "网络观察员检测到中断");
                sharedState.networkInterrupted = false;
                if(fixSuccess) {
                    reportStatus("运行中", "网络FIX完成，继续...");
                    networkWatcher.start();
                } else { throw new Error(`[${instanceId}] 网络中断后的FIX流程失败。`); }
            }
            await new Promise(resolve => setTimeout(resolve, STANDBY_CHECK_INTERVAL));
            const currentUrl = page.url();
            if (currentUrl.includes('/signup/incomplete')) { throw new Error("REGISTRATION_FAILED_INCOMPLETE"); }
            let activeWorkflowKey = null;
            for (const urlPart in WORKFLOWS) {
                const isComplete = (workflowState[urlPart] || 0) >= WORKFLOWS[urlPart].length;
                if (currentUrl.includes(urlPart) && !isComplete) { activeWorkflowKey = urlPart; break; }
            }

            if (activeWorkflowKey) {
                standbyTime = 0;
                if (activeWorkflowKey !== lastActiveWorkflowKey) {
                    reportStatus("切换页面", `从 ${lastActiveWorkflowKey} 到 ${activeWorkflowKey}`);
                    await page.reload({ waitUntil: 'load', timeout: NAVIGATION_TIMEOUT });
                    lastActiveWorkflowKey = activeWorkflowKey;
                    continue mainLoop;
                }
                let currentIndex = workflowState[activeWorkflowKey] || 0;
                const moduleName = WORKFLOWS[activeWorkflowKey][currentIndex];
                if (activeWorkflowKey === 'signup?request_type=register' && moduleName === '02_solveCaptcha') {
                    console.log(`[主控 ${instanceId}] 进入模块2前置判断...`);
                    try {
                        await page.waitForSelector(finalConfig.OTP_INPUT_SELECTOR, { visible: true, timeout: 6000 });
                        console.log(`[主控 ${instanceId}] 检测到OTP输入框，决定跳过模块2！`);
                        workflowState[activeWorkflowKey]++;
                        reportStatus("流程优化", "跳过图形验证码");
                        continue mainLoop;
                    } catch (e) {
                        console.log(`[主控 ${instanceId}] 6秒内未发现OTP输入框，正常执行模块2。`);
                    }
                }
                let moduleRetries = 0;
                while (moduleRetries < MAX_MODULE_RETRIES) {
                    try {
                        reportStatus("运行中", `模块: ${moduleName} (尝试 ${moduleRetries + 1})`);
                        const result = await modules[moduleName](page, signupData, finalConfig);
                        console.log(`[${instanceId} 成功] 模块 ${moduleName} 执行完毕。`);
                        workflowState[activeWorkflowKey]++;
                        if (result?.status === 'final_success') allWorkflowsComplete = true;
                        break;
                    } catch (error) {
                        console.error(`[${instanceId} 失败] 模块 ${moduleName} 第 ${moduleRetries + 1} 次尝试出错: ${error.message.substring(0, 200)}`);
                        reportStatus("错误", `模块 ${moduleName} 出错: ${error.message}`);
                        if (error.message.toLowerCase().includes('timeout')) {
                            const fixSuccess = await executeFixProcess(instanceId, PROXY_PORT, page, `模块 ${moduleName} 超时`);
                            if (fixSuccess) { continue mainLoop; } else { throw new Error(`[${instanceId}] 模块 ${moduleName} 超时，且FIX流程也失败了。`); }
                        }
                        moduleRetries++;
                        if (moduleRetries >= MAX_MODULE_RETRIES) { throw new Error(`[${instanceId}] 模块 ${moduleName} 已达最大重试次数。`); }
                        console.log(`[${instanceId} 重试] (非超时错误) 准备刷新页面...`);
                        try {
                            await page.reload({ waitUntil: 'load', timeout: NAVIGATION_TIMEOUT });
                            continue mainLoop;
                        } catch (reloadError) {
                            const fixSuccess = await executeFixProcess(instanceId, PROXY_PORT, page, `重试时刷新页面超时`);
                            if (fixSuccess) { continue mainLoop; } else { throw new Error(`[${instanceId}] 尝试刷新页面时发生错误，且FIX流程也失败了。`); }
                        }
                    }
                }
            } else {
                standbyTime += STANDBY_CHECK_INTERVAL;
                reportStatus("待机", `等待页面跳转 (已待机 ${standbyTime / 1000}秒)`);
                if (standbyTime >= MAX_STANDBY_TIME) {
                    
                    // --- 【核心修改】在这里加入截图逻辑 ---
                    console.log(`[主控 ${instanceId}] 待机超时！正在截取当前页面状态...`);
                    const screenshotPath = `standby_timeout_screenshot_${instanceId}_${Date.now()}.png`;
                    try {
                        await page.screenshot({ path: screenshotPath, fullPage: true });
                        console.log(`[主控 ${instanceId}] 截图已保存至: ${screenshotPath}`);
                    } catch (screenshotError) {
                        console.error(`[主控 ${instanceId}] 截取待机超时截图时失败: ${screenshotError.message}`);
                    }
                    // --- 截图逻辑结束 ---

                    const fixSuccess = await executeFixProcess(instanceId, PROXY_PORT, page, `待机超时 (${standbyTime / 1000}秒)`);
                    if (fixSuccess) {
                        standbyTime = 0;
                        continue mainLoop;
                    } else {
                        throw new Error(`[${instanceId}] 页面待机超时，且FIX流程也失败了。`);
                    }
                }
            }
        }
        reportStatus("成功", "所有工作流执行完毕！");
        console.log(`\n🎉🎉🎉 [${instanceId} 任务完成] 工作流成功！ 🎉🎉🎉`);
        await tearDownBrowser(browserId);
    } catch (error) {
        const errorMessage = error.message;
        console.error(`\n[${instanceId} 工作流失败] 发生严重错误:`, errorMessage);
        reportStatus("失败", errorMessage);
        if (!errorMessage.includes("REGISTRATION_FAILED_INCOMPLETE")) { await saveFailedCardInfo(signupData); }
        const isKnownFailure = KNOWN_FAILURE_MESSAGES.some(msg => errorMessage.includes(msg));
        if (isKnownFailure) {
            console.log(`[${instanceId} 清理] 此为已知的、可预期的失败，将关闭并删除浏览器。`);
            await tearDownBrowser(browserId);
        } else {
            console.log(`[${instanceId} 保留] 此为未知的失败，将保留浏览器窗口以供排查。`);
            if (page) {
                const screenshotPath = `error_screenshot_${instanceId}_${Date.now()}.png`;
                try { await page.screenshot({ path: screenshotPath, fullPage: true }); console.log(`[${instanceId}] 截图已保存: ${screenshotPath}`); } catch (e) { /* Ignore */ }
            }
        }
        throw new Error(`[${instanceId} 最终失败] 工作流已终止。`);
    } finally {
        if (networkWatcher) { networkWatcher.stop(); }
    }
}

// --- 脚本主入口 ---
async function main() {
    try {
        console.log(`准备启动自动化任务... (国家: ${COUNTRY_CODE})`);
        const dynamicConfig = generateDynamicConfig(COUNTRY_CODE);
        const finalConfig = { ...staticConfig, ...dynamicConfig };
        const dataContent = await fs.readFile('./data/signup_data.json', 'utf-8');
        const allSignupData = JSON.parse(dataContent);
        if (!allSignupData || allSignupData.length === 0) { console.log("数据文件为空。"); return; }
        console.log(`从数据文件中加载了 ${allSignupData.length} 个任务。`);
        allSignupData.forEach((data, index) => {
            const instanceId = `W${index + 1}`;
            const account = data.account || 'N/A';
            console.log(`STATUS_UPDATE::${JSON.stringify({ instanceId, account, status: "排队中", details: "等待启动..." })}`);
        });
        const workflowPromises = [];
        for (let i = 0; i < allSignupData.length; i++) {
            const data = allSignupData[i];
            const instanceId = `W${i + 1}`;
            console.log(`[主控] 正在启动任务: ${instanceId}`);
            const promise = runWorkflow(data, i, finalConfig).catch(err => {
                console.error(`[主控] 捕获到工作流 ${instanceId} 的最终失败: ${err.message}`);
                return { status: 'failed', instanceId };
            });
            workflowPromises.push(promise);
            if ((i + 1) % 5 === 0 && (i + 1) < allSignupData.length) {
                console.log(`[主控] 已启动5个窗口，为减小系统压力，暂停5秒...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        console.log("[主控] 所有任务均已启动，正在等待它们全部完成...");
        const results = await Promise.all(workflowPromises);
        const failedCount = results.filter(r => r?.status === 'failed').length;
        console.log(`\n\n[总结] 所有任务均已执行完毕或终止。成功: ${results.length - failedCount}, 失败: ${failedCount}`);
    } catch (error) {
        console.error("脚本启动时发生致命错误:", error.message);
        process.exit(1);
    }
}

main();