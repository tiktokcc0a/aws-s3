# ===================================================================================
# ### gui/control_panel.py (V3.1 - FIX功能集成版) ###
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
        self.root.title("AWS自动化控制面板 V3.1 (FIX集成终版)")
        self.root.geometry("600x650")

        self.node_process = None
        self.log_queue = queue.Queue()

        # --- 第一部分: 获取注册数据 ---
        frame1 = ttk.LabelFrame(self.root, text="第一步: 获取注册数据", padding=(10, 5))
        frame1.pack(fill="x", padx=10, pady=5)

        ttk.Label(frame1, text="API URL:").grid(row=0, column=0, sticky="w", padx=5, pady=2)
        self.api_url_entry = ttk.Entry(frame1, width=60)
        self.api_url_entry.insert(0, "https://api.small5.co/autosignup/random/data.json")
        self.api_url_entry.grid(row=0, column=1, columnspan=2, sticky="ew", padx=5, pady=2)
        frame1.grid_columnconfigure(1, weight=1)

        self.fetch_button = ttk.Button(frame1, text="获取全部API数据 (单次请求)", command=self.start_fetch_data)
        self.fetch_button.grid(row=1, column=0, columnspan=3, pady=5, sticky="ew", padx=5)

        # 【关键】国家代码是FIX流程更换IP时必需的参数
        ttk.Label(frame1, text="目标国家代码(用于FIX):").grid(row=2, column=0, sticky="w", padx=5, pady=2)
        self.country_code_entry = ttk.Entry(frame1, width=10)
        self.country_code_entry.insert(0, "SE")
        self.country_code_entry.grid(row=2, column=1, sticky="w", padx=5, pady=2)

        self.save_country_button = ttk.Button(frame1, text="保存国家设置", command=self.save_country_settings)
        self.save_country_button.grid(row=3, column=0, columnspan=3, pady=5, sticky="ew", padx=5)


        # --- 第二部分: 启动自动化任务 ---
        frame2 = ttk.LabelFrame(self.root, text="第二步: 启动自动化任务 (数量由数据文件决定)", padding=(10, 5))
        frame2.pack(fill="x", padx=10, pady=10)
        frame2.grid_columnconfigure(1, weight=1)

        self.headless_var = tk.BooleanVar()
        self.headless_check = ttk.Checkbutton(frame2, text="以无头模式运行", variable=self.headless_var)
        self.headless_check.grid(row=0, column=0, sticky="w", padx=5)

        self.start_button = ttk.Button(frame2, text="!! 启动自动化 !!", command=self.start_automation)
        self.start_button.grid(row=1, column=0, columnspan=2, sticky="ew", padx=5, pady=5)

        self.stop_button = ttk.Button(frame2, text="!! 停止脚本 !!", command=self.stop_automation, state="disabled")
        self.stop_button.grid(row=2, column=0, columnspan=2, sticky="ew", padx=5, pady=5)

        # --- 第三部分: 日志输出 ---
        frame3 = ttk.LabelFrame(self.root, text="日志输出 (包含NodeJS实时日志)", padding=(10, 5))
        frame3.pack(fill="both", expand=True, padx=10, pady=5)

        self.log_text = scrolledtext.ScrolledText(frame3, wrap=tk.WORD, height=15)
        self.log_text.pack(fill="both", expand=True, side="top")

        self.clear_log_button = ttk.Button(frame3, text="清除日志输出", command=self.clear_logs)
        self.clear_log_button.pack(fill="x", padx=0, pady=5, side="bottom")

        self.root.after(100, self.process_log_queue)

    def log(self, message):
        self.log_text.insert(tk.END, str(message) + '\n')
        self.log_text.see(tk.END)

    def clear_logs(self):
        self.log_text.delete('1.0', tk.END)
        self.log("日志已清除。\n")

    def fetch_data_thread(self, url):
        self.log(f"开始从 {url} 请求全部数据...")
        try:
            response = requests.get(url, timeout=60)
            response.raise_for_status()
            data_list = response.json()

            if not isinstance(data_list, list):
                raise ValueError("API返回的不是一个有效的JSON数组")

            script_dir = os.path.dirname(os.path.abspath(__file__))
            project_root = os.path.dirname(script_dir)
            data_path = os.path.join(project_root, 'data', 'signup_data.json')

            os.makedirs(os.path.dirname(data_path), exist_ok=True)
            with open(data_path, 'w', encoding='utf-8') as f:
                json.dump(data_list, f, indent=4, ensure_ascii=False)

            self.log(f"✅ 成功！共获取 {len(data_list)} 条数据，已保存至 {os.path.basename(data_path)}")
        except Exception as e:
            self.log(f"❌ 请求API数据时出错: {e}")
        finally:
            self.log_queue.put("FETCH_DATA_COMPLETE")

    def start_fetch_data(self):
        url = self.api_url_entry.get()
        if not url:
            messagebox.showerror("错误", "API URL不能为空")
            return

        self.fetch_button.config(state="disabled")
        thread = threading.Thread(target=self.fetch_data_thread, args=(url,))
        thread.daemon = True
        thread.start()


    def save_country_settings(self):
        country_code = self.country_code_entry.get()
        messagebox.showinfo("提示", f"国家代码 '{country_code}' 的设置将会在启动自动化时传递给脚本。")

    def enqueue_output(self, out, queue):
        try:
            for line in iter(out.readline, ''):
                queue.put(line)
            out.close()
        except Exception:
            pass

    def start_automation(self):
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(script_dir)
        main_script_path = os.path.join(project_root, 'main_controller.js')

        if not os.path.exists(main_script_path):
            messagebox.showerror("错误", f"未找到主脚本: {main_script_path}")
            return
        
        # 【核心修改】获取国家代码，并将其作为命令行参数传递给Node.js脚本
        country_code = self.country_code_entry.get()
        if not country_code or len(country_code) != 2:
            messagebox.showerror("错误", "国家代码必须为2个字母，例如 'SE' 或 'US'")
            return
            
        command = ['node', main_script_path, f'--country={country_code}']
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
                self.node_process.wait(timeout=2)
            except subprocess.TimeoutExpired:
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
                if message == "FETCH_DATA_COMPLETE":
                    self.fetch_button.config(state="normal")
                else:
                    self.log(message.strip())
        except queue.Empty:
            pass
        finally:
            if self.node_process and self.node_process.poll() is not None:
                self.log("Node.js进程已结束。")
                self.stop_automation()
            self.root.after(100, self.process_log_queue)


if __name__ == "__main__":
    root = tk.Tk()
    app = AwsAutomationApp(root)
    root.mainloop()
