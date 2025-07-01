// ===================================================================================
// ### utils/network_watcher.js (新增) ###
// ===================================================================================
const axios = require('axios').default;
const { updatepartial } = require('../request'); // 引入比特浏览器API

class NetworkWatcher {
    constructor(browserId, instanceId) {
        this.browserId = browserId;
        this.instanceId = instanceId;
        this.intervalId = null;
        this.isChecking = false;
        console.log(`[网络检测助手 ${this.instanceId}] 已初始化。`);
    }

    start() {
        if (this.intervalId) return;
        this.intervalId = setInterval(() => this.checkNetwork(), 60000);
        console.log(`[网络检测助手 ${this.instanceId}] 已启动，每分钟检测一次网络。`);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log(`[网络检测助手 ${this.instanceId}] 已停止。`);
        }
    }

    async checkNetwork() {
        if (this.isChecking) return;
        this.isChecking = true;

        try {
            await axios.get('https://www.google.com/generate_204', { timeout: 15000 });
        } catch (error) {
            console.warn(`[网络检测助手 ${this.instanceId}] 检测到网络连接超时或失败: ${error.message}`);
            await this.changeProxyPort();
        } finally {
            this.isChecking = false;
        }
    }

    async changeProxyPort() {
        const newPort = Math.floor(Math.random() * (45100 - 45050 + 1)) + 45050;
        console.log(`[网络检测助手 ${this.instanceId}] 准备将代理端口切换至: ${newPort}`);

        try {
            const res = await updatepartial({
                id: this.browserId,
                proxyMethod: 2,
                proxyType: 'socks5',
                port: newPort.toString(),
                host: '127.0.0.1'
            });

            if (res.success) {
                console.log(`[网络检测助手 ${this.instanceId}] ✅ 代理端口成功更新为 ${newPort}。`);
            } else {
                console.error(`[网络检测助手 ${this.instanceId}] ❌ 通过API更新代理端口失败: ${res.msg}`);
            }
        } catch (apiError) {
            console.error(`[网络检测助手 ${this.instanceId}] ❌ 调用比特浏览器API时发生严重错误: ${apiError.message}`);
        }
    }
}

module.exports = { NetworkWatcher };