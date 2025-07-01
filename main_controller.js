// ===================================================================================
// ### main_controller.js (V5.2 - 增加刷新豁免规则) ###
// ===================================================================================
const fs = require('fs').promises;
const path = require('path');
const { setupBrowser, tearDownBrowser } = require('./shared/browser_setup');
const config = require('./shared/config');
const { NetworkWatcher } = require('./utils/network_watcher');

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

async function runWorkflow(signupData, browserIndex) {
    const MAX_MODULE_RETRIES = 5;
    const NAVIGATION_TIMEOUT = 180000;
    const PROXY_PORT = 45000 + browserIndex;
    const IS_HEADLESS = process.argv.includes('--headless');
    const instanceId = `W${browserIndex + 1}`;

    let page;
    let browserId = null;
    let networkWatcher = null;
        
    const workflowState = {};
    let lastActiveWorkflowKey = null;

    try {
        console.log(`\n--- [实例 ${instanceId}] 启动工作流 ---`);
        
        ({ page, browserId } = await setupBrowser(instanceId, IS_HEADLESS, PROXY_PORT, browserIndex));
        networkWatcher = new NetworkWatcher(browserId, instanceId);
        networkWatcher.start();
        
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
            await new Promise(resolve => setTimeout(resolve, 200));
            
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
                if (activeWorkflowKey !== lastActiveWorkflowKey) {
                    console.log(`[${instanceId} 状态] 检测到工作流切换: 从 '${lastActiveWorkflowKey}' 到 '${activeWorkflowKey}'。强制刷新以激活页面...`);
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
                        console.error(`[${instanceId} 失败] 模块 ${moduleName} 第 ${moduleRetries + 1} 次尝试出错: ${error.message}`);
                        
                        // 【核心修改】为模块10设置刷新豁免，打破死循环
                        if (moduleName === '10_createIamKeys') {
                            throw new Error(`[${instanceId} 最终失败] 模块10被设为刷新豁免，不再重试。`);
                        }
                        
                        moduleRetries++;
                        if (moduleRetries >= MAX_MODULE_RETRIES) {
                            throw new Error(`[${instanceId} 最终失败] 模块 ${moduleName} 已达最大重试次数。`);
                        }
                        
                        console.log(`[${instanceId} 重试] 准备刷新页面后进行第 ${moduleRetries + 1} 次尝试...`);
                        try {
                            await page.reload({ waitUntil: 'load', timeout: NAVIGATION_TIMEOUT });
                            console.log(`[${instanceId} 状态] 页面刷新成功，将从主循环重新评估步骤。`);
                            continue mainLoop;
                        } catch (reloadError) {
                            throw new Error(`[${instanceId} 最终失败] 尝试刷新页面时发生错误: ${reloadError.message}`);
                        }
                    }
                }
            } else { 
                console.log(`[${instanceId} 待机] 未匹配到任何活动工作流，等待页面跳转...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
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
        throw new Error(`[${instanceId} 最终失败] 工作流已终止。`);
    } finally {
        if (networkWatcher) networkWatcher.stop();
        console.log(`[${instanceId} 流程结束] 浏览器窗口将保持打开状态以供检查。`);
    }
}

async function main() {
    try {
        const args = process.argv.slice(2);
        const browserCountArg = args.find(arg => arg.startsWith('--browsers='));
        const BROWSER_COUNT = browserCountArg ? parseInt(browserCountArg.split('=')[1], 10) : 1;
        console.log(`准备启动 ${BROWSER_COUNT} 个并发浏览器窗口...`);
        const dataContent = await fs.readFile('./data/signup_data.json', 'utf-8');
        const allSignupData = JSON.parse(dataContent);
        const tasksToRun = allSignupData.slice(0, BROWSER_COUNT);
        const workflowPromises = tasksToRun.map((data, index) => 
            runWorkflow(data, index).catch(err => {
                return { status: 'failed', instance: `W${index + 1}` }; 
            })
        );
        const results = await Promise.all(workflowPromises);
        const failedCount = results.filter(r => r?.status === 'failed').length;
        if (failedCount > 0) {
            console.error(`\n\n[总结] 所有任务执行完毕，其中有 ${failedCount} 个实例最终失败。`);
        } else {
            console.log("\n\n[总结] 所有自动化任务均已成功执行完毕。");
        }
    } catch (error) {
        console.error("脚本启动时发生致命错误:", error.message);
        process.exit(1);
    }
}

main();