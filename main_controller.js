// ===================================================================================
// ### main_controller.js (V7.1 - 并发控制与FIX功能终极整合版) ###
// ===================================================================================
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios').default; // 【FIX新增】用于FIX流程中的API请求
const { setupBrowser, tearDownBrowser } = require('./shared/browser_setup');
const config = require('./shared/config');
// NetworkWatcher 您可以根据需要决定是否保留，如果FIX能解决大部分问题，它可以被移除
// const { NetworkWatcher } = require('./utils/network_watcher'); 

// 【FIX新增】从命令行参数获取国家代码
const args = process.argv.slice(2);
const countryArg = args.find(arg => arg.startsWith('--country='));
const COUNTRY_CODE = countryArg ? countryArg.split('=')[1] : 'SE'; // 默认为SE

// --- 模块定义 (与您版本一致) ---
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

// --- 工作流定义 (与您版本一致) ---
const WORKFLOWS = {
    'signup?request_type=register': ['01_fillSignupForm', '02_solveCaptcha', '03_verifyEmail', '04_setPassword'],
    '#/account': ['05_fillContactInfo'],
    '#/paymentinformation': ['06_fillPaymentInfo'],
    '#/identityverification': ['07_enterPhoneNumber', '02_solveCaptcha', '08_verifySms'],
    '#/support': ['09_selectSupportPlan'],
    'confirmation': ['9.5_handleConfirmation'],
    'security_credentials': ['10_createIamKeys']
};

// 【并发控制】这是您V7.0的核心，予以完全保留
const MAX_CONCURRENT_SESSIONS = 5; // <--- 在此设置最大并发数

class Semaphore {
    constructor(permits) {
        this.permits = permits;
        this.queue = [];
    }
    async acquire() {
        if (this.permits > 0) {
            this.permits--;
            return Promise.resolve();
        }
        return new Promise(resolve => this.queue.push(resolve));
    }
    release() {
        if (this.queue.length > 0) {
            this.queue.shift()();
        } else {
            this.permits++;
        }
    }
}
const semaphore = new Semaphore(MAX_CONCURRENT_SESSIONS);


/**
 * 【FIX新增】执行FIX流程：更换IP并刷新页面
 */
