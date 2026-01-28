#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
打包脚本 - 使用 PyInstaller 将应用打包成可执行文件
"""

import PyInstaller.__main__
import os
import sys

# 获取当前目录
current_dir = os.path.dirname(os.path.abspath(__file__))

# PyInstaller 参数
# 跨平台路径分隔符处理
import platform
if platform.system() == 'Windows':
    sep = ';'
else:
    sep = ':'

args = [
    'app.py',  # 主程序文件
    '--name=图片处理工具',  # 生成的exe名称
    '--onefile',  # 打包成单个exe文件
    # '--noconsole',  # 如果需要隐藏控制台窗口，取消注释此行（但会看不到日志）
    f'--add-data=templates{sep}templates',  # 包含模板文件夹
    f'--add-data=static{sep}static',  # 包含静态文件文件夹
    '--hidden-import=flask',  # 确保包含Flask
    '--hidden-import=flask_cors',  # 确保包含flask-cors
    '--hidden-import=PIL',  # 确保包含Pillow
    '--hidden-import=pandas',  # 确保包含pandas
    '--hidden-import=requests',  # 确保包含requests
    '--hidden-import=werkzeug',  # 确保包含Werkzeug
    '--collect-all=flask',  # 收集Flask的所有依赖
    '--collect-all=PIL',  # 收集Pillow的所有依赖
    '--icon=NONE',  # 可以指定图标文件路径，如: --icon=icon.ico
]

# 切换到项目目录
os.chdir(current_dir)

# 执行打包
print("=" * 50)
print("开始打包应用...")
print("=" * 50)
PyInstaller.__main__.run(args)

print("\n" + "=" * 50)
print("打包完成！")
import platform
if platform.system() == 'Windows':
    exe_name = "图片处理工具.exe"
else:
    exe_name = "图片处理工具"  # macOS/Linux没有.exe扩展名
print(f"可执行文件位置: {os.path.join(current_dir, 'dist', exe_name)}")
print("=" * 50)
