// ===================================================================================
// ### main_controller.js (最终修正版 - 已修复所有已知问题) ###
// ===================================================================================
const fs = require('fs').promises;
const path = require('path');
const { setupBrowser, tearDownBrowser } = require('./shared/browser_setup');
const config = require('./shared/config');
const { NetworkWatcher } = require('./utils/network_watcher');

// 1. 模块定义 (保持不变)
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

// 2. 【修复】恢复完整的工作流定义
const WORKFLOWS = {
    'signup?request_type=register': ['01_fillSignupForm', '02_solveCaptcha', '03_verifyEmail', '04_setPassword'],
    '#/account': ['05_fillContactInfo'],
    '#/paymentinformation': ['06_fillPaymentInfo'],
    '#/identityverification': ['07_enterPhoneNumber', '02_solveCaptcha', '08_verifySms'],
    '#/support': ['09_selectSupportPlan'],
    'confirmation': ['9.5_handleConfirmation'],
    'security_credentials': ['10_createIamKeys']
};

// 助手函数：保存失败的卡信息 (保持不变)
async function saveFailedCardInfo(data) {
    try {
        const info = [
            data['1step_number'],
            `${data['1step_month']}/${data['1step_year']}`,
            data['1step_code'], // CVV
            data.real_name
        ].join('|');
        
        const filePath = path.join(__dirname, 'data', 'Not used cards.txt');
        await fs.appendFile(filePath, info + '\n', 'utf-8');
        console.log(`[错误处理] 已将卡信息保存至 ${path.basename(filePath)}`);
    } catch (error) {
        console.error(`[错误处理] 保存卡信息失败: ${error.message}`);
    }
}

