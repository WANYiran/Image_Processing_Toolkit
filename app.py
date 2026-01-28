#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
整合图片处理工具 - Flask Web 应用
包含：URL下载图片、图片裁剪、图片调整大小
"""

from flask import Flask, request, jsonify, send_from_directory, send_file, render_template
from flask_cors import CORS
import pandas as pd
import requests
from io import BytesIO
import os
from pathlib import Path
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
import base64
from PIL import Image
import zipfile
import tempfile
import io
from werkzeug.utils import secure_filename
import atexit
import signal
import shutil
import webbrowser
import threading
import time

app = Flask(__name__)
CORS(app)

# 使用系统临时目录存储所有数据
TEMP_BASE_DIR = os.path.join(tempfile.gettempdir(), 'integrated_image_tool')
# 配置 - 所有文件夹都在临时目录下
UPLOAD_FOLDER = os.path.join(TEMP_BASE_DIR, 'uploads')
OUTPUT_FOLDER = os.path.join(TEMP_BASE_DIR, 'resized_images')
PROCESSED_FOLDER = os.path.join(TEMP_BASE_DIR, 'processed')
RESIZE_OUTPUT_FOLDER = os.path.join(TEMP_BASE_DIR, 'output')
EXPANDED_FOLDER = os.path.join(TEMP_BASE_DIR, 'expanded_images')
RATIO_CROP_FOLDER = os.path.join(TEMP_BASE_DIR, 'ratio_cropped')
ALLOWED_IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'}
ALLOWED_CSV_EXTENSIONS = {'csv'}

# 通义千问API配置
DASHSCOPE_API_KEY = os.getenv('DASHSCOPE_API_KEY')
DASHSCOPE_API_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/out-painting'
DASHSCOPE_TASK_URL = 'https://dashscope.aliyuncs.com/api/v1/tasks'

# 确保文件夹存在
Path(TEMP_BASE_DIR).mkdir(exist_ok=True)
Path(UPLOAD_FOLDER).mkdir(exist_ok=True)
Path(OUTPUT_FOLDER).mkdir(exist_ok=True)
Path(PROCESSED_FOLDER).mkdir(exist_ok=True)
Path(RESIZE_OUTPUT_FOLDER).mkdir(exist_ok=True)
Path(EXPANDED_FOLDER).mkdir(exist_ok=True)
Path(RATIO_CROP_FOLDER).mkdir(exist_ok=True)

# 打印临时目录路径（便于调试）
print(f"📁 数据存储目录: {TEMP_BASE_DIR}")

# ==================== 清理函数 ====================
def cleanup_temp_files():
    """清理所有临时文件"""
    try:
        if os.path.exists(TEMP_BASE_DIR):
            shutil.rmtree(TEMP_BASE_DIR)
            print(f"🧹 已清理临时文件: {TEMP_BASE_DIR}")
    except Exception as e:
        print(f"⚠️  清理临时文件时出错: {e}")

def signal_handler(signum, frame):
    """处理中断信号（如 Ctrl+C）"""
    print("\n\n🛑 正在停止程序...")
    cleanup_temp_files()
    exit(0)

# 注册退出时的清理函数
atexit.register(cleanup_temp_files)

# 注册信号处理器（处理 Ctrl+C 等中断）
signal.signal(signal.SIGINT, signal_handler)
# Windows 上可能不支持 SIGTERM
try:
    signal.signal(signal.SIGTERM, signal_handler)
except AttributeError:
    pass  # Windows 上不支持 SIGTERM，忽略

app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024 * 1024  # 5GB（支持批量上传）

# 导入配置
try:
    from config import APP_VERSION, GITHUB_RELEASE_API
except ImportError:
    # 如果config.py不存在，使用默认值
    APP_VERSION = "1.0.0"
    GITHUB_RELEASE_API = "https://api.github.com/repos/YOUR_USERNAME/YOUR_REPO/releases/latest"
    print("⚠️  未找到config.py文件，使用默认配置")

# ==================== 主页路由 ====================
@app.route('/')
def index():
    """主页 - 功能选择页面"""
    return render_template('index.html')

# ==================== URL下载功能 ====================
@app.route('/download_url')
def download_url_page():
    """URL下载功能页面"""
    return render_template('download_url.html')

@app.route('/api/upload-csv', methods=['POST'])
def upload_csv():
    """上传并解析 CSV 文件"""
    if 'file' not in request.files:
        return jsonify({'error': '没有文件'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '文件为空'}), 400
    
    if file and '.' in file.filename and file.filename.rsplit('.', 1)[1].lower() in ALLOWED_CSV_EXTENSIONS:
        try:
            filename = f"{uuid.uuid4()}.csv"
            filepath = os.path.join(UPLOAD_FOLDER, filename)
            file.save(filepath)
            
            df = pd.read_csv(filepath, encoding='utf-8')
            df.columns = df.columns.str.strip()
            required_columns = ['album_id', 'url']
            missing_columns = []
            
            for col in required_columns:
                if col not in df.columns:
                    missing_columns.append(col)
            
            if missing_columns:
                return jsonify({
                    'error': f'CSV 文件缺少必需的列：{", ".join(missing_columns)}。CSV 文件必须包含 album_id 和 url 两列'
                }), 400
            
            images = []
            for index, row in df.iterrows():
                url = str(row['url']).strip()
                if not url or url == 'nan' or url == '':
                    continue
                
                image_data = {
                    'id': index,
                    'album_id': str(row['album_id']).strip(),
                    'url': url
                }
                images.append(image_data)
            
            return jsonify({
                'success': True,
                'filename': filename,
                'total': len(images),
                'images': images
            })
        except Exception as e:
            return jsonify({'error': f'处理 CSV 文件时出错: {str(e)}'}), 500
    
    return jsonify({'error': '不支持的文件类型'}), 400

@app.route('/api/preview-image', methods=['GET'])
def preview_image():
    """预览图片（返回 base64 编码）"""
    url = request.args.get('url')
    if not url:
        return jsonify({'error': '缺少 URL 参数'}), 400
    
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        
        img_base64 = base64.b64encode(response.content).decode('utf-8')
        content_type = response.headers.get('content-type', 'image/jpeg')
        
        return jsonify({
            'success': True,
            'data': f'data:{content_type};base64,{img_base64}'
        })
    except Exception as e:
        return jsonify({'error': f'加载图片失败: {str(e)}'}), 500

def download_single_image(img_data):
    """下载单张图片"""
    url = img_data.get('url')
    album_id = img_data.get('album_id', str(uuid.uuid4()))
    
    if not url:
        return {
            'album_id': album_id,
            'url': url,
            'status': 'failed',
            'error': '缺少 URL'
        }
    
    try:
        response = requests.get(url, timeout=30, stream=True)
        response.raise_for_status()
        
        content_type = response.headers.get('content-type', '')
        if 'jpeg' in content_type or 'jpg' in content_type:
            ext = '.jpg'
        elif 'png' in content_type:
            ext = '.png'
        elif 'gif' in content_type:
            ext = '.gif'
        elif 'webp' in content_type:
            ext = '.webp'
        else:
            ext = Path(url).suffix or '.jpg'
        
        # 确保使用绝对路径
        output_folder = os.path.abspath(OUTPUT_FOLDER)
        os.makedirs(output_folder, exist_ok=True)
        output_path = os.path.join(output_folder, f"{album_id}{ext}")
        
        print(f"保存图片到: {output_path}")
        
        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        
        # 验证文件是否成功保存
        if not os.path.exists(output_path):
            print(f"错误: 文件保存失败，文件不存在: {output_path}")
            return {
                'album_id': album_id,
                'url': url,
                'status': 'failed',
                'error': '文件保存失败'
            }
        
        file_size = os.path.getsize(output_path)
        print(f"文件保存成功: {output_path}, 大小: {file_size} bytes")
        
        return {
            'album_id': album_id,
            'url': url,
            'status': 'success',
            'output_path': str(output_path),
            'filename': f"{album_id}{ext}"
        }
    except Exception as e:
        return {
            'album_id': album_id,
            'url': url,
            'status': 'failed',
            'error': str(e)
        }

@app.route('/api/download-images', methods=['POST'])
def download_images():
    """批量下载图片"""
    data = request.json
    images = data.get('images', [])
    
    if not images:
        return jsonify({'error': '没有选择图片'}), 400
    
    results = []
    success_count = 0
    failed_count = 0
    
    max_workers = min(20, len(images), 20)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_image = {executor.submit(download_single_image, img_data): img_data for img_data in images}
        
        for future in as_completed(future_to_image):
            result = future.result()
            results.append(result)
            if result['status'] == 'success':
                success_count += 1
            else:
                failed_count += 1
    
    return jsonify({
        'success': True,
        'total': len(images),
        'success_count': success_count,
        'failed_count': failed_count,
        'results': results
    })

@app.route('/api/download/<filename>')
def download_file_url(filename):
    """下载图片文件（URL下载功能）"""
    try:
        output_folder = os.path.abspath(OUTPUT_FOLDER)
        filepath = os.path.join(output_folder, filename)
        
        print(f"下载请求: filename={filename}")
        print(f"文件路径: {filepath}")
        print(f"文件是否存在: {os.path.exists(filepath)}")
        
        if not os.path.exists(filepath):
            folder_contents = os.listdir(output_folder) if os.path.exists(output_folder) else []
            print(f"resized_images文件夹内容: {folder_contents}")
            return jsonify({'error': f'文件不存在: {filename}'}), 404
        
        return send_from_directory(output_folder, filename)
    except Exception as e:
        print(f"下载文件出错: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'下载失败: {str(e)}'}), 500

# ==================== 图片裁剪功能 ====================
@app.route('/crop_image')
def crop_image_page():
    """图片裁剪功能页面"""
    return render_template('crop_image.html')

@app.route('/api/upload', methods=['POST'])
def upload_files():
    """处理批量图片上传（裁剪和调整大小共用）"""
    if 'files' not in request.files:
        return jsonify({'error': '没有文件'}), 400
    
    files = request.files.getlist('files')
    uploaded_files = []
    
    for file in files:
        if file and file.filename and '.' in file.filename:
            ext = file.filename.rsplit('.', 1)[1].lower()
            if ext in ALLOWED_IMAGE_EXTENSIONS:
                filename = secure_filename(file.filename)
                unique_filename = f"{uuid.uuid4()}_{filename}"
                filepath = os.path.join(UPLOAD_FOLDER, unique_filename)
                file.save(filepath)
                uploaded_files.append({
                    'original_name': filename,
                    'saved_name': unique_filename,
                    'path': filepath
                })
    
    return jsonify({'files': uploaded_files})

@app.route('/api/crop', methods=['POST'])
def crop_images():
    """裁切图片（支持上下左右全方位裁剪）"""
    data = request.json
    files = data.get('files', [])
    crop_top = int(data.get('cropTop', 0))
    crop_bottom = int(data.get('cropBottom', 0))
    crop_left = int(data.get('cropLeft', 0))
    crop_right = int(data.get('cropRight', 0))
    
    processed_files = []
    
    for file_info in files:
        try:
            saved_name = file_info['saved_name']
            original_name = file_info['original_name']
            filepath = os.path.join(UPLOAD_FOLDER, saved_name)
            
            img = Image.open(filepath)
            width, height = img.size
            
            # 计算裁切区域（支持上下左右全方位裁剪）
            left = crop_left
            top = crop_top
            right = width - crop_right
            bottom = height - crop_bottom
            
            # 验证裁切参数
            if top >= bottom or left >= right or top < 0 or left < 0 or bottom > height or right > width:
                return jsonify({'error': f'裁切参数无效: {original_name}。请确保裁切后的图片尺寸大于0'}), 400
            
            if right <= left or bottom <= top:
                return jsonify({'error': f'裁切参数无效: {original_name}。裁切后的宽度或高度必须大于0'}), 400
            
            cropped_img = img.crop((left, top, right, bottom))
            
            processed_filename = f"cropped_{saved_name}"
            # 使用绝对路径确保文件保存到正确位置
            processed_folder_abs = os.path.abspath(PROCESSED_FOLDER)
            os.makedirs(processed_folder_abs, exist_ok=True)
            processed_path = os.path.join(processed_folder_abs, processed_filename)
            
            # 保存图片
            cropped_img.save(processed_path, quality=95)
            
            # PIL的save方法已经会确保文件写入，这里只需要验证文件是否存在
            # 验证文件是否存在
            if not os.path.exists(processed_path):
                raise Exception(f"文件保存失败，文件不存在: {processed_path}")
            
            file_size = os.path.getsize(processed_path)
            print(f"裁剪图片保存成功: {processed_path}, 大小: {file_size} bytes")
            
            processed_files.append({
                'original_name': original_name,
                'processed_name': processed_filename,
                'path': processed_path
            })
        except Exception as e:
            return jsonify({'error': f'处理图片 {file_info.get("original_name", "unknown")} 时出错: {str(e)}'}), 500
    
    return jsonify({'files': processed_files})

@app.route('/api/download-crop/<filename>')
def download_file_crop(filename):
    """下载裁剪后的图片文件"""
    original_name = request.args.get('name', filename)
    if '_' in original_name and len(original_name.split('_')[0]) == 36:
        original_name = '_'.join(original_name.split('_')[1:])
    if filename.startswith('cropped_'):
        name_without_prefix = filename[8:]
        if '_' in name_without_prefix:
            parts = name_without_prefix.split('_', 1)
            if len(parts[0]) == 36:
                original_name = parts[1]
            else:
                original_name = name_without_prefix
        else:
            original_name = name_without_prefix
    
    # 使用绝对路径
    processed_folder_abs = os.path.abspath(PROCESSED_FOLDER)
    filepath = os.path.join(processed_folder_abs, filename)
    
    if not os.path.exists(filepath):
        print(f"下载文件不存在: {filepath}")
        return jsonify({'error': '文件不存在'}), 404
    
    return send_from_directory(
        processed_folder_abs, 
        filename, 
        as_attachment=True,
        download_name=original_name
    )

@app.route('/api/download-all-crop', methods=['POST'])
def download_all_crop():
    """批量下载所有裁剪后的图片为ZIP文件"""
    data = request.json
    files = data.get('files', [])
    
    if not files:
        return jsonify({'error': '没有文件可下载'}), 400
    
    zip_buffer = io.BytesIO()
    processed_folder_abs = os.path.abspath(PROCESSED_FOLDER)
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for file_info in files:
            processed_name = file_info['processed_name']
            original_name = file_info['original_name']
            filepath = os.path.join(processed_folder_abs, processed_name)
            
            if os.path.exists(filepath):
                zip_file.write(filepath, original_name)
            else:
                print(f"批量下载时文件不存在: {filepath}")
    
    zip_buffer.seek(0)
    
    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name='cropped_images.zip'
    )

@app.route('/api/preview-crop/<filename>')
def preview_file_crop(filename):
    """预览裁剪后的图片或原始上传的图片"""
    # 先尝试在processed文件夹中查找（裁剪后的图片）
    processed_folder_abs = os.path.abspath(PROCESSED_FOLDER)
    filepath = os.path.join(processed_folder_abs, filename)
    
    if os.path.exists(filepath):
        return send_from_directory(processed_folder_abs, filename)
    
    # 如果不存在，尝试在uploads文件夹中查找（原始上传的图片）
    upload_folder_abs = os.path.abspath(UPLOAD_FOLDER)
    filepath = os.path.join(upload_folder_abs, filename)
    
    if os.path.exists(filepath):
        return send_from_directory(upload_folder_abs, filename)
    
    print(f"预览文件不存在: {filename}")
    return jsonify({'error': '文件不存在'}), 404

# ==================== 图片调整大小功能 ====================
@app.route('/resize_image')
def resize_image_page():
    """图片调整大小功能页面"""
    return render_template('resize_image.html')

@app.route('/api/resize', methods=['POST'])
def resize_images():
    """调整图片尺寸"""
    data = request.json
    files = data.get('files', [])
    width = int(data.get('width', 800))
    height = int(data.get('height', 600))
    
    if not files:
        return jsonify({'error': '没有选择文件'}), 400
    
    if width <= 0 or height <= 0:
        return jsonify({'error': '尺寸必须大于0'}), 400
    
    # 清理输出文件夹
    output_dir = RESIZE_OUTPUT_FOLDER
    if os.path.exists(output_dir):
        for filename in os.listdir(output_dir):
            file_path = os.path.join(output_dir, filename)
            if os.path.isfile(file_path):
                try:
                    os.remove(file_path)
                except:
                    pass
    
    uploaded_file_paths = [file_info['path'] for file_info in files]
    
    results = []
    success_count = 0
    fail_count = 0
    
    for file_info in files:
        try:
            input_path = file_info['path']
            original_filename = file_info['original_name']
            
            img = Image.open(input_path)
            resized_img = img.resize((width, height), Image.Resampling.LANCZOS)
            
            output_filename = secure_filename(original_filename)
            output_path = os.path.join(RESIZE_OUTPUT_FOLDER, output_filename)
            resized_img.save(output_path, quality=95)
            
            success_count += 1
            results.append({
                'success': True,
                'filename': original_filename,
                'output_filename': output_filename,
                'message': f'成功处理：{original_filename}'
            })
            
        except Exception as e:
            fail_count += 1
            results.append({
                'success': False,
                'filename': file_info.get('original_name', '未知'),
                'error': str(e)
            })
    
    # 清理上传的临时文件
    for file_path in uploaded_file_paths:
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except:
            pass
    
    return jsonify({
        'results': results,
        'success_count': success_count,
        'fail_count': fail_count
    })

@app.route('/api/download-resize/<filename>')
def download_file_resize(filename):
    """下载调整大小后的文件"""
    return send_from_directory(RESIZE_OUTPUT_FOLDER, filename, as_attachment=True)

@app.route('/api/download-all-resize', methods=['POST'])
def download_all_resize():
    """下载所有调整大小后的文件（打包为 ZIP）"""
    try:
        temp_zip = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
        zip_path = temp_zip.name
        temp_zip.close()
        
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            output_dir = RESIZE_OUTPUT_FOLDER
            if os.path.exists(output_dir):
                for filename in os.listdir(output_dir):
                    file_path = os.path.join(output_dir, filename)
                    if os.path.isfile(file_path):
                        zipf.write(file_path, filename)
        
        return send_file(
            zip_path,
            mimetype='application/zip',
            as_attachment=True,
            download_name='resized_images.zip'
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ==================== AI智能扩图功能 ====================
@app.route('/expand_image')
def expand_image_page():
    """AI智能扩图功能页面"""
    return render_template('expand_image.html')

@app.route('/api/check-api-key', methods=['GET'])
def check_api_key():
    """检查API Key是否配置"""
    return jsonify({
        'configured': bool(DASHSCOPE_API_KEY),
        'message': 'API Key已配置' if DASHSCOPE_API_KEY else 'API Key未配置'
    })

@app.route('/api/expand', methods=['POST'])
def expand_image():
    """提交扩图任务到通义千问API"""
    if not DASHSCOPE_API_KEY:
        error_msg = (
            '未配置DASHSCOPE_API_KEY环境变量。\n\n'
            '请按以下步骤配置：\n'
            '1. Windows: 在命令行运行: set DASHSCOPE_API_KEY=your_api_key\n'
            '2. Linux/Mac: 在命令行运行: export DASHSCOPE_API_KEY=your_api_key\n'
            '3. 配置后需要重启应用才能生效'
        )
        return jsonify({'error': error_msg}), 500
    
    data = request.json
    file_info = data.get('file')
    expand_top = int(data.get('expandTop', 0))
    expand_bottom = int(data.get('expandBottom', 0))
    expand_left = int(data.get('expandLeft', 0))
    expand_right = int(data.get('expandRight', 0))
    
    if not file_info:
        return jsonify({'error': '缺少文件信息'}), 400
    
    try:
        # 读取图片文件并转换为base64
        saved_name = file_info.get('saved_name')
        filepath = os.path.join(UPLOAD_FOLDER, saved_name)
        
        if not os.path.exists(filepath):
            return jsonify({'error': '文件不存在'}), 400
        
        # 读取图片并转换为base64
        with open(filepath, 'rb') as f:
            image_data = f.read()
            image_base64 = base64.b64encode(image_data).decode('utf-8')
        
        # 获取图片格式
        img = Image.open(filepath)
        img_format = img.format.lower() if img.format else 'jpeg'
        if img_format == 'jpeg':
            img_format = 'jpg'
        
        # 调用通义千问API
        # 根据API文档，支持image_url（公网可访问的URL）或image（base64格式）
        # 由于本地URL无法被API访问，我们使用base64格式
        headers = {
            'X-DashScope-Async': 'enable',
            'Authorization': f'Bearer {DASHSCOPE_API_KEY}',
            'Content-Type': 'application/json'
        }
        
        # 根据API文档，需要使用image_url字段
        # API可能只接受公网可访问的HTTP/HTTPS URL，不接受base64 data URL
        # 如果API不接受data URL，需要：
        # 1. 使用内网穿透工具（如ngrok）将本地服务器暴露到公网
        # 2. 或将图片上传到公网可访问的临时存储服务
        
        # 先尝试使用base64 data URL，如果API不接受会返回错误
        image_data_url = f"data:image/{img_format};base64,{image_base64}"
        
        # 如果API不接受data URL，可以尝试使用本地URL（需要内网穿透）
        # image_url = f"{request.scheme}://{request.host}/api/preview-upload/{saved_name}"
        
        image_url = image_data_url  # 先尝试data URL
        
        payload = {
            "model": "image-out-painting",
            "input": {
                "image_url": image_url  # 使用公网可访问的URL
            },
            "parameters": {
                "left_offset": expand_left,
                "right_offset": expand_right,
                "top_offset": expand_top,
                "bottom_offset": expand_bottom
            }
        }
        
        response = requests.post(DASHSCOPE_API_URL, headers=headers, json=payload, timeout=60)
        
        # 检查响应状态
        if response.status_code != 200:
            error_detail = '未知错误'
            try:
                error_data = response.json()
                # 尝试获取详细的错误信息
                if 'message' in error_data:
                    error_detail = error_data['message']
                elif 'error' in error_data:
                    error_detail = error_data['error']
                elif 'code' in error_data:
                    error_detail = f"错误代码: {error_data.get('code')}, 消息: {error_data.get('message', '无详细信息')}"
                else:
                    error_detail = str(error_data)
            except:
                error_detail = response.text[:500] if hasattr(response, 'text') else '无法解析错误信息'
            
            # 记录详细错误信息到控制台（用于调试）
            print(f"API调用失败详情: 状态码={response.status_code}, 错误={error_detail}")
            print(f"请求payload: {payload}")
            
            return jsonify({
                'error': f'API调用失败 (状态码: {response.status_code}): {error_detail}'
            }), response.status_code
        
        result = response.json()
        
        if 'output' in result and 'task_id' in result['output']:
            return jsonify({
                'success': True,
                'task_id': result['output']['task_id'],
                'task_status': result['output'].get('task_status', 'PENDING')
            })
        else:
            # 如果API返回了错误信息，显示出来
            error_msg = 'API返回格式错误'
            if 'message' in result:
                error_msg = result['message']
            elif 'error' in result:
                error_msg = result['error']
            return jsonify({'error': error_msg}), 500
            
    except requests.exceptions.RequestException as e:
        error_msg = str(e)
        # 如果是400错误，尝试获取详细错误信息
        if hasattr(e, 'response') and e.response is not None:
            try:
                error_data = e.response.json()
                error_msg = error_data.get('message', error_data.get('error', error_msg))
            except:
                error_msg = e.response.text[:200] if hasattr(e.response, 'text') else error_msg
        return jsonify({'error': f'调用API失败: {error_msg}'}), 500
    except Exception as e:
        return jsonify({'error': f'处理失败: {str(e)}'}), 500

@app.route('/api/expand-status/<task_id>', methods=['GET'])
def expand_status(task_id):
    """查询扩图任务状态"""
    if not DASHSCOPE_API_KEY:
        return jsonify({'error': '未配置DASHSCOPE_API_KEY环境变量'}), 500
    
    try:
        headers = {
            'Authorization': f'Bearer {DASHSCOPE_API_KEY}'
        }
        
        response = requests.get(f'{DASHSCOPE_TASK_URL}/{task_id}', headers=headers, timeout=30)
        response.raise_for_status()
        
        result = response.json()
        
        if 'output' in result:
            output = result['output']
            task_status = output.get('task_status')
            
            response_data = {
                'task_id': output.get('task_id'),
                'task_status': task_status,
                'output_image_url': output.get('output_image_url')
            }
            
            # 如果任务失败，尝试获取失败原因
            if task_status == 'FAILED':
                # 检查是否有错误信息
                if 'message' in result:
                    response_data['error_message'] = result['message']
                elif 'error' in result:
                    response_data['error_message'] = result['error']
                elif 'code' in result:
                    response_data['error_message'] = f"错误代码: {result.get('code')}"
                # 检查output中是否有错误信息
                if 'error_message' not in response_data or not response_data['error_message']:
                    if 'message' in output:
                        response_data['error_message'] = output['message']
                    elif 'error' in output:
                        response_data['error_message'] = output['error']
                # 如果还是没有，记录整个result用于调试
                if 'error_message' not in response_data or not response_data['error_message']:
                    print(f"任务失败但无错误信息，完整响应: {result}")
                    response_data['error_message'] = '任务处理失败，请查看控制台日志'
            
            return jsonify(response_data)
        else:
            return jsonify({'error': 'API返回格式错误'}), 500
            
    except requests.exceptions.RequestException as e:
        return jsonify({'error': f'查询任务状态失败: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': f'处理失败: {str(e)}'}), 500

@app.route('/api/download-expanded', methods=['POST'])
def download_expanded():
    """下载扩图后的图片并保存到服务器"""
    data = request.json
    image_url = data.get('image_url')
    original_filename = data.get('original_filename')
    
    if not image_url or not original_filename:
        return jsonify({'error': '缺少必要参数'}), 400
    
    try:
        print(f"开始下载扩图结果: image_url={image_url}, original_filename={original_filename}")
        
        # 下载扩图后的图片
        response = requests.get(image_url, timeout=60, stream=True)
        response.raise_for_status()
        
        # 保持原始文件名（使用secure_filename清理特殊字符）
        filename = secure_filename(original_filename)
        
        # 确保文件名有扩展名
        if '.' not in filename:
            # 从Content-Type获取扩展名
            content_type = response.headers.get('content-type', '')
            if 'jpeg' in content_type or 'jpg' in content_type:
                filename = filename + '.jpg'
            elif 'png' in content_type:
                filename = filename + '.png'
            elif 'webp' in content_type:
                filename = filename + '.webp'
            else:
                # 从原始文件名获取扩展名
                if '.' in original_filename:
                    ext = os.path.splitext(original_filename)[1]
                    filename = filename + ext
                else:
                    filename = filename + '.jpg'
        
        # 确保使用绝对路径
        expanded_folder = os.path.abspath(EXPANDED_FOLDER)
        filepath = os.path.join(expanded_folder, filename)
        
        print(f"保存文件到: {filepath}")
        print(f"expanded_folder绝对路径: {expanded_folder}")
        print(f"文件是否存在（保存前）: {os.path.exists(filepath)}")
        
        # 确保文件夹存在
        os.makedirs(expanded_folder, exist_ok=True)
        
        # 保存文件
        try:
            with open(filepath, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:  # 过滤掉空块
                        f.write(chunk)
                f.flush()  # 确保数据写入磁盘
                try:
                    os.fsync(f.fileno())  # 强制同步到磁盘
                except OSError:
                    # 在某些系统上fsync可能失败，但不影响文件保存
                    pass
        except Exception as save_error:
            print(f"保存文件时出错: {str(save_error)}")
            import traceback
            traceback.print_exc()
            return jsonify({'error': f'保存文件失败: {str(save_error)}'}), 500
        
        # 验证文件是否成功保存
        if not os.path.exists(filepath):
            print(f"文件保存后不存在: {filepath}")
            print(f"文件夹内容: {os.listdir(expanded_folder) if os.path.exists(expanded_folder) else '文件夹不存在'}")
            return jsonify({'error': '文件保存失败，文件不存在'}), 500
        
        file_size = os.path.getsize(filepath)
        print(f"文件保存成功: {filename}, 大小: {file_size} bytes")
        print(f"文件完整路径: {filepath}")
        
        return jsonify({
            'success': True,
            'filename': filename,
            'path': filepath
        })
        
    except requests.exceptions.RequestException as e:
        print(f"下载图片失败: {str(e)}")
        return jsonify({'error': f'下载图片失败: {str(e)}'}), 500
    except Exception as e:
        print(f"处理失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'处理失败: {str(e)}'}), 500

@app.route('/api/preview-expand/<filename>')
def preview_expand(filename):
    """预览扩图后的图片"""
    try:
        expanded_folder = os.path.abspath(EXPANDED_FOLDER)
        filepath = os.path.join(expanded_folder, filename)
        
        print(f"预览请求: filename={filename}")
        print(f"文件路径: {filepath}")
        print(f"文件是否存在: {os.path.exists(filepath)}")
        
        if not os.path.exists(filepath):
            folder_contents = os.listdir(expanded_folder) if os.path.exists(expanded_folder) else []
            print(f"expanded_images文件夹内容: {folder_contents}")
            return jsonify({'error': f'文件不存在: {filename}'}), 404
        
        return send_from_directory(expanded_folder, filename)
    except Exception as e:
        print(f"预览文件出错: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'预览失败: {str(e)}'}), 500

@app.route('/api/download-expand/<filename>')
def download_expand(filename):
    """下载扩图后的图片文件"""
    try:
        original_name = request.args.get('name', filename)
        expanded_folder = os.path.abspath(EXPANDED_FOLDER)
        filepath = os.path.join(expanded_folder, filename)
        
        if not os.path.exists(filepath):
            return jsonify({'error': f'文件不存在: {filename}'}), 404
        
        return send_from_directory(
            expanded_folder,
            filename,
            as_attachment=True,
            download_name=original_name
        )
    except Exception as e:
        print(f"下载文件出错: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'下载失败: {str(e)}'}), 500

@app.route('/api/preview-upload/<filename>')
def preview_upload(filename):
    """提供上传图片的预览（用于API调用）"""
    return send_from_directory(UPLOAD_FOLDER, filename)

@app.route('/api/download-all-expand', methods=['POST'])
def download_all_expand():
    """批量下载所有扩图后的图片为ZIP文件"""
    data = request.json
    files = data.get('files', [])
    
    if not files:
        return jsonify({'error': '没有文件可下载'}), 400
    
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for file_info in files:
            expanded_name = file_info.get('expanded_name')
            original_name = file_info.get('original_name')
            filepath = os.path.join(EXPANDED_FOLDER, expanded_name)
            
            if os.path.exists(filepath):
                zip_file.write(filepath, original_name)
    
    zip_buffer.seek(0)
    
    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name='expanded_images.zip'
    )

# ==================== 清理功能 ====================
@app.route('/api/cleanup', methods=['POST'])
def cleanup():
    """清理临时文件"""
    try:
        # 清理上传文件夹
        for filename in os.listdir(UPLOAD_FOLDER):
            filepath = os.path.join(UPLOAD_FOLDER, filename)
            if os.path.isfile(filepath):
                try:
                    os.remove(filepath)
                except:
                    pass
        
        # 清理处理文件夹
        for filename in os.listdir(PROCESSED_FOLDER):
            filepath = os.path.join(PROCESSED_FOLDER, filename)
            if os.path.isfile(filepath):
                try:
                    os.remove(filepath)
                except:
                    pass
        
        # 清理输出文件夹
        for filename in os.listdir(RESIZE_OUTPUT_FOLDER):
            filepath = os.path.join(RESIZE_OUTPUT_FOLDER, filename)
            if os.path.isfile(filepath):
                try:
                    os.remove(filepath)
                except:
                    pass
        
        # 清理下载文件夹
        for filename in os.listdir(OUTPUT_FOLDER):
            filepath = os.path.join(OUTPUT_FOLDER, filename)
            if os.path.isfile(filepath):
                try:
                    os.remove(filepath)
                except:
                    pass
        
        # 清理扩图文件夹
        for filename in os.listdir(EXPANDED_FOLDER):
            filepath = os.path.join(EXPANDED_FOLDER, filename)
            if os.path.isfile(filepath):
                try:
                    os.remove(filepath)
                except:
                    pass
        
        return jsonify({'message': '清理完成'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ==================== 3:4比例裁切功能 ====================
@app.route('/ratio_crop')
def ratio_crop_page():
    """3:4比例裁切功能页面"""
    return render_template('ratio_crop.html')

@app.route('/api/upload-csv-ratio', methods=['POST'])
def upload_csv_ratio():
    """上传并解析CSV文件，自动识别图片URL列"""
    if 'file' not in request.files:
        return jsonify({'error': '没有文件'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '文件为空'}), 400
    
    if file and '.' in file.filename and file.filename.rsplit('.', 1)[1].lower() in ALLOWED_CSV_EXTENSIONS:
        try:
            filename = f"{uuid.uuid4()}.csv"
            filepath = os.path.join(UPLOAD_FOLDER, filename)
            file.save(filepath)
            
            # 读取CSV
            df = pd.read_csv(filepath, encoding='utf-8')
            df.columns = df.columns.str.strip()
            
            # 自动识别包含URL的列（查找包含'url'、'link'、'image'等关键词的列）
            url_column = None
            for col in df.columns:
                col_lower = col.lower()
                if 'url' in col_lower or 'link' in col_lower or 'image' in col_lower:
                    url_column = col
                    break
            
            if url_column is None:
                return jsonify({'error': '无法自动识别图片URL列，请确保CSV文件包含包含"url"、"link"或"image"关键词的列'}), 400
            
            # 自动识别专辑ID列（查找第一列或包含'id'、'专辑'等关键词的列）
            album_id_column = None
            # 先检查第一列
            first_col = df.columns[0]
            first_col_lower = first_col.lower()
            if 'id' in first_col_lower or '专辑' in first_col or 'album' in first_col_lower:
                album_id_column = first_col
            else:
                # 查找包含'id'的列
                for col in df.columns:
                    col_lower = col.lower()
                    if 'id' in col_lower and '专辑' in col:
                        album_id_column = col
                        break
                # 如果还没找到，使用第一列作为专辑ID
                if album_id_column is None:
                    album_id_column = first_col
            
            # 提取图片URL
            images = []
            for index, row in df.iterrows():
                url = str(row[url_column]).strip()
                if not url or url == 'nan' or url == '' or not url.startswith(('http://', 'https://')):
                    continue
                
                # 提取专辑ID
                album_id = str(row[album_id_column]).strip() if album_id_column else str(index)
                if not album_id or album_id == 'nan':
                    album_id = str(index)
                
                image_data = {
                    'id': index,
                    'url': url,
                    'album_id': album_id,  # 专辑ID
                    'original_name': f"{album_id}.jpg"  # 使用专辑ID作为默认名称
                }
                images.append(image_data)
            
            if len(images) == 0:
                return jsonify({'error': 'CSV文件中没有找到有效的图片URL'}), 400
            
            return jsonify({
                'success': True,
                'filename': filename,
                'total': len(images),
                'images': images,
                'url_column': url_column
            })
        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({'error': f'处理CSV文件时出错: {str(e)}'}), 500
    
    return jsonify({'error': '不支持的文件类型'}), 400

@app.route('/api/load-image-ratio', methods=['POST'])
def load_image_ratio():
    """从URL加载图片并返回base64编码"""
    data = request.json
    url = data.get('url')
    
    if not url:
        return jsonify({'error': '缺少URL参数'}), 400
    
    try:
        response = requests.get(url, timeout=30, stream=True)
        response.raise_for_status()
        
        # 读取图片数据
        img_data = BytesIO(response.content)
        img = Image.open(img_data)
        
        # 转换为base64
        buffered = BytesIO()
        img_format = img.format or 'JPEG'
        img.save(buffered, format=img_format)
        img_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
        img_data_url = f"data:image/{img_format.lower()};base64,{img_base64}"
        
        return jsonify({
            'success': True,
            'data_url': img_data_url,
            'width': img.width,
            'height': img.height,
            'format': img_format
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'加载图片失败: {str(e)}'}), 500

@app.route('/api/crop-ratio', methods=['POST'])
def crop_ratio():
    """执行3:4比例裁切（保持高度不变）"""
    try:
        data = request.json
        if not data:
            return jsonify({'error': '请求数据为空'}), 400
        
        url = data.get('url')
        offset_x = int(data.get('offsetX', 0))  # 悬浮框的X偏移量
        original_width = int(data.get('originalWidth', 0))
        original_height = int(data.get('originalHeight', 0))
        image_id = data.get('imageId', 0)
        album_id = data.get('albumId', str(image_id))  # 专辑ID
        original_name = data.get('originalName', f'{album_id}.jpg')
        
        if not url:
            return jsonify({'error': '缺少URL参数'}), 400
        
        if original_width <= 0 or original_height <= 0:
            return jsonify({'error': '图片尺寸无效'}), 400
        # 下载图片
        response = requests.get(url, timeout=30, stream=True)
        response.raise_for_status()
        img_data = BytesIO(response.content)
        img = Image.open(img_data)
        
        # 验证实际图片尺寸
        actual_width, actual_height = img.size
        print(f"原始图片尺寸: {actual_width}x{actual_height}, 前端传入尺寸: {original_width}x{original_height}")
        
        # 使用实际图片尺寸
        img_width = actual_width
        img_height = actual_height
        
        # 计算3:4比例的宽度（保持高度不变）
        target_height = img_height
        target_width = int(target_height * 3 / 4)
        
        # 如果目标宽度大于图片宽度，使用图片宽度
        if target_width > img_width:
            target_width = img_width
            print(f"警告: 目标宽度 {target_width} 大于图片宽度 {img_width}，使用图片宽度")
        
        # 计算裁切区域
        # offset_x是悬浮框相对于图片左边的偏移量（像素）
        # 需要根据前端显示尺寸和实际尺寸的比例进行转换
        # 前端offset_x是基于original_width计算的，需要转换到实际img_width
        if original_width > 0 and original_width != img_width:
            scale_factor = img_width / original_width
            actual_offset_x = int(offset_x * scale_factor)
        else:
            actual_offset_x = offset_x
        
        left = max(0, actual_offset_x)
        top = 0
        right = min(img_width, left + target_width)
        bottom = target_height
        
        # 如果右边超出，调整左边
        if right > img_width:
            right = img_width
            left = max(0, right - target_width)
        
        # 验证裁切区域
        if left >= right or top >= bottom:
            return jsonify({'error': f'裁切区域无效: left={left}, right={right}, top={top}, bottom={bottom}'}), 400
        
        print(f"裁切区域: left={left}, top={top}, right={right}, bottom={bottom}, 目标尺寸: {target_width}x{target_height}")
        
        # 执行裁切
        cropped_img = img.crop((left, top, right, bottom))
        
        # 如果裁切后的宽度小于目标宽度，需要调整（这种情况不应该发生，但做保护）
        if cropped_img.width < target_width:
            # 创建目标尺寸的画布，居中放置
            canvas = Image.new('RGB', (target_width, target_height), (255, 255, 255))
            paste_x = (target_width - cropped_img.width) // 2
            canvas.paste(cropped_img, (paste_x, 0))
            cropped_img = canvas
        
        # 保存裁切后的图片
        processed_folder_abs = os.path.abspath(RATIO_CROP_FOLDER)
        os.makedirs(processed_folder_abs, exist_ok=True)
        
        # 生成文件名（使用专辑ID）
        # 确保专辑ID是安全的文件名
        safe_album_id = secure_filename(str(album_id))
        if not safe_album_id:
            safe_album_id = str(image_id)
        
        # 获取文件扩展名
        file_ext = 'jpg'
        if '.' in original_name:
            file_ext = original_name.rsplit('.', 1)[1].lower()
            if file_ext not in ['jpg', 'jpeg', 'png', 'gif', 'webp']:
                file_ext = 'jpg'
        
        # 使用专辑ID作为文件名
        processed_filename = f"ratio_cropped_{safe_album_id}.{file_ext}"
        
        # 如果文件已存在，添加序号
        processed_path = os.path.join(processed_folder_abs, processed_filename)
        counter = 1
        while os.path.exists(processed_path):
            processed_filename = f"ratio_cropped_{safe_album_id}_{counter}.{file_ext}"
            processed_path = os.path.join(processed_folder_abs, processed_filename)
            counter += 1
        
        # 保存图片
        img_format = img.format or 'JPEG'
        if img_format not in ['JPEG', 'PNG']:
            img_format = 'JPEG'
        cropped_img.save(processed_path, format=img_format, quality=95)
        
        # PIL的save方法已经会确保文件写入，这里只需要验证文件是否存在
        # 验证文件是否存在
        if not os.path.exists(processed_path):
            raise Exception(f"文件保存失败，文件不存在: {processed_path}")
        
        file_size = os.path.getsize(processed_path)
        print(f"3:4比例裁切图片保存成功: {processed_path}, 大小: {file_size} bytes")
        
        return jsonify({
            'success': True,
            'processed_name': processed_filename,
            'original_name': f"{safe_album_id}.{file_ext}",  # 使用专辑ID作为下载文件名
            'album_id': safe_album_id,  # 返回专辑ID
            'width': cropped_img.width,
            'height': cropped_img.height
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'裁切图片失败: {str(e)}'}), 500

@app.route('/api/preview-ratio-crop/<filename>')
def preview_ratio_crop(filename):
    """预览3:4比例裁切后的图片"""
    ratio_crop_folder_abs = os.path.abspath(RATIO_CROP_FOLDER)
    filepath = os.path.join(ratio_crop_folder_abs, filename)
    
    if not os.path.exists(filepath):
        print(f"预览文件不存在: {filepath}")
        return jsonify({'error': '文件不存在'}), 404
    
    return send_from_directory(ratio_crop_folder_abs, filename)

@app.route('/api/download-ratio-crop/<filename>')
def download_ratio_crop(filename):
    """下载3:4比例裁切后的图片"""
    original_name = request.args.get('name', filename)
    
    # 从文件名中提取专辑ID（格式：ratio_cropped_{album_id}.{ext} 或 ratio_cropped_{album_id}_{counter}.{ext}）
    if filename.startswith('ratio_cropped_'):
        # 移除前缀
        name_without_prefix = filename[len('ratio_cropped_'):]
        # 移除扩展名
        if '.' in name_without_prefix:
            name_parts = name_without_prefix.rsplit('.', 1)
            name_without_ext = name_parts[0]
            file_ext = name_parts[1]
            # 如果包含序号（格式：{album_id}_{counter}），只取专辑ID部分
            if '_' in name_without_ext:
                # 检查最后一部分是否是数字（序号）
                parts = name_without_ext.rsplit('_', 1)
                if parts[1].isdigit():
                    album_id = parts[0]
                else:
                    album_id = name_without_ext
            else:
                album_id = name_without_ext
            original_name = f"{album_id}.{file_ext}"
    
    ratio_crop_folder_abs = os.path.abspath(RATIO_CROP_FOLDER)
    filepath = os.path.join(ratio_crop_folder_abs, filename)
    
    if not os.path.exists(filepath):
        print(f"下载文件不存在: {filepath}")
        return jsonify({'error': '文件不存在'}), 404
    
    return send_from_directory(
        ratio_crop_folder_abs,
        filename,
        as_attachment=True,
        download_name=original_name
    )

@app.route('/api/list-ratio-crop', methods=['GET'])
def list_ratio_crop():
    """获取所有已裁切的图片列表"""
    try:
        ratio_crop_folder_abs = os.path.abspath(RATIO_CROP_FOLDER)
        
        if not os.path.exists(ratio_crop_folder_abs):
            return jsonify({'success': True, 'images': []})
        
        images = []
        for filename in os.listdir(ratio_crop_folder_abs):
            if filename.startswith('ratio_cropped_'):
                filepath = os.path.join(ratio_crop_folder_abs, filename)
                if os.path.isfile(filepath):
                    # 从文件名中提取专辑ID作为下载名称
                    original_name = filename
                    if filename.startswith('ratio_cropped_'):
                        # 移除前缀
                        name_without_prefix = filename[len('ratio_cropped_'):]
                        # 移除扩展名
                        if '.' in name_without_prefix:
                            name_parts = name_without_prefix.rsplit('.', 1)
                            name_without_ext = name_parts[0]
                            file_ext = name_parts[1]
                            # 如果包含序号（格式：{album_id}_{counter}），只取专辑ID部分
                            if '_' in name_without_ext:
                                # 检查最后一部分是否是数字（序号）
                                parts = name_without_ext.rsplit('_', 1)
                                if parts[1].isdigit():
                                    album_id = parts[0]
                                else:
                                    album_id = name_without_ext
                            else:
                                album_id = name_without_ext
                            original_name = f"{album_id}.{file_ext}"
                    
                    file_size = os.path.getsize(filepath)
                    file_mtime = os.path.getmtime(filepath)
                    
                    images.append({
                        'processed_name': filename,
                        'original_name': original_name,
                        'size': file_size,
                        'mtime': file_mtime
                    })
        
        # 按修改时间倒序排列（最新的在前）
        images.sort(key=lambda x: x['mtime'], reverse=True)
        
        return jsonify({
            'success': True,
            'total': len(images),
            'images': images
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'获取图片列表失败: {str(e)}'}), 500

@app.route('/api/download-all-ratio-crop', methods=['POST'])
def download_all_ratio_crop():
    """批量下载所有3:4比例裁切后的图片为ZIP文件"""
    data = request.json
    files = data.get('files', [])
    
    if not files:
        return jsonify({'error': '没有文件可下载'}), 400
    
    zip_buffer = io.BytesIO()
    ratio_crop_folder_abs = os.path.abspath(RATIO_CROP_FOLDER)
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for file_info in files:
            processed_name = file_info['processed_name']
            original_name = file_info.get('original_name', processed_name)
            
            # 如果original_name没有正确提取，从processed_name中提取专辑ID
            if not original_name or original_name == processed_name:
                if processed_name.startswith('ratio_cropped_'):
                    name_without_prefix = processed_name[len('ratio_cropped_'):]
                    if '.' in name_without_prefix:
                        name_parts = name_without_prefix.rsplit('.', 1)
                        name_without_ext = name_parts[0]
                        file_ext = name_parts[1]
                        if '_' in name_without_ext:
                            parts = name_without_ext.rsplit('_', 1)
                            if parts[1].isdigit():
                                album_id = parts[0]
                            else:
                                album_id = name_without_ext
                        else:
                            album_id = name_without_ext
                        original_name = f"{album_id}.{file_ext}"
            
            filepath = os.path.join(ratio_crop_folder_abs, processed_name)
            
            if os.path.exists(filepath):
                zip_file.write(filepath, original_name)
            else:
                print(f"批量下载时文件不存在: {filepath}")
    
    zip_buffer.seek(0)
    
    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name='ratio_cropped_images.zip'
    )

# ==================== 更新检查 ====================
@app.route('/api/check-update', methods=['GET'])
def check_update():
    """检查是否有新版本可用"""
    try:
        # 如果未配置GitHub仓库，返回当前版本信息
        if GITHUB_RELEASE_API == "https://api.github.com/repos/YOUR_USERNAME/YOUR_REPO/releases/latest":
            return jsonify({
                'current_version': APP_VERSION,
                'latest_version': APP_VERSION,
                'has_update': False,
                'message': '未配置更新源'
            })
        
        # 从GitHub获取最新版本
        response = requests.get(GITHUB_RELEASE_API, timeout=5)
        if response.status_code == 200:
            release_data = response.json()
            latest_version = release_data.get('tag_name', '').lstrip('v')
            download_url = None
            
            # 查找exe文件的下载链接
            for asset in release_data.get('assets', []):
                if asset.get('name', '').endswith('.exe'):
                    download_url = asset.get('browser_download_url')
                    break
            
            # 简单的版本比较（假设版本号格式为 x.y.z）
            has_update = latest_version != APP_VERSION and latest_version != ''
            
            return jsonify({
                'current_version': APP_VERSION,
                'latest_version': latest_version,
                'has_update': has_update,
                'download_url': download_url,
                'release_notes': release_data.get('body', ''),
                'release_url': release_data.get('html_url', '')
            })
        else:
            return jsonify({
                'current_version': APP_VERSION,
                'latest_version': APP_VERSION,
                'has_update': False,
                'message': '无法连接到更新服务器'
            })
    except Exception as e:
        return jsonify({
            'current_version': APP_VERSION,
            'latest_version': APP_VERSION,
            'has_update': False,
            'message': f'检查更新失败: {str(e)}'
        })

@app.route('/api/version', methods=['GET'])
def get_version():
    """获取当前版本号"""
    return jsonify({
        'version': APP_VERSION
    })

# ==================== 静态文件 ====================
@app.route('/static/<path:path>')
def static_files(path):
    """提供静态文件"""
    return send_from_directory('static', path)

# 全局标志，确保浏览器只打开一次
_browser_opened = False
_browser_lock = threading.Lock()

def open_browser():
    """延迟打开浏览器，确保服务器已启动"""
    global _browser_opened
    time.sleep(1.5)  # 等待服务器启动
    
    # 使用锁确保只打开一次
    with _browser_lock:
        if not _browser_opened:
            try:
                webbrowser.open('http://localhost:5000')
                _browser_opened = True
            except Exception as e:
                print(f"打开浏览器失败: {e}")

if __name__ == '__main__':
    print("=" * 50)
    print("🚀 整合图片处理工具启动中...")
    print(f"📱 访问地址: http://localhost:5000")
    if DASHSCOPE_API_KEY:
        print("✅ 通义千问API Key已配置")
    else:
        print("⚠️  通义千问API Key未配置，扩图功能将不可用")
        print("   请设置环境变量: DASHSCOPE_API_KEY")
    print("=" * 50)
    
    # 检查是否是Flask重载器启动的子进程（避免重复打开）
    # 在打包成exe后，WERKZEUG_RUN_MAIN不会被设置，所以需要其他方式判断
    import sys
    is_reloader = os.environ.get('WERKZEUG_RUN_MAIN') == 'true'
    
    # 只在主进程中打开浏览器（不是重载器的子进程）
    if not is_reloader:
        # 在后台线程中打开浏览器
        threading.Thread(target=open_browser, daemon=True).start()
    
    # 生产环境关闭debug模式和重载器（避免重复打开浏览器）
    app.run(debug=False, port=5000, host='0.0.0.0', use_reloader=False)
