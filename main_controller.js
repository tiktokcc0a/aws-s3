// ===================================================================================
// ### main_controller.js (V19.0 - FINAL - 全面健壮性升级) ###
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
    "出现分区", "死卡", "红窗", "EMAIL_API_TIMEOUT", "REGISTRATION_FAILED_INCOMPLETE", "红窗ES",
    "密码创建服务错误", "已被封号"
];

const RECOVERABLE_NETWORK_ERRORS = [
    'timeout',
    'err_timed_out',
    'err_socks_connection_failed',
    'err_proxy_connection_failed',
    'err_connection_reset',
    'err_connection_timed_out',
    'err_internet_disconnected',
    'err_address_unreachable',
    'err_connection_refused'
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
        try {
            await page.reload({ waitUntil: 'load', timeout: 120000 }); // Navigation timeout is 120s
            console.log(`[${instanceId} FIX] 页面刷新成功。FIX流程完成！`);
            return true;
        } catch (reloadError) {
            console.error(`[${instanceId} FIX] 在FIX流程中刷新页面时也超时了: ${reloadError.message}`);
            return false;
        }
    } catch (error) {
        console.error(`[${instanceId} FIX] FIX流程执行失败! 错误: ${error.message}`);
        // 【修改点2】当FIX流程失败时，增加截图功能
        if (page) {
            try {
                const screenshotDir = path.join(__dirname, 'screenshot');
                await fs.mkdir(screenshotDir, { recursive: true });
                const screenshotPath = path.join(screenshotDir, `fix_failed_screenshot_${instanceId}_${Date.now()}.png`);
                await page.screenshot({ path: screenshotPath, fullPage: true });
                console.log(`[${instanceId} FIX] FIX失败截图已保存至: ${screenshotPath}`);
            } catch (screenshotError) {
                console.error(`[${instanceId} FIX] 截取FIX失败截图时发生错误: ${screenshotError.message}`);
            }
        }
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
    const NAVIGATION_TIMEOUT = 120000;
    const START_NAVIGATION_TIMEOUT = 60000;
    const MAX_STANDBY_TIME = 70000;
    const STANDBY_CHECK_INTERVAL = 5000;
    const PROXY_PORT = 45000 + browserIndex;
    const IS_HEADLESS = process.argv.includes('--headless');
    const instanceId = `W${browserIndex + 1}`;
    
    signupData.country_code = finalConfig.countryCode;

    const MAX_CONSECUTIVE_FIXES = 3;
    let consecutiveFixes = 0;

    let page, browserId = null;
    let networkWatcher = null;
    const sharedState = { networkInterrupted: false };

    const reportStatus = (status, details = "") => {
        const account = signupData.account || 'N/A';
        console.log(`STATUS_UPDATE::${JSON.stringify({ instanceId, account, status, details: details.substring(0, 150) })}`);
    };

    const isRecoverableError = (error) => {
        const errorMessage = error.message.toLowerCase();
        return RECOVERABLE_NETWORK_ERRORS.some(errSig => errorMessage.includes(errSig));
    };


    try {
        // 【修改点3】浏览器启动加入重试逻辑
        let browserSetupSuccess = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                reportStatus("初始化", `启动浏览器，端口: ${PROXY_PORT} (第 ${attempt}/3 次尝试)`);
                ({ page, browserId } = await setupBrowser(instanceId, IS_HEADLESS, PROXY_PORT, browserIndex));
                browserSetupSuccess = true;
                break; // 成功则跳出循环
            } catch (error) {
                console.error(`[${instanceId} 工作流启动失败] 浏览器设置第 ${attempt} 次尝试失败: ${error.message}`);
                reportStatus("失败", `[${instanceId}] 浏览器启动失败 (尝试 ${attempt}/3): ${error.message}`);
                if (attempt >= 3) {
                    throw error; // 重试3次后仍然失败，则抛出最终错误
                }
                await new Promise(resolve => setTimeout(resolve, 3000)); // 等待3秒后重试
            }
        }

        networkWatcher = new NetworkWatcher(sharedState, instanceId);
        networkWatcher.start();
        const workflowState = {};
        let standbyTime = 0;

        let initialNavigationSuccess = false;
        while (!initialNavigationSuccess) {
            try {
                const navigationPromise = page.goto(finalConfig.AWS_SIGNUP_URL, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT });
                const watchdogPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('START_NAVIGATION_TIMEOUT')), START_NAVIGATION_TIMEOUT)
                );
                
                await Promise.race([navigationPromise, watchdogPromise]);
                initialNavigationSuccess = true;
                
            } catch (error) {
                if (isRecoverableError(error) || error.message.includes('START_NAVIGATION_TIMEOUT')) {
                    const reason = error.message.includes('START_NAVIGATION_TIMEOUT') ? "启动导航超时(60秒)" : "初始页面加载网络错误";
                    reportStatus("错误", `${reason}，执行FIX...`);
                    consecutiveFixes++;
                    if (consecutiveFixes > MAX_CONSECUTIVE_FIXES) {
                        throw new Error(`初始页面加载连续FIX失败 ${MAX_CONSECUTIVE_FIXES} 次，流程终止。`);
                    }
                    // 【修改点1】即使FIX失败也保持重试
                    const fixSuccess = await executeFixProcess(instanceId, PROXY_PORT, page, reason);
                    if (!fixSuccess) {
                         console.error(`[${instanceId}] 初始导航的FIX流程执行失败，但这将被计为一次尝试。 (当前连续FIX次数: ${consecutiveFixes})`);
                         reportStatus("错误", `${reason}，且FIX流程也失败了。将继续尝试...`);
                    }
                } else { throw error; }
            }
        }
        consecutiveFixes = 0;

        let lastActiveWorkflowKey = 'signup?request_type=register';
        let allWorkflowsComplete = false;
        page.on('load', () => {
            const loadedUrl = page.url();
            console.log(`[${instanceId} 事件] 页面加载: ${loadedUrl.substring(0, 80)}...`);
            for (const urlPart in WORKFLOWS) { if (loadedUrl.includes(urlPart)) { workflowState[urlPart] = 0; } }
        });

        mainLoop: while (!allWorkflowsComplete) {
            if (pauseState[instanceId]) {
                reportStatus("暂停中", "用户手动暂停");
                while (pauseState[instanceId]) { await new Promise(resolve => setTimeout(resolve, 2000)); }
                reportStatus("运行中", "已从暂停中恢复...");
            }
            if (sharedState.networkInterrupted) {
                consecutiveFixes++;
                if (consecutiveFixes > MAX_CONSECUTIVE_FIXES) { throw new Error(`网络中断连续FIX ${MAX_CONSECUTIVE_FIXES} 次后仍无进展，流程终止。`); }
                reportStatus("网络中断", "检测到中断，执行FIX...");
                const fixSuccess = await executeFixProcess(instanceId, PROXY_PORT, page, "网络观察员检测到中断");
                sharedState.networkInterrupted = false;
                if(fixSuccess) {
                    reportStatus("运行中", "网络FIX完成，继续...");
                    networkWatcher.start();
                } else {
                    console.error(`[${instanceId}] 网络中断后的FIX流程失败，但这将被计为一次尝试。 (当前连续FIX次数: ${consecutiveFixes})`);
                    reportStatus("错误", "网络中断FIX失败，将继续尝试...");
                }
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
                    try {
                        reportStatus("切换页面", `从 ${lastActiveWorkflowKey} 到 ${activeWorkflowKey}`);
                        await page.reload({ waitUntil: 'load', timeout: NAVIGATION_TIMEOUT });
                        lastActiveWorkflowKey = activeWorkflowKey;
                        continue mainLoop;
                    } catch (error) {
                        if (isRecoverableError(error)) {
                            reportStatus("错误", "切换页面时刷新超时，执行FIX...");
                            consecutiveFixes++;
                            if (consecutiveFixes > MAX_CONSECUTIVE_FIXES) {
                                throw new Error(`切换页面时连续FIX ${MAX_CONSECUTIVE_FIXES} 次后仍失败，流程终止。`);
                            }
                            const fixSuccess = await executeFixProcess(instanceId, PROXY_PORT, page, "切换页面时刷新发生网络错误");
                            // 【修改点1】即使FIX失败也保持重试
                            if (!fixSuccess) {
                                console.error(`[${instanceId}] 页面切换刷新的FIX流程失败，但这将被计为一次尝试。 (当前连续FIX次数: ${consecutiveFixes})`);
                                reportStatus("错误", "切换页面FIX失败，将继续尝试...");
                            }
                            continue mainLoop;
                        } else {
                            throw error;
                        }
                    }
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
                        consecutiveFixes = 0;
                        if (result?.status === 'final_success') allWorkflowsComplete = true;
                        break;
                    } catch (error) {
                        console.error(`[${instanceId} 失败] 模块 ${moduleName} 第 ${moduleRetries + 1} 次尝试出错: ${error.message.substring(0, 200)}`);
                        reportStatus("错误", `模块 ${moduleName} 出错: ${error.message}`);
                        
                        const isKnownFailure = KNOWN_FAILURE_MESSAGES.some(msg => error.message.includes(msg));
                        if (isKnownFailure) {
                            throw error;
                        }
                        
                        if (isRecoverableError(error) || error.message.includes("PHONE_NUMBER_UPDATED_AND_RELOADED")) {
                            if (!error.message.includes("PHONE_NUMBER_UPDATED_AND_RELOADED")) {
                                consecutiveFixes++;
                                if (consecutiveFixes > MAX_CONSECUTIVE_FIXES) { throw new Error(`模块 ${moduleName} 连续FIX ${MAX_CONSECUTIVE_FIXES} 次后仍发生网络错误，流程终止。`); }
                                const fixSuccess = await executeFixProcess(instanceId, PROXY_PORT, page, `模块 ${moduleName} 发生网络错误`);
                                // 【修改点1】即使FIX失败也保持重试
                                if (!fixSuccess) {
                                    console.error(`[${instanceId}] 模块错误的FIX流程失败，但这将被计为一次尝试。 (当前连续FIX次数: ${consecutiveFixes})`);
                                    reportStatus("错误", `模块 ${moduleName} FIX失败，将继续尝试...`);
                                }
                            }
                            continue mainLoop;
                        }
                        
                        moduleRetries++;
                        if (moduleRetries >= MAX_MODULE_RETRIES) { throw new Error(`[${instanceId}] 模块 ${moduleName} 已达最大重试次数。`); }
                        console.log(`[${instanceId} 重试] (非超时错误) 准备刷新页面...`);
                        try {
                            await page.reload({ waitUntil: 'load', timeout: NAVIGATION_TIMEOUT });
                            continue mainLoop;
                        } catch (reloadError) {
                            if (isRecoverableError(reloadError)) {
                                consecutiveFixes++;
                                if (consecutiveFixes > MAX_CONSECUTIVE_FIXES) { throw new Error(`重试刷新时连续FIX ${MAX_CONSECUTIVE_FIXES} 次后仍发生网络错误，流程终止。`); }
                                const fixSuccess = await executeFixProcess(instanceId, PROXY_PORT, page, `重试时刷新页面发生网络错误`);
                                // 【修改点1】即使FIX失败也保持重试
                                if (!fixSuccess) {
                                    console.error(`[${instanceId}] 重试刷新页面的FIX流程失败，但这将被计为一次尝试。 (当前连续FIX次数: ${consecutiveFixes})`);
                                    reportStatus("错误", "重试刷新FIX失败，将继续尝试...");
                                }
                                continue mainLoop;
                            } else {
                                throw reloadError;
                            }
                        }
                    }
                }
            } else {
                standbyTime += STANDBY_CHECK_INTERVAL;
                reportStatus("待机", `等待页面跳转 (已待机 ${standbyTime / 1000}秒)`);
                if (standbyTime >= MAX_STANDBY_TIME) {
                    const screenshotDir = path.join(__dirname, 'screenshot');
                    await fs.mkdir(screenshotDir, { recursive: true });
                    const screenshotPath = path.join(screenshotDir, `standby_timeout_screenshot_${instanceId}_${Date.now()}.png`);
                    console.log(`[主控 ${instanceId}] 待机超时！正在截取当前页面状态...`);
                    try {
                        await page.screenshot({ path: screenshotPath, fullPage: true });
                        console.log(`[主控 ${instanceId}] 截图已保存至: ${screenshotPath}`);
                    } catch (screenshotError) {
                        console.error(`[主控 ${instanceId}] 截取待机超时截图时失败: ${screenshotError.message}`);
                    }
                    consecutiveFixes++;
                    if (consecutiveFixes > MAX_CONSECUTIVE_FIXES) { throw new Error(`待机超时连续FIX ${MAX_CONSECUTIVE_FIXES} 次后仍无进展，流程终止。`); }
                    const fixSuccess = await executeFixProcess(instanceId, PROXY_PORT, page, `待机超时 (${standbyTime / 1000}秒)`);
                    if (fixSuccess) {
                        standbyTime = 0;
                        continue mainLoop;
                    } else {
                        // 【修改点1】即使FIX失败也保持重试
                        console.error(`[${instanceId}] 待机超时的FIX流程失败，但这将被计为一次尝试。 (当前连续FIX次数: ${consecutiveFixes})`);
                        reportStatus("错误", "待机超时FIX失败，将继续尝试...");
                        standbyTime = 0; // 重置待机时间，避免立即再次触发
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
        
        const isKnownFailure = KNOWN_FAILURE_MESSAGES.some(msg => errorMessage.includes(msg));
        const finalErrorMessage = isKnownFailure 
            ? KNOWN_FAILURE_MESSAGES.find(msg => errorMessage.includes(msg))
            : errorMessage;

        reportStatus("失败", `[${instanceId}] ` + finalErrorMessage);

        if (!errorMessage.includes("REGISTRATION_FAILED_INCOMPLETE")) { await saveFailedCardInfo(signupData); }
        
        if (isKnownFailure) {
            console.log(`[${instanceId} 清理] 此为已知的、可预期的失败 (${finalErrorMessage})，将关闭并删除浏览器。`);
            await tearDownBrowser(browserId);
        } else {
            console.log(`[${instanceId} 保留] 此为未知的失败，将保留浏览器窗口以供排查。`);
            if (page) {
                const screenshotDir = path.join(__dirname, 'screenshot');
                await fs.mkdir(screenshotDir, { recursive: true });
                const screenshotPath = path.join(screenshotDir, `error_screenshot_${instanceId}_${Date.now()}.png`);
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
        const finalConfig = { ...staticConfig, ...dynamicConfig, countryCode: COUNTRY_CODE };
        
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