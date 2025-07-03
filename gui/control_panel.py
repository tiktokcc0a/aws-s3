# ===================================================================================
# ### gui/control_panel.py (V4.1 - 增加邮箱列) ###
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
        self.root.title("AWS自动化控制面板 V4.1 (增加邮箱列)")
        self.root.geometry("950x750") # 再次增加了窗口宽度以容纳新列

        self.node_process = None
        self.log_queue = queue.Queue()
        self.pause_states = {}

        # --- 顶部控制区 ---
        top_frame = ttk.Frame(self.root)
        top_frame.pack(fill="x", padx=10, pady=5)

        # --- 第一部分: 获取注册数据 ---
        frame1 = ttk.LabelFrame(top_frame, text="第一步: 获取注册数据", padding=(10, 5))
        frame1.pack(side="left", fill="x", expand=True, padx=(0, 5))

        ttk.Label(frame1, text="API URL:").grid(row=0, column=0, sticky="w", padx=5, pady=2)
        self.api_url_entry = ttk.Entry(frame1, width=50)
        self.api_url_entry.insert(0, "https://api.small5.co/autosignup/random/data.json")
        self.api_url_entry.grid(row=0, column=1, columnspan=2, sticky="ew", padx=5, pady=2)
        frame1.grid_columnconfigure(1, weight=1)

        self.fetch_button = ttk.Button(frame1, text="获取全部API数据", command=self.start_fetch_data)
        self.fetch_button.grid(row=1, column=0, columnspan=3, pady=5, sticky="ew", padx=5)

        ttk.Label(frame1, text="国家代码(FIX):").grid(row=2, column=0, sticky="w", padx=5, pady=2)
        self.country_code_entry = ttk.Entry(frame1, width=10)
        self.country_code_entry.insert(0, "SE")
        self.country_code_entry.grid(row=2, column=1, sticky="w", padx=5, pady=2)

        # --- 第二部分: 启动自动化任务 ---
        frame2 = ttk.LabelFrame(top_frame, text="第二步: 启动与控制", padding=(10, 5))
        frame2.pack(side="right", fill="x", padx=(5, 0))

        self.headless_var = tk.BooleanVar()
        self.headless_check = ttk.Checkbutton(frame2, text="无头模式", variable=self.headless_var)
        self.headless_check.pack(pady=2, anchor='w')

        self.start_button = ttk.Button(frame2, text="!! 启动自动化 !!", command=self.start_automation, width=15)
        self.start_button.pack(pady=5, fill='x')

        self.stop_button = ttk.Button(frame2, text="!! 停止脚本 !!", command=self.stop_automation, state="disabled", width=15)
        self.stop_button.pack(pady=5, fill='x')
        
        # --- 第三部分: 实时状态监控 ---
        frame3 = ttk.LabelFrame(self.root, text="第三部分: 窗口实时状态监控", padding=(10, 5))
        frame3.pack(fill="x", padx=10, pady=5)
        
        # 【核心修改】在列定义中增加 "email"
        self.tree = ttk.Treeview(frame3, columns=("window", "email", "status", "details", "action"), show="headings", height=8)
        self.tree.heading("window", text="窗口名")
        self.tree.heading("email", text="邮箱")
        self.tree.heading("status", text="状态")
        self.tree.heading("details", text="详情")
        self.tree.heading("action", text="操作")

        self.tree.column("window", width=80, anchor='center')
        self.tree.column("email", width=180)
        self.tree.column("status", width=100, anchor='center')
        self.tree.column("details", width=350)
        self.tree.column("action", width=120, anchor='center')
        
        self.tree.pack(side="left", fill="both", expand=True)

        self.tree.bind("<Button-1>", self.on_tree_click)

        # --- 第四部分: 原始日志输出 ---
        frame4 = ttk.LabelFrame(self.root, text="第四部分: 原始日志输出", padding=(10, 5))
        frame4.pack(fill="both", expand=True, padx=10, pady=5)

        self.log_text = scrolledtext.ScrolledText(frame4, wrap=tk.WORD, height=10)
        self.log_text.pack(fill="both", expand=True, side="top")

        self.clear_log_button = ttk.Button(frame4, text="清除日志输出", command=self.clear_logs)
        self.clear_log_button.pack(fill="x", padx=0, pady=5, side="bottom")

        self.root.after(100, self.process_log_queue)

    def log(self, message):
        self.log_text.insert(tk.END, str(message) + '\n')
        self.log_text.see(tk.END)

    def clear_logs(self):
        self.log_text.delete('1.0', tk.END)
        self.log("日志已清除。\n")

    def fetch_data_thread(self, url):
        self.log(f"[GUI] 开始从 {url} 请求全部数据...")
        try:
            response = requests.get(url, timeout=60)
            response.raise_for_status()
            data_list = response.json()
            if not isinstance(data_list, list): raise ValueError("API返回的不是JSON数组")
            script_dir = os.path.dirname(os.path.abspath(__file__))
            project_root = os.path.dirname(script_dir)
            data_path = os.path.join(project_root, 'data', 'signup_data.json')
            os.makedirs(os.path.dirname(data_path), exist_ok=True)
            with open(data_path, 'w', encoding='utf-8') as f:
                json.dump(data_list, f, indent=4, ensure_ascii=False)
            self.log(f"[GUI] ✅ 成功！共获取 {len(data_list)} 条数据，已保存至 {os.path.basename(data_path)}")
        except Exception as e:
            self.log(f"[GUI] ❌ 请求API数据时出错: {e}")
        finally:
            self.log_queue.put({"type": "CONTROL", "payload": "FETCH_DATA_COMPLETE"})

    def start_fetch_data(self):
        url = self.api_url_entry.get()
        if not url: return messagebox.showerror("错误", "API URL不能为空")
        self.fetch_button.config(state="disabled")
        threading.Thread(target=self.fetch_data_thread, args=(url,), daemon=True).start()

    def enqueue_output(self, out, queue):
        try:
            for line in iter(out.readline, ''):
                queue.put({"type": "LOG", "payload": line})
            out.close()
        except Exception: pass

    def start_automation(self):
        self.tree.delete(*self.tree.get_children())
        self.pause_states = {}
        script_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.dirname(script_dir)
        main_script_path = os.path.join(project_root, 'main_controller.js')
        if not os.path.exists(main_script_path): return messagebox.showerror("错误", f"未找到主脚本: {main_script_path}")
        country_code = self.country_code_entry.get()
        if not country_code or len(country_code) != 2: return messagebox.showerror("错误", "国家代码必须为2个字母")
        command = ['node', main_script_path, f'--country={country_code}']
        if self.headless_var.get(): command.append('--headless')
        self.log(f"[GUI] 执行命令: {' '.join(command)}")
        creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        self.node_process = subprocess.Popen(
            command, stdout=subprocess.PIPE, stdin=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding='utf-8', errors='replace', bufsize=1, creationflags=creationflags, cwd=project_root
        )
        threading.Thread(target=self.enqueue_output, args=(self.node_process.stdout, self.log_queue), daemon=True).start()
        self.start_button.config(state="disabled")
        self.stop_button.config(state="normal")
        self.log("[GUI] 自动化脚本已启动...")

    def stop_automation(self):
        if self.node_process:
            self.log("[GUI] 正在发送终止信号到Node.js脚本...")
            self.node_process.terminate()
            try: self.node_process.wait(timeout=2)
            except subprocess.TimeoutExpired: self.node_process.kill()
            self.node_process = None
            self.log("[GUI] 脚本已终止。")
        self.start_button.config(state="normal")
        self.stop_button.config(state="disabled")

    def process_log_queue(self):
        try:
            while True:
                message_obj = self.log_queue.get_nowait()
                msg_type = message_obj.get("type")
                payload = message_obj.get("payload")

                if msg_type == "CONTROL":
                    if payload == "FETCH_DATA_COMPLETE": self.fetch_button.config(state="normal")
                    continue

                log_message = payload.strip()
                if log_message.startswith("STATUS_UPDATE::"):
                    try:
                        status_data = json.loads(log_message.replace("STATUS_UPDATE::", ""))
                        instance_id = status_data.get("instanceId")
                        if not instance_id: continue

                        # 【核心修改】提取 account 字段作为 email，并构造 values 元组
                        email = status_data.get("account", "") # 新增
                        values = (
                            instance_id,
                            email,
                            status_data.get("status", ""),
                            status_data.get("details", "")
                        )

                        if self.tree.exists(instance_id):
                            # 如果行存在，只更新 email/status/details
                            self.tree.item(instance_id, values=values)
                        else:
                            # 如果行不存在，则插入新行
                            self.tree.insert("", "end", iid=instance_id, values=values)
                        
                        self.draw_button(instance_id)

                    except json.JSONDecodeError:
                        self.log(f"[GUI-ERROR] 无法解析状态消息: {log_message}")
                elif log_message:
                    self.log(log_message)
        except queue.Empty:
            pass
        finally:
            if self.node_process and self.node_process.poll() is not None:
                self.log("[GUI] Node.js进程已结束。")
                self.stop_automation()
            self.root.after(100, self.process_log_queue)
    
    def on_tree_click(self, event):
        region = self.tree.identify("region", event.x, event.y)
        if region == "cell":
            # 【核心修改】因为增加了一列，操作列的ID从#4变为#5
            column_id = self.tree.identify_column(event.x)
            if column_id == "#5":
                item_id = self.tree.identify_row(event.y)
                self.toggle_pause(item_id)

    def draw_button(self, item_id):
        current_state = self.pause_states.get(item_id, '运行中')
        button_text = "恢复" if current_state == '暂停中' else "暂停"
        self.tree.set(item_id, "action", button_text)
    
    def toggle_pause(self, instance_id):
        if not self.node_process or self.node_process.poll() is not None:
            return messagebox.showwarning("警告", "脚本未在运行中。")
        current_state = self.pause_states.get(instance_id, '运行中')
        new_state = '暂停中' if current_state == '运行中' else '运行中'
        command_prefix = "PAUSE" if new_state == '暂停中' else "RESUME"
        command = f"{command_prefix}::{instance_id}\n"
        try:
            self.node_process.stdin.write(command)
            self.node_process.stdin.flush()
            self.pause_states[instance_id] = new_state
            self.log(f"[GUI] 已发送命令: {command.strip()}")
            self.draw_button(instance_id)
        except Exception as e:
            self.log(f"[GUI-ERROR] 发送命令失败: {e}")
            messagebox.showerror("错误", f"向Node.js进程发送命令失败: {e}")

if __name__ == "__main__":
    root = tk.Tk()
    app = AwsAutomationApp(root)
    root.mainloop()
