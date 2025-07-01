// ===================================================================================
// ### main_controller.js (最终成功处理优化版) ###
// ===================================================================================
const fs = require('fs').promises;
const { setupBrowser, tearDownBrowser } = require('./shared/browser_setup');
const config = require('./shared/config');

// ===================================================================================
// 1. 模块定义 (保持不变)
// ===================================================================================
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

// ===================================================================================
// 2. 工作流定义 (保持不变)
// ===================================================================================
const WORKFLOWS = {
    'signup?request_type=register': ['01_fillSignupForm', '02_solveCaptcha', '03_verifyEmail', '04_setPassword'],
    '#/account': ['05_fillContactInfo'],
    '#/paymentinformation': ['06_fillPaymentInfo'],
    '#/identityverification': ['07_enterPhoneNumber', '02_solveCaptcha', '08_verifySms'],
    '#/support': ['09_selectSupportPlan'],
    'confirmation': ['9.5_handleConfirmation'],
    'security_credentials': ['10_createIamKeys']
};

// ===================================================================================
// 3. 主执行函数 (引入分层重试)
// ===================================================================================
async function main() {
    const MAX_WORKFLOW_RETRIES = 3; 
    const MAX_MODULE_RETRIES = 3;   

    let browserId = null;

    for (let attempt = 1; attempt <= MAX_WORKFLOW_RETRIES; attempt++) {
        const instanceId = `workflow-attempt-${attempt}`;
        let page, browser;
        
        const workflowState = {};
        const moduleRetryCounts = {}; 

        try {
            console.log(`\n--- [第 ${attempt}/${MAX_WORKFLOW_RETRIES} 次尝试] AWS URL工作流自动化脚本启动 ---`);
            
            const dataContent = await fs.readFile('./data/signup_data.json', 'utf-8');
            const signupData = JSON.parse(dataContent)[0];
            if (!signupData) throw new Error("signup_data.json 为空或格式错误。");

            ({ browser, page, browserId } = await setupBrowser(instanceId, false));
            
            page.on('load', () => {
                const loadedUrl = page.url();
                console.log(`[事件监听] 页面加载完成: ${loadedUrl}`);
                for (const urlPart in WORKFLOWS) {
                    if (loadedUrl.includes(urlPart)) {
                        const isComplete = (workflowState[urlPart] || 0) >= WORKFLOWS[urlPart].length;
                        if (!isComplete) {
                            console.log(`[状态重置] 页面 ${urlPart} 已加载, 其工作流进度被重置为起点。`);
                            workflowState[urlPart] = 0;
                        }
                    }
                }
            });
            
            await page.goto(config.AWS_SIGNUP_URL, { waitUntil: 'networkidle0' });

            let allWorkflowsComplete = false;
            while (!allWorkflowsComplete) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                const currentUrl = page.url();
                let activeWorkflowKey = null, activeWorkflow = null;

                for (const urlPart in WORKFLOWS) {
                    const isComplete = (workflowState[urlPart] || 0) >= WORKFLOWS[urlPart].length;
                    if (currentUrl.includes(urlPart) && !isComplete) {
                        activeWorkflowKey = urlPart;
                        activeWorkflow = WORKFLOWS[urlPart];
                        break; 
                    }
                }

                if (activeWorkflow) {
                    let currentIndex = workflowState[activeWorkflowKey] || 0;
                    if (currentIndex < activeWorkflow.length) {
                        const moduleName = activeWorkflow[currentIndex];
                        const moduleFunction = modules[moduleName];

                        console.log(`\n[工作流执行] 页面: ${activeWorkflowKey} | 步骤: ${currentIndex + 1}/${activeWorkflow.length} | 模块: ${moduleName}`);
                        
                        try {
                            // 【修改】接收模块的返回值
                            const result = await moduleFunction(page, signupData);
                            
                            console.log(`[成功] 模块 ${moduleName} 执行完毕。`);
                            workflowState[activeWorkflowKey]++;
                            moduleRetryCounts[moduleName] = 0; 
                            
                            // 【新增】检查是否为最终成功状态
                            if (result?.status === 'final_success') {
                                console.log("[控制器] 检测到最终成功状态，准备终止流程...");
                                allWorkflowsComplete = true; // 设置标志以退出循环
                                break; // 立即跳出while循环
                            }
                            
                            console.log("...等待3秒，让页面有时间响应...");
                            await new Promise(resolve => setTimeout(resolve, 3000));

                        } catch (error) {
                            console.error(`[失败] 模块 ${moduleName} 执行出错: ${error.message}`);
                            
                            const currentRetries = (moduleRetryCounts[moduleName] || 0) + 1;
                            moduleRetryCounts[moduleName] = currentRetries;

                            if (currentRetries < MAX_MODULE_RETRIES) {
                                console.log(`[模块内重试] 第 ${currentRetries}/${MAX_MODULE_RETRIES} 次。将在5秒后重试当前模块...`);
                                await new Promise(resolve => setTimeout(resolve, 5000));
                            } else {
                                console.error(`[致命模块失败] 模块 ${moduleName} 已达最大重试次数 (${MAX_MODULE_RETRIES})。`);
                                throw new Error(`模块 ${moduleName} 连续失败，需要重启整个工作流。`);
                            }
                        }
                    }
                } else {
                     console.log(`[待机] 当前URL ${currentUrl} 没有匹配的【未完成】工作流，等待页面跳转...`);
                }
                
                // 【修改】在循环内部也检查一次，如果break后可以快速判断
                if (allWorkflowsComplete || Object.keys(WORKFLOWS).every(key => (workflowState[key] || 0) >= WORKFLOWS[key].length)) {
                    allWorkflowsComplete = true;
                }
            }

            // 循环结束后，检查是否是真的成功
            if(allWorkflowsComplete){
                console.log("\n🎉🎉🎉 [任务完成] 所有预定义的工作流均已成功执行！ 🎉🎉🎉");
                if (browserId) {
                    console.log("脚本执行结束，将在10秒后关闭浏览器...");
                    await new Promise(resolve => setTimeout(resolve, 10000));
                    await tearDownBrowser(browserId);
                    browserId = null;
                }
                return; // 彻底成功，退出主函数
            }

        } catch (error) {
            console.error(`\n[工作流尝试失败] 第 ${attempt} 次尝试发生严重错误:`, error.message);
            if (page) {
                 const screenshotPath = `error_screenshot_${instanceId}.png`;
                 try {
                    await page.screenshot({ path: screenshotPath, fullPage: true });
                    console.log(`错误截图已保存至: ${screenshotPath}`);
                 } catch (e) {
                    console.error('截图失败:', e.message);
                 }
            }
            if (attempt >= MAX_WORKFLOW_RETRIES) {
                console.error("\n[致命错误] 已达最大工作流重试次数，脚本终止。");
                throw error;
            } else {
                console.log(`将在15秒后进行下一次完整的尝试...`);
                await new Promise(resolve => setTimeout(resolve, 15000));
            }
        } finally {
            if (browserId) {
                console.log("正在清理当前尝试的浏览器实例...");
                await tearDownBrowser(browserId);
                browserId = null;
            }
        }
    }
}

main().catch(err => {
    console.error("脚本执行最终失败。", err.message);
    process.exit(1);
});