// 单个工作流的核心逻辑
async function runWorkflow(signupData, browserIndex) {
    const MAX_WORKFLOW_RETRIES = 3;
    const MAX_MODULE_RETRIES = 3;
    const PROXY_PORT = 45000 + browserIndex;
    const IS_HEADLESS = process.argv.includes('--headless');
    const instanceId = `W${browserIndex + 1}`;

    let browserId = null;
    let networkWatcher = null;

    for (let attempt = 1; attempt <= MAX_WORKFLOW_RETRIES; attempt++) {
        let page;
        
        const workflowState = {};
        const moduleRetryCounts = {};

        try {
            console.log(`\n--- [实例 ${instanceId}] [第 ${attempt}/${MAX_WORKFLOW_RETRIES} 次大重试] 启动工作流 ---`);
            
            ({ page, browserId } = await setupBrowser(instanceId, IS_HEADLESS, PROXY_PORT, browserIndex));
            
            networkWatcher = new NetworkWatcher(browserId, instanceId);
            networkWatcher.start();
            
            // 【修复】恢复 page.on('load') 的核心逻辑
            page.on('load', () => {
                const loadedUrl = page.url();
                console.log(`[${instanceId} 事件] 页面加载: ${loadedUrl.substring(0, 80)}...`);
                // 遍历所有工作流的URL片段
                for (const urlPart in WORKFLOWS) {
                    // 如果当前URL匹配，并且该工作流尚未完成
                    if (loadedUrl.includes(urlPart)) {
                        const isComplete = (workflowState[urlPart] || 0) >= WORKFLOWS[urlPart].length;
                        if (!isComplete) {
                            // 重置此URL对应工作流的进度为0，以便从该页面的第一个模块重新开始
                            console.log(`[${instanceId} 状态] URL匹配 ${urlPart}，进度重置为起点。`);
                            workflowState[urlPart] = 0;
                        }
                    }
                }
            });
            
            await page.goto(config.AWS_SIGNUP_URL, { waitUntil: 'networkidle0' });

            let allWorkflowsComplete = false;
            let idleSince = Date.now();
            let idleReloads = 0;
            const MAX_IDLE_SECONDS = 150; // 2分30秒
            const MAX_IDLE_RELOADS = 3;

            while (!allWorkflowsComplete) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                const currentUrl = page.url();
                let activeWorkflowKey = null;

                for (const urlPart in WORKFLOWS) {
                    const isComplete = (workflowState[urlPart] || 0) >= WORKFLOWS[urlPart].length;
                    if (currentUrl.includes(urlPart) && !isComplete) {
                        activeWorkflowKey = urlPart;
                        break;
                    }
                }

                if (activeWorkflowKey) {
                    idleSince = Date.now();
                    idleReloads = 0;
                    
                    const activeWorkflow = WORKFLOWS[activeWorkflowKey];
                    let currentIndex = workflowState[activeWorkflowKey] || 0;
                    const moduleName = activeWorkflow[currentIndex];

                    console.log(`\n[${instanceId} 执行] 页面: ${activeWorkflowKey} | 步骤: ${currentIndex + 1}/${activeWorkflow.length} | 模块: ${moduleName}`);
                    
                    try {
                        const result = await modules[moduleName](page, signupData);
                        console.log(`[${instanceId} 成功] 模块 ${moduleName} 执行完毕。`);
                        workflowState[activeWorkflowKey]++;
                        moduleRetryCounts[moduleName] = 0; 
                        
                        if (result?.status === 'final_success') {
                            allWorkflowsComplete = true;
                            break;
                        }
                    } catch (error) {
                        console.error(`[${instanceId} 失败] 模块 ${moduleName} 出错: ${error.message}`);
                        
                        if (error.message === "PHONE_NUMBER_UPDATED_AND_RELOADED") {
                             console.log(`[${instanceId} 状态] 手机号已更新并刷新页面，工作流将自动重置并重新执行。`);
                             continue;
                        }

                        const retries = (moduleRetryCounts[moduleName] || 0) + 1;
                        if (retries < MAX_MODULE_RETRIES) {
                            moduleRetryCounts[moduleName] = retries;
                            console.log(`[${instanceId} 重试] 模块内重试第 ${retries}/${MAX_MODULE_RETRIES} 次。`);
                            await new Promise(resolve => setTimeout(resolve, 5000));
                        } else {
                            // 【优化】模块达到最大重试次数后，刷新页面而不是重启整个浏览器
                            console.error(`[${instanceId} 致命模块失败] 模块 ${moduleName} 已达最大重试次数。刷新页面...`);
                            await page.reload({ waitUntil: 'networkidle0' });
                            moduleRetryCounts[moduleName] = 0; // 重置计数器
                        }
                    }
                } else {
                     const idleDuration = (Date.now() - idleSince) / 1000;
                     console.log(`[${instanceId} 待机] 已待机 ${Math.round(idleDuration)}秒...`);
                     
                     if (idleDuration > MAX_IDLE_SECONDS) {
                         if (idleReloads < MAX_IDLE_RELOADS) {
                             idleReloads++;
                             console.warn(`[${instanceId} 待机超时] 执行第 ${idleReloads}/${MAX_IDLE_RELOADS} 次刷新。`);
                             await page.reload({ waitUntil: 'networkidle0' });
                             idleSince = Date.now();
                         } else {
                             throw new Error(`[${instanceId} 致命] 待机超时且达到最大刷新次数，此工作流尝试失败。`);
                         }
                     }
                }
            }

            console.log(`\n🎉🎉🎉 [${instanceId} 任务完成] 工作流成功！ 🎉🎉🎉`);
            return; // 彻底成功，退出此工作流函数

        } catch (error) {
            console.error(`\n[${instanceId} 工作流失败] 第 ${attempt} 次尝试发生严重错误:`, error.message);
            
            if (error.message !== "REGISTRATION_FAILED_INCOMPLETE") {
                await saveFailedCardInfo(signupData);
            } else {
                 console.log(`[${instanceId} 错误处理] 注册不完整，按规则关闭窗口。`);
            }

            if (page) {
                 const screenshotPath = `error_screenshot_${instanceId}_${Date.now()}.png`;
                 try { await page.screenshot({ path: screenshotPath, fullPage: true }); console.log(`[${instanceId}] 截图已保存: ${screenshotPath}`); } catch (e) {}
            }
            if (attempt >= MAX_WORKFLOW_RETRIES) {
                // 【修复】当所有大重试都用完后，向上抛出错误
                throw new Error(`[${instanceId} 最终失败] 已达最大工作流重试次数，此实例彻底失败。`);
            }
            console.log(`[${instanceId}] 将在15秒后进行下一次完整的尝试...`);
            await new Promise(resolve => setTimeout(resolve, 15000));
        } finally {
            if (networkWatcher) networkWatcher.stop();
            if (browserId) await tearDownBrowser(browserId);
        }
    }
}

// 主启动函数
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
                // 捕获从runWorkflow抛出的最终错误
                console.error(`[主进程] 实例 W${index + 1} 报告了最终失败: ${err.message}`);
                return { status: 'failed', instance: `W${index + 1}` }; // 返回一个失败标记
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