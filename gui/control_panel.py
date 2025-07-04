# ===================================================================================
# ### gui/control_panel.py (V5.0 - 升级为选项卡式日志) ###
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
        self.root.title("AWS自动化控制面板 V5.0 (选项卡式日志)")
        self.root.geometry("950x750")

        self.node_process = None
        self.log_queue = queue.Queue()
        self.pause_states = {}
        # 【核心优化】用于存储每个窗口的日志控件
        self.log_tabs = {}

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
        
        # 【核心优化】使用Notebook控件代替单一日志框
        self.notebook = ttk.Notebook(frame4)
        self.notebook.pack(fill="both", expand=True)

        # 创建一个默认的“全部”日志选项卡
        self.log_all_frame = ttk.Frame(self.notebook)
        self.notebook.add(self.log_all_frame, text='全部日志')
        self.log_all_text = scrolledtext.ScrolledText(self.log_all_frame, wrap=tk.WORD, height=10)
        self.log_all_text.pack(fill="both", expand=True)

        self.clear_log_button = ttk.Button(frame4, text="清除所有日志", command=self.clear_logs)
        self.clear_log_button.pack(fill="x", padx=0, pady=5, side="bottom")

        self.root.after(100, self.process_log_queue)

    def log(self, message, instance_id=None):
        # 始终在“全部日志”中显示
        self.log_all_text.insert(tk.END, str(message) + '\n')
        self.log_all_text.see(tk.END)
        
        # 如果指定了窗口ID，则在对应的选项卡中也显示
        if instance_id and instance_id in self.log_tabs:
            log_widget = self.log_tabs[instance_id]
            log_widget.insert(tk.END, str(message) + '\n')
            log_widget.see(tk.END)

    def clear_logs(self):
        # 【核心优化】清除所有选项卡的日志
        self.log_all_text.delete('1.0', tk.END)
        for log_widget in self.log_tabs.values():
            log_widget.delete('1.0', tk.END)
        self.log("所有日志已清除。")

    def fetch_data_thread(self, url):
        self.log_queue.put({"type": "LOG", "payload": f"[GUI] 开始从 {url} 请求全部数据..."})
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
            self.log_queue.put({"type": "LOG", "payload": f"[GUI] ✅ 成功！共获取 {len(data_list)} 条数据，已保存至 {os.path.basename(data_path)}"})
        except Exception as e:
            self.log_queue.put({"type": "LOG", "payload": f"[GUI] ❌ 请求API数据时出错: {e}"})
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
        # 【核心优化】重置日志选项卡
        for i in self.notebook.tabs():
            if self.notebook.tab(i, "text") != "全部日志":
                self.notebook.forget(i)
        self.log_tabs.clear()
        
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
                instance_id = None
                
                # 尝试从日志中提取窗口ID
                if "W" in log_message and (" " in log_message or "]" in log_message):
                    parts = log_message.replace("[", " ").replace("]", " ").split()
                    for part in parts:
                        if part.startswith("W") and part[1:].isdigit():
                            instance_id = part
                            break
                
                # 【核心优化】动态创建和路由日志
                if instance_id and instance_id not in self.log_tabs:
                    new_frame = ttk.Frame(self.notebook)
                    self.notebook.add(new_frame, text=instance_id)
                    new_log_text = scrolledtext.ScrolledText(new_frame, wrap=tk.WORD, height=10)
                    new_log_text.pack(fill="both", expand=True)
                    self.log_tabs[instance_id] = new_log_text
                
                if log_message.startswith("STATUS_UPDATE::"):
                    try:
                        status_data = json.loads(log_message.replace("STATUS_UPDATE::", ""))
                        instance_id = status_data.get("instanceId")
                        if not instance_id: continue

                        email = status_data.get("account", "")
                        values = (
                            instance_id, email, status_data.get("status", ""),
                            status_data.get("details", "")
                        )

                        if self.tree.exists(instance_id):
                            self.tree.item(instance_id, values=values)
                        else:
                            self.tree.insert("", "end", iid=instance_id, values=values)
                        
                        self.draw_button(instance_id)
                    except json.JSONDecodeError:
                        self.log(f"[GUI-ERROR] 无法解析状态消息: {log_message}")
                
                if log_message:
                    # 使用封装的log函数进行输出
                    self.log(log_message, instance_id)
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
            self.log(f"[GUI] 已发送命令: {command.strip()}", instance_id=instance_id)
            self.draw_button(instance_id)
        except Exception as e:
            self.log(f"[GUI-ERROR] 发送命令失败: {e}", instance_id=instance_id)
            messagebox.showerror("错误", f"向Node.js进程发送命令失败: {e}")

if __name__ == "__main__":
    root = tk.Tk()
    app = AwsAutomationApp(root)
    root.mainloop()