async function executeFixProcess(instanceId, port, page, reason) {
    console.log(`[${instanceId} FIX] 触发原因: ${reason}. 开始执行FIX流程...`);
    try {
        console.log(`[${instanceId} FIX] 正在为端口 ${port} 请求更换IP (国家: ${COUNTRY_CODE})...`);
        const response = await axios.post('http://localhost:8080/api/proxy/start', {
            line: "Line A (AS Route)",
            country_code: COUNTRY_CODE,
            start_port: port,
            count: 1,
            time: 30
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 25000 
        });

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

// (与您版本一致)
async function saveFailedCardInfo(data) {
    try {
        const info = [
            data['1step_number'], `${data['1step_month']}/${data['1step_year']}`,
            data['1step_code'], data.real_name
        ].join('|');
        const filePath = path.join(__dirname, 'data', 'Not used cards.txt');
        await fs.appendFile(filePath, info + '\n', 'utf-8');
        console.log(`[错误处理] 已将卡信息保存至 ${path.basename(filePath)}`);
    } catch (error) {
        console.error(`[错误处理] 保存卡信息失败: ${error.message}`);
    }
}

// runWorkflow 函数内是FIX逻辑植入的核心区域
async function runWorkflow(signupData, browserIndex) {
    const MAX_MODULE_RETRIES = 3; 
    const NAVIGATION_TIMEOUT = 180000;
    const MAX_STANDBY_TIME = 130000; // 【FIX新增】最大待机超时时间 (130秒)
    const STANDBY_CHECK_INTERVAL = 5000; // 【FIX新增】待机检查间隔 (5秒)
    
    const PROXY_PORT = 45000 + browserIndex;
    const IS_HEADLESS = process.argv.includes('--headless');
    const instanceId = `W${browserIndex + 1}`;

    let page;
    let browserId = null;
        
    const workflowState = {};
    let lastActiveWorkflowKey = null;
    let standbyTime = 0; // 【FIX新增】待机计时器

    try {
        console.log(`\n--- [实例 ${instanceId}] 启动工作流 (端口: ${PROXY_PORT}) ---`);
        
        ({ page, browserId } = await setupBrowser(instanceId, IS_HEADLESS, PROXY_PORT, browserIndex));
        
        page.on('load', () => {
            const loadedUrl = page.url();
            console.log(`[${instanceId} 事件] 页面加载: ${loadedUrl.substring(0, 80)}...`);
            for (const urlPart in WORKFLOWS) {
                if (loadedUrl.includes(urlPart)) {
                    workflowState[urlPart] = 0;
                }
            }
        });
        
        await page.goto(config.AWS_SIGNUP_URL, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT });
        lastActiveWorkflowKey = 'signup?request_type=register';

        let allWorkflowsComplete = false;
        
        mainLoop: while (!allWorkflowsComplete) {
            // 【FIX修改】将等待时间移到循环开始，并作为待机检测的一部分
            await new Promise(resolve => setTimeout(resolve, STANDBY_CHECK_INTERVAL));
            
            const currentUrl = page.url();
            if (currentUrl.includes('/signup/incomplete')) {
                throw new Error("REGISTRATION_FAILED_INCOMPLETE");
            }

            let activeWorkflowKey = null;
            for (const urlPart in WORKFLOWS) {
                const isComplete = (workflowState[urlPart] || 0) >= WORKFLOWS[urlPart].length;
                if (currentUrl.includes(urlPart) && !isComplete) {
                    activeWorkflowKey = urlPart;
                    break;
                }
            }

            if (activeWorkflowKey) {
                standbyTime = 0; // 【FIX重置】进入活动工作流，重置待机计时器

                if (activeWorkflowKey !== lastActiveWorkflowKey) {
                    console.log(`[${instanceId} 状态] 检测到工作流切换: 从 '${lastActiveWorkflowKey}' 到 '${activeWorkflowKey}'。强制刷新...`);
                    await page.reload({ waitUntil: 'load', timeout: NAVIGATION_TIMEOUT });
                    lastActiveWorkflowKey = activeWorkflowKey;
                    continue mainLoop;
                }
                
                const activeWorkflow = WORKFLOWS[activeWorkflowKey];
                let currentIndex = workflowState[activeWorkflowKey] || 0;
                const moduleName = activeWorkflow[currentIndex];
                let moduleRetries = 0;

                while (moduleRetries < MAX_MODULE_RETRIES) {
                    try {
                        console.log(`\n[${instanceId} 执行] 页面: ${activeWorkflowKey} | 模块: ${moduleName} | (尝试 ${moduleRetries + 1}/${MAX_MODULE_RETRIES})`);
                        const result = await modules[moduleName](page, signupData);
                        
                        console.log(`[${instanceId} 成功] 模块 ${moduleName} 执行完毕。`);
                        workflowState[activeWorkflowKey]++;
                        
                        if (result?.status === 'final_success') allWorkflowsComplete = true;
                        break; 

                    } catch (error) {
                        console.error(`[${instanceId} 失败] 模块 ${moduleName} 第 ${moduleRetries + 1} 次尝试出错: ${error.message.substring(0, 200)}`);
                        
                        // 【FIX核心逻辑】判断是否为超时错误，触发FIX流程
                        if (error.message.toLowerCase().includes('timeout')) {
                            const fixSuccess = await executeFixProcess(instanceId, PROXY_PORT, page, `模块 ${moduleName} 超时`);
                            if (fixSuccess) {
                                console.log(`[${instanceId} 状态] FIX成功，将从主循环重新评估步骤。`);
                                continue mainLoop;
                            } else {
                                throw new Error(`[${instanceId} 最终失败] 模块 ${moduleName} 超时，且FIX流程也失败了。`);
                            }
                        }

                        // 对于非超时错误，执行原有的重试逻辑 (与您版本一致)
                        moduleRetries++;
                        if (moduleRetries >= MAX_MODULE_RETRIES) {
                            throw new Error(`[${instanceId} 最终失败] 模块 ${moduleName} 已达最大重试次数。`);
                        }
                        
                        console.log(`[${instanceId} 重试] (非超时错误) 准备刷新页面后进行第 ${moduleRetries + 1} 次尝试...`);
                        try {
                            await page.reload({ waitUntil: 'load', timeout: NAVIGATION_TIMEOUT });
                            console.log(`[${instanceId} 状态] 页面刷新成功，将从主循环重新评估步骤。`);
                            continue mainLoop;
                        } catch (reloadError) {
                            const fixSuccess = await executeFixProcess(instanceId, PROXY_PORT, page, `重试时刷新页面超时`);
                            if (fixSuccess) {
                                continue mainLoop;
                            } else {
                                throw new Error(`[${instanceId} 最终失败] 尝试刷新页面时发生错误，且FIX流程也失败了: ${reloadError.message}`);
                            }
                        }
                    }
                }
            } else { 
                // 【FIX核心逻辑】处理待机超时 (假死)
                standbyTime += STANDBY_CHECK_INTERVAL;
                console.log(`[${instanceId} 待机] 未匹配到任何活动工作流... (已待机 ${standbyTime / 1000}秒)`);
                
                if (standbyTime >= MAX_STANDBY_TIME) {
                    const fixSuccess = await executeFixProcess(instanceId, PROXY_PORT, page, `待机超时 (${standbyTime / 1000}秒)`);
                    if (fixSuccess) {
                        standbyTime = 0; 
                        continue mainLoop;
                    } else {
                         throw new Error(`[${instanceId} 最终失败] 页面待机超时，且FIX流程也失败了。`);
                    }
                }
            }
        }
        console.log(`\n🎉🎉🎉 [${instanceId} 任务完成] 工作流成功！ 🎉🎉🎉`);
    } catch (error) {
        console.error(`\n[${instanceId} 工作流失败] 发生严重错误:`, error.message);
        if (error.message !== "REGISTRATION_FAILED_INCOMPLETE") {
            await saveFailedCardInfo(signupData);
        } else {
             console.log(`[${instanceId} 错误处理] 注册不完整，按规则关闭窗口，不保存卡信息。`);
        }
        if (page) {
             const screenshotPath = `error_screenshot_${instanceId}_${Date.now()}.png`;
             try { await page.screenshot({ path: screenshotPath, fullPage: true }); console.log(`[${instanceId}] 截图已保存: ${screenshotPath}`); } catch (e) {}
        }
        // 当此工作流失败时，抛出错误，以便主函数能捕获并标记
        throw new Error(`[${instanceId} 最终失败] 工作流已终止。`);
    } finally {
        // 不再保留窗口，直接清理
        await tearDownBrowser(browserId);
        console.log(`[${instanceId} 清理] 浏览器实例 ${browserId} 已关闭并删除。`);
    }
}

// main 函数现在是您V7.0的并发控制版本
async function main() {
    try {
        console.log(`准备启动自动化任务... (最大并发数: ${MAX_CONCURRENT_SESSIONS})`);
        const dataContent = await fs.readFile('./data/signup_data.json', 'utf-8');
        const allSignupData = JSON.parse(dataContent);

        if (!allSignupData || allSignupData.length === 0) {
            console.log("数据文件为空，未启动任何任务。");
            return;
        }

        console.log(`从数据文件中加载了 ${allSignupData.length} 个任务。`);

        const workflowPromises = allSignupData.map(async (data, index) => {
            await semaphore.acquire();
            console.log(`[并发控制] 信号量已获取，任务 ${index + 1} 开始执行... (剩余许可: ${semaphore.permits})`);
            try {
                await runWorkflow(data, index);
                return { status: 'success', instance: `W${index + 1}` };
            } catch (err) {
                console.error(`[main] 捕获到工作流 ${index + 1} 的最终失败: ${err.message}`);
                return { status: 'failed', instance: `W${index + 1}` }; 
            } finally {
                console.log(`[并发控制] 任务 ${index + 1} 执行完毕，释放信号量。`);
                semaphore.release();
            }
        });

        const results = await Promise.all(workflowPromises);
        const failedCount = results.filter(r => r.status === 'failed').length;
        const successCount = results.length - failedCount;

        console.log("\n\n[总结] 所有任务均已执行完毕。");
        console.log(`  - 成功: ${successCount} 个`);
        console.log(`  - 失败: ${failedCount} 个`);

    } catch (error) {
        console.error("脚本启动时发生致命错误:", error.message);
        process.exit(1);
    }
}

main();