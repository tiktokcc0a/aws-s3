// ===================================================================================
// ### config.js (Continue按钮选择器修复版) ###
// ===================================================================================

module.exports = {
    // --- URL ---
    AWS_SIGNUP_URL: "https://signin.aws.amazon.com/signup?request_type=register",
    AWS_IAM_WIZARD_URL: "https://us-east-1.console.aws.amazon.com/iam/home?region=us-east-1#/security_credentials/access-key-wizard",

    // --- 文件保存路径 ---
    KEY_SAVE_PATH: "C:\\Users\\Administrator\\Desktop\\AWS-ACCOUNT",

    // --- 天天识图 API ---
    TTSHITU_API_URL: 'http://api.ttshitu.com/predict',
    TTSHITU_USERNAME: 'tao194250',
    TTSHITU_PASSWORD: 'Too194250',
    TTSHITU_TYPEID: '7',

    // --- 邮箱 API ---
    EMAIL_API_BASE_URL: 'https://mail.32v.us/api/index.php',

    // --- CSS 选择器 (保持您为瑞典配置的版本) ---
    EMAIL_INPUT_SELECTOR: '#emailAddress',
    ACCOUNT_NAME_INPUT_SELECTOR: '#accountName',
    CAPTCHA_TRIGGER_SELECTOR: 'button[data-testid="collect-email-submit-button"]',
    COMMON_CAPTCHA_IFRAME_SELECTOR: 'iframe#core-container',
    COMMON_CAPTCHA_IFRAME_URL_PART: 'threat-mitigation.aws.amazon.com',
    INITIAL_CAPTCHA_IMAGE_SELECTOR: 'img[alt="captcha"]',
    INITIAL_CAPTCHA_INPUT_SELECTOR: 'input[name="captchaGuess"]',
    INITIAL_CAPTCHA_SUBMIT_SELECTOR: 'button[type="submit"]',
    INITIAL_CAPTCHA_ERROR_SELECTOR: 'span[data-testid="error-message"], div[data-testid="error-message"], p.awsui-form-field-error-message',
    INITIAL_CAPTCHA_EXPECTED_ERROR: "That wasn't quite right, please try again.",
    OTP_INPUT_SELECTOR: '#otp',
    OTP_SUBMIT_BUTTON_SELECTOR: 'button[data-testid="verify-email-submit-button"]',
    PASSWORD_INPUT_SELECTOR: '#password',
    RE_PASSWORD_INPUT_SELECTOR: '#rePassword',
    CREATE_PASSWORD_SUBMIT_SELECTOR: 'button[data-testid="create-password-submit-button"]',
    PERSONAL_ACCOUNT_RADIO_SELECTOR: '#awsui-radio-button-2',
    CONTACT_FULL_NAME_SELECTOR: 'input[name="address.fullName"]',
    CONTACT_PHONE_COUNTRY_TRIGGER_SELECTOR: '#awsui-select-0',
    CONTACT_PHONE_DENMARK_OPTION_SELECTOR: 'div[data-value="SE"][title="Sweden (+46)"]',
    CONTACT_ADDRESS_COUNTRY_TRIGGER_SELECTOR: '#awsui-select-1',
    CONTACT_ADDRESS_DENMARK_OPTION_SELECTOR: 'div[data-value="SE"][title="Sweden"]',
    CONTACT_STREET_SELECTOR: 'input[name="address.addressLine1"]',
    CONTACT_CITY_SELECTOR: 'input[name="address.city"]',
    CONTACT_STATE_SELECTOR: 'input[name="address.state"]',
    CONTACT_POSTCODE_SELECTOR: 'input[name="address.postalCode"]',
    CONTACT_PHONE_NUMBER_SELECTOR: 'input[name="address.phoneNumber"]',
    CONTACT_AGREEMENT_CHECKBOX_SELECTOR: 'input[type="checkbox"][name="agreement"]',
    CONTACT_SUBMIT_BUTTON_SELECTOR: 'button.awsui-button-variant-primary[type="submit"][aria-label="Agree and Continue (step 2 of 5)"]',
    PAYMENT_CARD_NUMBER_SELECTOR: '#awsui-input-1',
    PAYMENT_CARD_HOLDER_NAME_SELECTOR: '#awsui-input-3',
    PAYMENT_CVV_SELECTOR: '#awsui-input-2',
    PAYMENT_MONTH_TRIGGER_SELECTOR: '#awsui-select-1',
    PAYMENT_YEAR_TRIGGER_SELECTOR: '#awsui-select-2',
    PAYMENT_SUBMIT_BUTTON_SELECTOR: 'button.awsui-button-variant-primary[type="submit"]',
    PAYMENT_PAGE_FAQ_SELECTOR: 'span.LinkButton_linkButton__eGLo',
    IDENTITY_PHONE_COUNTRY_TRIGGER_SELECTOR: '#awsui-select-0',
    IDENTITY_PHONE_DENMARK_OPTION_SELECTOR: 'div[data-value="SE"][title="Sweden (+46)"]',
    IDENTITY_PHONE_NUMBER_SELECTOR: 'input#awsui-input-1',
    IDENTITY_SEND_SMS_BUTTON_SELECTOR: 'button.awsui-button-variant-primary[type="submit"]',
    IDENTITY_CAPTCHA_IMAGE_SELECTOR: 'img[alt="captcha"]',
    IDENTITY_CAPTCHA_INPUT_SELECTOR: 'input[name="captchaGuess"]',
    IDENTITY_CAPTCHA_SUBMIT_SELECTOR: 'button.awsui_button_vjswe_1379u_157.awsui_variant-primary_vjswe_1379u_230[type="submit"]',
    IDENTITY_CAPTCHA_ERROR_SELECTOR: 'div.awsui_error_1i0s3_1goap_185#form-error-\\\:r0\\\:',
    IDENTITY_SMS_PIN_INPUT_SELECTOR: 'input#awsui-input-2',
    
    // 【修复】使用更稳定、更官方的Puppeteer文本选择器
    IDENTITY_CONTINUE_BUTTON_SELECTOR: 'button ::-p-text(Continue (step 4 of 5))',
    
    FINAL_PHONE_VERIFY_COUNTRY_TRIGGER_SELECTOR: 'div[role="button"][aria-haspopup="listbox"]',
    SUPPORT_PLAN_SUBMIT_BUTTON: 'button ::-p-text(Complete sign up)',
    IAM_UNDERSTAND_CHECKBOX: 'input[name="ack-risk"]', 
    IAM_CREATE_KEY_BUTTON: 'button ::-p-text(Create access key)',

    // 【重要修复】更新密钥相关的选择器
    IAM_SHOW_SECRET_BUTTON: 'strong ::-p-text(Show)', // 新增Show按钮的选择器
    IAM_ACCESS_KEY_VALUE: 'span[data-testid="inner-text"]', // 更新Access Key的选择器
    IAM_SECRET_KEY_VALUE: 'span[data-testid="shown-inner-text"]', // 更新Secret Key的选择器
    
    IAM_DOWNLOAD_BUTTON: 'button ::-p-text(Download .csv file)'
};