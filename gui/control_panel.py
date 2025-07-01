# ===================================================================================
# ### gui/control_panel.py (最终版 - 已修复所有已知问题) ###
# ===================================================================================
import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
import json
import requests
import threading
import subprocess
import os
import queue

class AwsAutomationApp:
    def __init__(self, root):
        self.root = root
        self.root.title("AWS自动化控制面板 V2.2 (平台化版)")
        self.root.geometry("600x650")

        self.node_process = None
        self.log_queue = queue.Queue()

        # --- 第一部分: 获取注册数据 ---
        frame1 = ttk.LabelFrame(self.root, text="第一步: 获取注册数据", padding=(10, 5))
        frame1.pack(fill="x", padx=10, pady=5)

        ttk.Label(frame1, text="API URL:").grid(row=0, column=0, sticky="w", padx=5, pady=2)
        self.api_url_entry = ttk.Entry(frame1, width=60)
        self.api_url_entry.insert(0, "https://api.small5.co/autosignup/random/?SE")
        self.api_url_entry.grid(row=0, column=1, columnspan=2, sticky="ew", padx=5, pady=2)
        frame1.grid_columnconfigure(1, weight=1) # 让输入框随窗口拉伸
        
        ttk.Label(frame1, text="请求次数:").grid(row=1, column=0, sticky="w", padx=5, pady=2)
        self.req_count_entry = ttk.Entry(frame1, width=10)
        self.req_count_entry.insert(0, "1")
        self.req_count_entry.grid(row=1, column=1, sticky="w", padx=5, pady=2)

        self.fetch_button = ttk.Button(frame1, text="开始请求API数据", command=self.start_fetch_data)
        self.fetch_button.grid(row=2, column=0, columnspan=3, pady=5, sticky="ew", padx=5)

        ttk.Label(frame1, text="目标国家代码(2字母):").grid(row=3, column=0, sticky="w", padx=5, pady=2)
        self.country_code_entry = ttk.Entry(frame1, width=10)
        self.country_code_entry.insert(0, "SE")
        self.country_code_entry.grid(row=3, column=1, sticky="w", padx=5, pady=2)

        self.save_country_button = ttk.Button(frame1, text="保存国家设置", command=self.save_country_settings)
        self.save_country_button.grid(row=4, column=0, columnspan=3, pady=5, sticky="ew", padx=5)


        # --- 第二部分: 启动自动化任务 ---
        frame2 = ttk.LabelFrame(self.root, text="第二步: 启动自动化任务", padding=(10, 5))
        frame2.pack(fill="x", padx=10, pady=10)
        frame2.grid_columnconfigure(1, weight=1) # 设置列权重

        ttk.Label(frame2, text="浏览器数量:").grid(row=0, column=0, sticky="w", padx=5, pady=2)
        self.browser_count_entry = ttk.Entry(frame2, width=10)
        self.browser_count_entry.insert(0, "1")
        self.browser_count_entry.grid(row=0, column=1, sticky="w", padx=5, pady=2)

        self.headless_var = tk.BooleanVar()
        self.headless_check = ttk.Checkbutton(frame2, text="以无头模式运行", variable=self.headless_var)
        self.headless_check.grid(row=0, column=2, sticky="w", padx=20)
        
        # 【修正】将.pack()改为.grid()来解决布局冲突
        self.start_button = ttk.Button(frame2, text="!! 启动自动化 !!", command=self.start_automation)
        self.start_button.grid(row=1, column=0, columnspan=3, sticky="ew", padx=5, pady=5)

        self.stop_button = ttk.Button(frame2, text="!! 停止脚本 !!", command=self.stop_automation, state="disabled")
        self.stop_button.grid(row=2, column=0, columnspan=3, sticky="ew", padx=5, pady=5)

        # --- 第三部分: 日志输出 ---
        frame3 = ttk.LabelFrame(self.root, text="日志输出 (包含NodeJS实时日志)", padding=(10, 5))
        frame3.pack(fill="both", expand=True, padx=10, pady=5)
        
        self.log_text = scrolledtext.ScrolledText(frame3, wrap=tk.WORD, height=15)
        self.log_text.pack(fill="both", expand=True)

        self.root.after(100, self.process_log_queue)

    def log(self, message):
        self.log_text.insert(tk.END, str(message) + '\n')
        self.log_text.see(tk.END)

    def fetch_data_thread(self, url, count):
        self.log(f"开始从 {url} 请求 {count} 条数据...")
        data_list = []
        try:
            for i in range(count):
                self.log(f"正在请求第 {i+1}/{count} 条...")
                response = requests.get(url, timeout=30)
                response.raise_for_status() # 如果请求失败 (如 404, 500), 会抛出异常
                data_list.append(response.json())
            
            script_dir = os.path.dirname(os.path.abspath(__file__))
            project_root = os.path.dirname(script_dir)
            data_path = os.path.join(project_root, 'data', 'signup_data.json')
            
            os.makedirs(os.path.dirname(data_path), exist_ok=True)
            with open(data_path, 'w', encoding='utf-8') as f:
                json.dump(data_list, f, indent=4, ensure_ascii=False)
            
            self.log(f"✅ 成功！{count} 条数据已保存至 {data_path}")
        except Exception as e:
            self.log(f"❌ 请求API数据时出错: {e}")
        finally:
            # 【最佳实践】通过队列通知主线程更新UI
            self.log_queue.put("FETCH_DATA_COMPLETE")

    def start_fetch_data(self):
        try:
            url = self.api_url_entry.get()
            count = int(self.req_count_entry.get())
            if not url or count <= 0:
                messagebox.showerror("错误", "API URL不能为空，请求次数必须大于0")
                return
            
            self.fetch_button.config(state="disabled")
            thread = threading.Thread(target=self.fetch_data_thread, args=(url, count))
            thread.daemon = True
            thread.start()
        except ValueError:
            messagebox.showerror("错误", "请求次数必须是一个有效的整数")
            # 【修复】在捕获输入错误时，也需要恢复按钮
            self.fetch_button.config(state="normal")

    def save_country_settings(self):
        country_code = self.country_code_entry.get()
        self.log(f"国家代码已设置为: {country_code} (此功能为占位)")
        messagebox.showinfo("提示", f"国家代码设置 '{country_code}' 已保存（模拟）。")
        
    def enqueue_output(self, out, queue):
        try:
            for line in iter(out.readline, ''):
                queue.put(line)
            out.close()
        except Exception:
            pass

    def start_automation(self):
        try:
            browser_count = int(self.browser_count_entry.get())
        except ValueError:
            messagebox.showerror("错误", "浏览器数量必须是一个有效的整数")
            return
            
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(script_dir)
        main_script_path = os.path.join(project_root, 'main_controller.js')

        if not os.path.exists(main_script_path):
            messagebox.showerror("错误", f"未找到主脚本: {main_script_path}")
            return
            
        command = ['node', main_script_path, f'--browsers={browser_count}']
        if self.headless_var.get():
            command.append('--headless')

        self.log(f"执行命令: {' '.join(command)}")

        creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        
        self.node_process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding='utf-8',
            errors='replace',
            bufsize=1,
            creationflags=creationflags,
            cwd=project_root
        )
        
        self.log_thread = threading.Thread(target=self.enqueue_output, args=(self.node_process.stdout, self.log_queue))
        self.log_thread.daemon = True
        self.log_thread.start()

        self.start_button.config(state="disabled")
        self.stop_button.config(state="normal")
        self.log("自动化脚本已启动...")

    def stop_automation(self):
        if self.node_process:
            self.log("正在发送终止信号到Node.js脚本...")
            self.node_process.terminate()
            try:
                # 等待一小段时间让进程响应
                self.node_process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                # 如果terminate无效，则强制杀死
                self.log("进程未在2秒内终止，强制结束。")
                self.node_process.kill()
            self.node_process = None
            self.log("脚本已终止。")
        
        self.start_button.config(state="normal")
        self.stop_button.config(state="disabled")

    def process_log_queue(self):
        try:
            while True:
                message = self.log_queue.get_nowait()
                
                # 【最佳实践】处理来自后台线程的特殊指令
                if message == "FETCH_DATA_COMPLETE":
                    self.fetch_button.config(state="normal")
                else:
                    self.log(message.strip())

        except queue.Empty:
            pass
        finally:
            # 检查Node.js子进程是否已结束
            if self.node_process and self.node_process.poll() is not None:
                self.log("Node.js进程已结束。")
                self.stop_automation()

            # 保持轮询
            self.root.after(100, self.process_log_queue)


if __name__ == "__main__":
    root = tk.Tk()
    app = AwsAutomationApp(root)
    root.mainloop()
