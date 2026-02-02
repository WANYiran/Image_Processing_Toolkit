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
from PIL import Image, ImageDraw, ImageFont
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
TEXT_OVERLAY_FOLDER = os.path.join(TEMP_BASE_DIR, 'text_overlay')
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
Path(TEXT_OVERLAY_FOLDER).mkdir(exist_ok=True)

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

# ==================== 辅助函数 ====================
def convert_image_for_saving(img, target_format='JPEG'):
    """
    转换图片模式以便保存为指定格式
    JPEG不支持透明通道，需要将RGBA/P模式转换为RGB
    """
    if target_format == 'JPEG' or target_format == 'JPG':
        # JPEG不支持透明通道，需要转换为RGB
        if img.mode in ('RGBA', 'LA', 'P'):
            # 创建白色背景
            rgb_img = Image.new('RGB', img.size, (255, 255, 255))
            if img.mode == 'P':
                img = img.convert('RGBA')
            rgb_img.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
            return rgb_img
        elif img.mode not in ('RGB', 'L'):
            # 其他模式也转换为RGB
            return img.convert('RGB')
    return img

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
            
            # 返回所有列名和完整的CSV数据
            all_columns = df.columns.tolist()
            
            if len(all_columns) == 0:
                return jsonify({
                    'error': 'CSV文件没有列'
                }), 400
            
            # 将DataFrame转换为字典列表，保存所有数据
            csv_data_list = []
            for index, row in df.iterrows():
                row_data = {}
                for col in all_columns:
                    row_data[col] = str(row[col]).strip() if pd.notna(row[col]) else ''
                csv_data_list.append(row_data)
            
            return jsonify({
                'success': True,
                'filename': filename,
                'columns': all_columns,  # 返回所有列名
                'csv_data': csv_data_list,  # 返回完整的CSV数据
                'total': len(csv_data_list)
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

def download_single_image(img_data, name_column=''):
    """下载单张图片"""
    url = img_data.get('url')
    
    # 使用指定的命名列，如果没有指定则使用 album_id
    if name_column and img_data.get('csv_data') and name_column in img_data['csv_data']:
        file_name = str(img_data['csv_data'][name_column]).strip()
        if not file_name or file_name == 'nan':
            file_name = img_data.get('album_id', str(uuid.uuid4()))
    else:
        file_name = img_data.get('album_id', str(uuid.uuid4()))
    
    album_id = file_name  # 保持向后兼容
    
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
        
        # 清理文件名（移除不合法字符）
        safe_file_name = secure_filename(file_name)
        if not safe_file_name:
            safe_file_name = str(uuid.uuid4())
        
        # 确保使用绝对路径
        output_folder = os.path.abspath(OUTPUT_FOLDER)
        os.makedirs(output_folder, exist_ok=True)
        output_path = os.path.join(output_folder, f"{safe_file_name}{ext}")
        
        # 如果文件已存在，添加序号
        counter = 1
        while os.path.exists(output_path):
            output_path = os.path.join(output_folder, f"{safe_file_name}_{counter}{ext}")
            counter += 1
        
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
        final_filename = os.path.basename(output_path)
        print(f"文件保存成功: {output_path}, 大小: {file_size} bytes")
        
        return {
            'album_id': album_id,
            'url': url,
            'status': 'success',
            'output_path': str(output_path),
            'filename': final_filename
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
    name_column = data.get('name_column', '')  # 获取命名列
    
    if not images:
        return jsonify({'error': '没有选择图片'}), 400
    
    results = []
    success_count = 0
    failed_count = 0
    
    max_workers = min(20, len(images), 20)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # 传递命名列信息给下载函数
        future_to_image = {executor.submit(download_single_image, img_data, name_column): img_data for img_data in images}
        
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

@app.route('/api/upload-csv-crop', methods=['POST'])
def upload_csv_crop():
    """上传并解析CSV文件，用于图片裁剪功能"""
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
            
            # 返回所有列名和完整的CSV数据
            all_columns = df.columns.tolist()
            
            if len(all_columns) == 0:
                return jsonify({'error': 'CSV文件没有列'}), 400
            
            # 将DataFrame转换为字典列表，保存所有数据
            csv_data_list = []
            for index, row in df.iterrows():
                row_data = {}
                for col in all_columns:
                    row_data[col] = str(row[col]).strip() if pd.notna(row[col]) else ''
                csv_data_list.append(row_data)
            
            return jsonify({
                'success': True,
                'filename': filename,
                'columns': all_columns,  # 返回所有列名
                'csv_data': csv_data_list,  # 返回完整的CSV数据
                'total': len(csv_data_list)
            })
        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({'error': f'处理CSV文件时出错: {str(e)}'}), 500
    
    return jsonify({'error': '不支持的文件类型'}), 400

@app.route('/api/crop', methods=['POST'])
def crop_images():
    """裁切图片（支持上下左右全方位裁剪，支持本地文件和URL）"""
    data = request.json
    files = data.get('files', [])  # 本地文件列表
    images = data.get('images', [])  # URL图片列表（从CSV来的）
    name_column = data.get('name_column', '')  # 命名列
    crop_top = int(data.get('cropTop', 0))
    crop_bottom = int(data.get('cropBottom', 0))
    crop_left = int(data.get('cropLeft', 0))
    crop_right = int(data.get('cropRight', 0))
    
    if not files and not images:
        return jsonify({'error': '没有选择文件'}), 400
    
    processed_files = []
    
    # 处理本地文件
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
            
            # 转换图片模式（RGBA等需要转换为RGB才能保存为JPEG）
            cropped_img = convert_image_for_saving(cropped_img, 'JPEG')
            
            # 本地上传：使用原始文件名
            safe_original_name = secure_filename(original_name)
            if not safe_original_name:
                safe_original_name = f"image_{saved_name}"
            
            # 获取文件扩展名
            file_ext = 'jpg'
            if '.' in original_name:
                file_ext = original_name.rsplit('.', 1)[1].lower()
                if file_ext not in ['jpg', 'jpeg', 'png', 'gif', 'webp']:
                    file_ext = 'jpg'
            
            # 移除safe_original_name中的扩展名（如果存在）
            name_without_ext = safe_original_name.rsplit('.', 1)[0] if '.' in safe_original_name else safe_original_name
            
            # 生成处理后的文件名
            processed_filename = f"cropped_{name_without_ext}.{file_ext}"
            # 使用绝对路径确保文件保存到正确位置
            processed_folder_abs = os.path.abspath(PROCESSED_FOLDER)
            os.makedirs(processed_folder_abs, exist_ok=True)
            processed_path = os.path.join(processed_folder_abs, processed_filename)
            
            # 如果文件已存在，添加序号
            counter = 1
            while os.path.exists(processed_path):
                processed_filename = f"cropped_{name_without_ext}_{counter}.{file_ext}"
                processed_path = os.path.join(processed_folder_abs, processed_filename)
                counter += 1
            
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
            import traceback
            error_msg = f'处理图片 {file_info.get("original_name", "unknown")} 时出错: {str(e)}'
            print(f"❌ 错误: {error_msg}")
            traceback.print_exc()
            return jsonify({'error': error_msg}), 500
    
    # 处理URL图片（从CSV来的）
    for image_info in images:
        try:
            url = image_info.get('url')
            if not url:
                print(f"⚠️  警告: 图片信息中缺少URL: {image_info}")
                continue
            
            album_id = image_info.get('album_id', str(image_info.get('id', 'unknown')))
            original_name = image_info.get('original_name', f"{album_id}.jpg")
            
            print(f"📥 开始处理图片: URL={url}, album_id={album_id}, original_name={original_name}")
            
            # 下载图片
            try:
                response = requests.get(url, timeout=30, stream=True)
                response.raise_for_status()
                img_data = BytesIO(response.content)
                img = Image.open(img_data)
                width, height = img.size
                print(f"✅ 图片下载成功: {width}x{height}")
            except Exception as download_error:
                error_msg = f'下载图片失败 (URL: {url}): {str(download_error)}'
                print(f"❌ {error_msg}")
                raise Exception(error_msg)
            
            # 计算裁切区域
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
            
            # 转换图片模式（RGBA等需要转换为RGB才能保存为JPEG）
            cropped_img = convert_image_for_saving(cropped_img, 'JPEG')
            
            # CSV上传：使用命名列作为文件名
            file_ext = 'jpg'
            if '.' in original_name:
                file_ext = original_name.rsplit('.', 1)[1].lower()
                if file_ext not in ['jpg', 'jpeg', 'png', 'gif', 'webp']:
                    file_ext = 'jpg'
            
            # 使用指定的命名列，如果没有指定则使用 album_id
            if name_column and image_info.get('csv_data') and name_column in image_info['csv_data']:
                file_name = str(image_info['csv_data'][name_column]).strip()
                if not file_name or file_name == 'nan':
                    file_name = str(album_id)
            else:
                file_name = str(album_id)
            
            safe_file_name = secure_filename(file_name)
            if not safe_file_name or safe_file_name.strip() == '':
                # 如果secure_filename返回空，使用id或生成一个安全的名称
                fallback_id = str(image_info.get('id', 'unknown'))
                safe_file_name = secure_filename(fallback_id) or f"image_{fallback_id}"
            
            processed_filename = f"cropped_{safe_file_name}.{file_ext}"
            print(f"📝 生成文件名: {processed_filename}")
            processed_folder_abs = os.path.abspath(PROCESSED_FOLDER)
            os.makedirs(processed_folder_abs, exist_ok=True)
            
            # 如果文件已存在，添加序号
            processed_path = os.path.join(processed_folder_abs, processed_filename)
            counter = 1
            while os.path.exists(processed_path):
                processed_filename = f"cropped_{safe_file_name}_{counter}.{file_ext}"
                processed_path = os.path.join(processed_folder_abs, processed_filename)
                counter += 1
            
            # 保存图片
            cropped_img.save(processed_path, quality=95)
            
            if not os.path.exists(processed_path):
                raise Exception(f"文件保存失败，文件不存在: {processed_path}")
            
            file_size = os.path.getsize(processed_path)
            print(f"裁剪图片保存成功: {processed_path}, 大小: {file_size} bytes")
            
            processed_files.append({
                'original_name': f"{safe_file_name}.{file_ext}",  # 使用命名列作为下载文件名
                'processed_name': processed_filename,
                'path': processed_path
            })
        except Exception as e:
            import traceback
            error_msg = f'处理图片 {image_info.get("original_name", "unknown")} 时出错: {str(e)}'
            print(f"❌ 错误: {error_msg}")
            traceback.print_exc()
            return jsonify({'error': error_msg}), 500
    
    return jsonify({'files': processed_files})

@app.route('/api/download-crop/<filename>')
def download_file_crop(filename):
    """下载裁剪后的图片文件"""
    # 直接使用前端传递的name参数作为下载文件名
    original_name = request.args.get('name', filename)
    
    # 如果name参数不存在，尝试从文件名中提取（向后兼容）
    if original_name == filename and filename.startswith('cropped_'):
        name_without_prefix = filename[8:]
        # 移除可能的序号后缀（格式：name_1.jpg）
        if '_' in name_without_prefix:
            parts = name_without_prefix.rsplit('_', 1)
            if parts[1].replace('.', '').isdigit():
                original_name = name_without_prefix.rsplit('_', 1)[0]
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

@app.route('/api/upload-csv-resize', methods=['POST'])
def upload_csv_resize():
    """上传并解析CSV文件，用于图片调整大小功能"""
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
            
            # 返回所有列名和完整的CSV数据
            all_columns = df.columns.tolist()
            
            if len(all_columns) == 0:
                return jsonify({'error': 'CSV文件没有列'}), 400
            
            # 将DataFrame转换为字典列表，保存所有数据
            csv_data_list = []
            for index, row in df.iterrows():
                row_data = {}
                for col in all_columns:
                    row_data[col] = str(row[col]).strip() if pd.notna(row[col]) else ''
                csv_data_list.append(row_data)
            
            return jsonify({
                'success': True,
                'filename': filename,
                'columns': all_columns,  # 返回所有列名
                'csv_data': csv_data_list,  # 返回完整的CSV数据
                'total': len(csv_data_list)
            })
        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({'error': f'处理CSV文件时出错: {str(e)}'}), 500
    
    return jsonify({'error': '不支持的文件类型'}), 400

@app.route('/api/resize', methods=['POST'])
def resize_images():
    """调整图片尺寸（支持本地文件和URL）"""
    data = request.json
    files = data.get('files', [])  # 本地文件列表
    images = data.get('images', [])  # URL图片列表（从CSV来的）
    name_column = data.get('name_column', '')  # 命名列
    width = int(data.get('width', 800))
    height = int(data.get('height', 600))
    
    if not files and not images:
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
    
    # 处理本地文件
    for file_info in files:
        try:
            input_path = file_info['path']
            original_filename = file_info['original_name']
            
            img = Image.open(input_path)
            resized_img = img.resize((width, height), Image.Resampling.LANCZOS)
            
            # 转换图片模式（RGBA等需要转换为RGB才能保存为JPEG）
            resized_img = convert_image_for_saving(resized_img, 'JPEG')
            
            # 本地上传：使用原始文件名
            output_filename = secure_filename(original_filename)
            output_path = os.path.join(RESIZE_OUTPUT_FOLDER, output_filename)
            
            # 如果文件已存在，添加序号
            counter = 1
            while os.path.exists(output_path):
                name_without_ext = output_filename.rsplit('.', 1)[0] if '.' in output_filename else output_filename
                file_ext = output_filename.rsplit('.', 1)[1] if '.' in output_filename else 'jpg'
                output_filename = f"{name_without_ext}_{counter}.{file_ext}"
                output_path = os.path.join(RESIZE_OUTPUT_FOLDER, output_filename)
                counter += 1
            
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
    
    # 处理URL图片（从CSV来的）
    for image_info in images:
        try:
            url = image_info.get('url')
            album_id = image_info.get('album_id', str(image_info.get('id', 'unknown')))
            original_name = image_info.get('original_name', f"{album_id}.jpg")
            
            # 下载图片
            response = requests.get(url, timeout=30, stream=True)
            response.raise_for_status()
            img_data = BytesIO(response.content)
            img = Image.open(img_data)
            
            resized_img = img.resize((width, height), Image.Resampling.LANCZOS)
            
            # 转换图片模式（RGBA等需要转换为RGB才能保存为JPEG）
            resized_img = convert_image_for_saving(resized_img, 'JPEG')
            
            # CSV上传：使用命名列作为文件名
            file_ext = 'jpg'
            if '.' in original_name:
                file_ext = original_name.rsplit('.', 1)[1].lower()
                if file_ext not in ['jpg', 'jpeg', 'png', 'gif', 'webp']:
                    file_ext = 'jpg'
            
            # 使用指定的命名列，如果没有指定则使用 album_id
            if name_column and image_info.get('csv_data') and name_column in image_info['csv_data']:
                file_name = str(image_info['csv_data'][name_column]).strip()
                if not file_name or file_name == 'nan':
                    file_name = str(album_id)
            else:
                file_name = str(album_id)
            
            safe_file_name = secure_filename(file_name)
            if not safe_file_name:
                safe_file_name = str(image_info.get('id', 'unknown'))
            
            output_filename = f"{safe_file_name}.{file_ext}"
            output_path = os.path.join(RESIZE_OUTPUT_FOLDER, output_filename)
            
            # 如果文件已存在，添加序号
            counter = 1
            while os.path.exists(output_path):
                output_filename = f"{safe_file_name}_{counter}.{file_ext}"
                output_path = os.path.join(RESIZE_OUTPUT_FOLDER, output_filename)
                counter += 1
            
            resized_img.save(output_path, quality=95)
            
            success_count += 1
            results.append({
                'success': True,
                'filename': original_name,
                'output_filename': output_filename,
                'message': f'成功处理：{original_name}'
            })
            
        except Exception as e:
            fail_count += 1
            results.append({
                'success': False,
                'filename': image_info.get('original_name', '未知'),
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
            
            # 返回所有列名和完整的CSV数据
            all_columns = df.columns.tolist()
            
            if len(all_columns) == 0:
                return jsonify({'error': 'CSV文件没有列'}), 400
            
            # 将DataFrame转换为字典列表，保存所有数据
            csv_data_list = []
            for index, row in df.iterrows():
                row_data = {}
                for col in all_columns:
                    row_data[col] = str(row[col]).strip() if pd.notna(row[col]) else ''
                csv_data_list.append(row_data)
            
            return jsonify({
                'success': True,
                'filename': filename,
                'columns': all_columns,  # 返回所有列名
                'csv_data': csv_data_list,  # 返回完整的CSV数据
                'total': len(csv_data_list)
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
    """执行3:4比例裁切（保持高度不变，支持本地文件和URL）"""
    try:
        data = request.json
        if not data:
            return jsonify({'error': '请求数据为空'}), 400
        
        url = data.get('url')  # URL图片
        file_path = data.get('file_path')  # 本地文件路径
        saved_name = data.get('saved_name')  # 本地文件保存名
        offset_x = int(data.get('offsetX', 0))  # 悬浮框的X偏移量
        original_width = int(data.get('originalWidth', 0))
        original_height = int(data.get('originalHeight', 0))
        image_id = data.get('imageId', 0)
        album_id = data.get('albumId', str(image_id))  # 专辑ID（CSV上传时使用）
        original_name = data.get('originalName', f'{album_id}.jpg')
        is_local_upload = data.get('is_local_upload', False)  # 是否本地上传
        name_column = data.get('name_column', '')  # 命名列
        csv_data = data.get('csv_data', {})  # CSV行数据
        
        if not url and not file_path:
            return jsonify({'error': '缺少URL或文件路径参数'}), 400
        
        if original_width <= 0 or original_height <= 0:
            return jsonify({'error': '图片尺寸无效'}), 400
        
        # 加载图片（本地文件或URL）
        if file_path and is_local_upload:
            # 本地上传：从文件路径读取
            img = Image.open(file_path)
        else:
            # CSV上传：从URL下载
            if not url:
                return jsonify({'error': '缺少URL参数'}), 400
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
        
        # 转换图片模式（RGBA等需要转换为RGB才能保存为JPEG）
        if cropped_img.mode in ('RGBA', 'LA', 'P'):
            # 如果裁切后的宽度小于目标宽度，需要调整（这种情况不应该发生，但做保护）
            if cropped_img.width < target_width:
                # 创建目标尺寸的画布，居中放置
                canvas = Image.new('RGB', (target_width, target_height), (255, 255, 255))
                if cropped_img.mode == 'P':
                    cropped_img = cropped_img.convert('RGBA')
                paste_x = (target_width - cropped_img.width) // 2
                canvas.paste(cropped_img, (paste_x, 0), mask=cropped_img.split()[-1] if cropped_img.mode == 'RGBA' else None)
                cropped_img = canvas
            else:
                # 直接转换RGBA为RGB
                cropped_img = convert_image_for_saving(cropped_img, 'JPEG')
        elif cropped_img.width < target_width:
            # 如果裁切后的宽度小于目标宽度，需要调整（这种情况不应该发生，但做保护）
            canvas = Image.new('RGB', (target_width, target_height), (255, 255, 255))
            paste_x = (target_width - cropped_img.width) // 2
            canvas.paste(cropped_img, (paste_x, 0))
            cropped_img = canvas
        
        # 保存裁切后的图片
        processed_folder_abs = os.path.abspath(RATIO_CROP_FOLDER)
        os.makedirs(processed_folder_abs, exist_ok=True)
        
        # 生成文件名
        if is_local_upload:
            # 本地上传：使用原始文件名
            file_ext = 'jpg'
            if '.' in original_name:
                file_ext = original_name.rsplit('.', 1)[1].lower()
                if file_ext not in ['jpg', 'jpeg', 'png', 'gif', 'webp']:
                    file_ext = 'jpg'
            safe_original_name = secure_filename(original_name)
            if not safe_original_name:
                safe_original_name = f"image_{image_id}.{file_ext}"
            processed_filename = f"ratio_cropped_{safe_original_name}"
        else:
            # CSV上传：使用命名列作为文件名
            file_ext = 'jpg'
            if '.' in original_name:
                file_ext = original_name.rsplit('.', 1)[1].lower()
                if file_ext not in ['jpg', 'jpeg', 'png', 'gif', 'webp']:
                    file_ext = 'jpg'
            
            # 使用指定的命名列，如果没有指定则使用 album_id
            if name_column and csv_data and name_column in csv_data:
                file_name = str(csv_data[name_column]).strip()
                if not file_name or file_name == 'nan':
                    file_name = str(album_id)
            else:
                file_name = str(album_id)
            
            safe_file_name = secure_filename(file_name)
            if not safe_file_name or safe_file_name.strip() == '':
                safe_file_name = str(image_id)
            
            processed_filename = f"ratio_cropped_{safe_file_name}.{file_ext}"
        
        # 如果文件已存在，添加序号
        processed_path = os.path.join(processed_folder_abs, processed_filename)
        counter = 1
        while os.path.exists(processed_path):
            if is_local_upload:
                name_without_ext = processed_filename.rsplit('.', 1)[0] if '.' in processed_filename else processed_filename
                processed_filename = f"{name_without_ext}_{counter}.{file_ext}"
            else:
                processed_filename = f"ratio_cropped_{safe_file_name}_{counter}.{file_ext}"
            processed_path = os.path.join(processed_folder_abs, processed_filename)
            counter += 1
        
        # 保存图片
        img_format = img.format or 'JPEG'
        if img_format not in ['JPEG', 'PNG']:
            img_format = 'JPEG'
        
        # 如果保存为JPEG，确保图片模式是RGB（已在上面处理，但再次确认）
        if img_format == 'JPEG' and cropped_img.mode not in ('RGB', 'L'):
            cropped_img = convert_image_for_saving(cropped_img, 'JPEG')
        
        cropped_img.save(processed_path, format=img_format, quality=95)
        
        # PIL的save方法已经会确保文件写入，这里只需要验证文件是否存在
        # 验证文件是否存在
        if not os.path.exists(processed_path):
            raise Exception(f"文件保存失败，文件不存在: {processed_path}")
        
        file_size = os.path.getsize(processed_path)
        print(f"3:4比例裁切图片保存成功: {processed_path}, 大小: {file_size} bytes")
        
        # 确定下载文件名
        if is_local_upload:
            download_name = safe_original_name
        else:
            download_name = f"{safe_file_name}.{file_ext}"
        
        return jsonify({
            'success': True,
            'processed_name': processed_filename,
            'original_name': download_name,  # 本地上传用原名，CSV上传用命名列
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
    # 直接使用前端传递的name参数作为下载文件名
    original_name = request.args.get('name', filename)
    
    # 如果name参数不存在，尝试从文件名中提取（向后兼容）
    if original_name == filename and filename.startswith('ratio_cropped_'):
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

# ==================== 图片加字功能 ====================
@app.route('/add_text')
def add_text_page():
    """图片加字功能页面"""
    return render_template('add_text.html')

@app.route('/api/get-original-image/<filename>', methods=['GET'])
def get_original_image(filename):
    """获取原始图片用于预览"""
    try:
        # URL解码文件名（处理特殊字符）
        from urllib.parse import unquote
        filename = unquote(filename)
        
        print(f"获取原始图片: {filename}")
        print(f"UPLOAD_FOLDER: {UPLOAD_FOLDER}")
        print(f"UPLOAD_FOLDER 是否存在: {os.path.exists(UPLOAD_FOLDER)}")
        
        # 首先尝试直接使用文件名查找（可能是UUID格式）
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        print(f"尝试直接查找: {filepath}")
        if os.path.exists(filepath) and os.path.isfile(filepath):
            print(f"找到文件: {filepath}")
            return send_file(filepath)
        
        # 如果直接查找失败，列出所有文件进行匹配
        if os.path.exists(UPLOAD_FOLDER):
            all_files = os.listdir(UPLOAD_FOLDER)
            print(f"UPLOAD_FOLDER 中的文件数量: {len(all_files)}")
            print(f"前5个文件: {all_files[:5]}")
            
            # 尝试精确匹配文件名（不区分大小写）
            filename_lower = filename.lower()
            for file in all_files:
                if file.lower() == filename_lower:
                    potential_path = os.path.join(UPLOAD_FOLDER, file)
                    if os.path.isfile(potential_path):
                        ext = file.rsplit('.', 1)[-1].lower() if '.' in file else ''
                        if ext in ALLOWED_IMAGE_EXTENSIONS:
                            print(f"找到精确匹配的文件: {file}")
                            return send_file(potential_path)
            
            # 如果精确匹配失败，尝试根据扩展名和部分文件名匹配
            # 这用于处理 original_filename 的情况
            filename_ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
            filename_base = filename.rsplit('.', 1)[0].lower() if '.' in filename else filename.lower()
            
            for file in all_files:
                file_lower = file.lower()
                file_ext = file.rsplit('.', 1)[-1].lower() if '.' in file else ''
                
                # 检查扩展名是否匹配
                if filename_ext and file_ext == filename_ext:
                    # 检查文件名是否包含原始文件名的关键部分（数字ID）
                    # 例如：23457286.png 可能匹配到某个 UUID.png
                    if filename_base.isdigit():
                        # 如果原始文件名是纯数字，尝试查找任何匹配扩展名的文件
                        # 但这样可能匹配到错误的文件，所以只在没有其他匹配时使用
                        pass
                    elif filename_base in file_lower or any(char.isdigit() for char in filename_base if filename_base[:8].isdigit()):
                        potential_path = os.path.join(UPLOAD_FOLDER, file)
                        if os.path.isfile(potential_path) and file_ext in ALLOWED_IMAGE_EXTENSIONS:
                            print(f"找到部分匹配的文件: {file} (搜索: {filename})")
                            return send_file(potential_path)
        
        # 如果还是找不到，返回404
        print(f"文件不存在: {filename}, 搜索路径: {filepath}")
        print(f"UPLOAD_FOLDER 内容: {os.listdir(UPLOAD_FOLDER) if os.path.exists(UPLOAD_FOLDER) else '不存在'}")
        return jsonify({'error': f'文件不存在: {filename}'}), 404
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/upload-csv-text', methods=['POST'])
def upload_csv_text():
    """上传CSV文件，返回列信息供用户选择匹配列"""
    try:
        if 'csv' not in request.files:
            return jsonify({'error': '请上传CSV文件'}), 400
        
        csv_file = request.files['csv']
        if csv_file.filename == '':
            return jsonify({'error': 'CSV文件为空'}), 400
        
        # 保存CSV文件
        csv_filename = f"{uuid.uuid4()}.csv"
        csv_filepath = os.path.join(UPLOAD_FOLDER, csv_filename)
        csv_file.save(csv_filepath)
        
        # 读取CSV
        try:
            df = pd.read_csv(csv_filepath, encoding='utf-8')
            df.columns = df.columns.str.strip()
        except:
            # 尝试其他编码
            df = pd.read_csv(csv_filepath, encoding='gbk')
            df.columns = df.columns.str.strip()
        
        # 返回所有列名和完整的CSV数据
        all_columns = df.columns.tolist()
        
        if len(all_columns) == 0:
            return jsonify({'error': 'CSV文件没有列'}), 400
        
        # 将DataFrame转换为字典列表，保存所有数据
        csv_data_list = []
        for index, row in df.iterrows():
            row_data = {}
            for col in all_columns:
                row_data[col] = str(row[col]).strip() if pd.notna(row[col]) else ''
            csv_data_list.append(row_data)
        
        return jsonify({
            'success': True,
            'csv_filename': csv_filename,
            'columns': all_columns,  # 返回所有列名
            'csv_data': csv_data_list,  # 返回完整的CSV数据
            'total_rows': len(csv_data_list)
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'处理CSV文件时出错: {str(e)}'}), 500

@app.route('/api/upload-images-text', methods=['POST'])
def upload_images_text():
    """上传图片文件，使用已上传的CSV文件和用户选择的匹配列进行匹配"""
    try:
        # 检查是否有图片文件
        if 'images' not in request.files:
            return jsonify({'error': '请上传图片文件'}), 400
        
        # 获取CSV文件名和匹配列
        csv_filename = request.form.get('csv_filename', '')
        match_column = request.form.get('match_column', '')
        
        if not csv_filename:
            return jsonify({'error': '请先上传CSV文件'}), 400
        
        if not match_column:
            return jsonify({'error': '请选择用于匹配图片文件名的列'}), 400
        
        images_files = request.files.getlist('images')
        if len(images_files) == 0:
            return jsonify({'error': '请至少上传一张图片'}), 400
        
        # 读取CSV文件
        csv_filepath = os.path.join(UPLOAD_FOLDER, csv_filename)
        if not os.path.exists(csv_filepath):
            return jsonify({'error': 'CSV文件不存在，请重新上传'}), 400
        
        try:
            df = pd.read_csv(csv_filepath, encoding='utf-8')
            df.columns = df.columns.str.strip()
        except:
            # 尝试其他编码
            df = pd.read_csv(csv_filepath, encoding='gbk')
            df.columns = df.columns.str.strip()
        
        # 验证匹配列是否存在
        if match_column not in df.columns:
            return jsonify({'error': f'匹配列"{match_column}"不存在于CSV文件中'}), 400
        
        # 识别其他列（用于文字内容）
        title_column = None
        duration_column = None
        episodes_column = None
        
        for col in df.columns:
            col_lower = col.lower()
            if '名称' in col or 'title' in col_lower or 'name' in col_lower or '书名' in col:
                title_column = col
            elif '时长' in col or 'duration' in col_lower or 'min' in col_lower:
                duration_column = col
            elif '集' in col or 'episode' in col_lower or '浓缩' in col:
                episodes_column = col
        
        # 保存图片并建立映射
        image_data_map = {}  # {album_id: {filename, title, subtitle, ...}}
        saved_images = []
        
        for img_file in images_files:
            if img_file.filename == '':
                continue
            
            # 获取文件名（不含扩展名）作为匹配值
            filename_without_ext = os.path.splitext(img_file.filename)[0]
            album_id = filename_without_ext
            
            # 保存图片
            file_ext = img_file.filename.rsplit('.', 1)[1].lower() if '.' in img_file.filename else 'jpg'
            if file_ext not in ALLOWED_IMAGE_EXTENSIONS:
                continue
            
            saved_filename = f"{uuid.uuid4()}.{file_ext}"
            saved_filepath = os.path.join(UPLOAD_FOLDER, saved_filename)
            img_file.save(saved_filepath)
            
            # 从CSV中查找对应的数据（使用用户选择的匹配列）
            csv_row = None
            for idx, row in df.iterrows():
                csv_match_value = str(row[match_column]).strip()
                if csv_match_value == album_id or csv_match_value == filename_without_ext:
                    csv_row = row
                    break
            
            # 如果没找到，尝试使用文件名中的数字部分
            if csv_row is None:
                import re
                numbers = re.findall(r'\d+', filename_without_ext)
                if numbers:
                    for idx, row in df.iterrows():
                        csv_match_value = str(row[match_column]).strip()
                        if csv_match_value in numbers or any(num in csv_match_value for num in numbers):
                            csv_row = row
                            break
            
            # 提取文字信息
            title = ''
            subtitle = ''
            csv_data = {}  # 保存CSV行数据，供前端使用
            if csv_row is not None:
                # 保存所有CSV列的数据
                for col in df.columns:
                    csv_data[col] = str(csv_row[col]).strip() if pd.notna(csv_row[col]) else ''
                
                if title_column:
                    title = str(csv_row[title_column]).strip()
                if duration_column and episodes_column:
                    duration = str(csv_row[duration_column]).strip()
                    episodes = str(csv_row[episodes_column]).strip()
                    subtitle = f"{duration}分钟听{episodes}集"
            
            image_data = {
                'id': len(saved_images),
                'album_id': album_id,
                'filename': saved_filename,
                'original_filename': img_file.filename,
                'title': title,
                'subtitle': subtitle,
                'filepath': saved_filepath,
                'csv_data': csv_data  # 添加CSV行数据
            }
            
            image_data_map[album_id] = image_data
            saved_images.append(image_data)
        
        if len(saved_images) == 0:
            return jsonify({'error': '没有成功上传的图片'}), 400
        
        # 返回CSV的所有列名，供前端使用
        csv_columns = df.columns.tolist()
        
        return jsonify({
            'success': True,
            'csv_filename': csv_filename,
            'images': saved_images,
            'total': len(saved_images),
            'csv_columns': csv_columns  # 返回CSV的所有列名
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'上传失败: {str(e)}'}), 500

@app.route('/api/preview-text-sample', methods=['POST'])
def preview_text_sample():
    """预览示例图片加字效果"""
    try:
        data = request.json
        filename = data.get('filename')  # 使用filename而不是image_id
        title_text = data.get('title_text', '')
        subtitle_text = data.get('subtitle_text', '')
        title_config = data.get('title_config', {})
        subtitle_config = data.get('subtitle_config', {})
        
        if not filename:
            return jsonify({'error': '缺少文件名'}), 400
        
        # 默认配置
        title_font_size = title_config.get('font_size', 60)
        title_color = title_config.get('color', '#FFFF00')  # 黄色
        title_stroke_width = title_config.get('stroke_width', 3)
        title_stroke_color = title_config.get('stroke_color', '#000000')  # 黑色
        title_x = title_config.get('x', 50)
        title_y = title_config.get('y', 50)
        
        subtitle_font_size = subtitle_config.get('font_size', 40)
        subtitle_color = subtitle_config.get('color', '#FFFFFF')  # 白色
        subtitle_stroke_width = subtitle_config.get('stroke_width', 3)
        subtitle_stroke_color = subtitle_config.get('stroke_color', '#000000')  # 黑色
        subtitle_x = subtitle_config.get('x', 50)
        subtitle_y = subtitle_config.get('y', 150)
        
        # 根据filename找到图片文件
        image_path = os.path.join(UPLOAD_FOLDER, filename)
        if not os.path.exists(image_path):
            return jsonify({'error': '找不到图片文件'}), 404
        
        # 打开图片
        img = Image.open(image_path)
        # 转换为RGB模式
        if img.mode != 'RGB':
            img = img.convert('RGB')
        
        # 创建绘图对象
        draw = ImageDraw.Draw(img)
        
        # 尝试加载字体（使用默认字体）
        try:
            # Windows系统字体
            title_font = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", title_font_size)
            subtitle_font = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", subtitle_font_size)
        except:
            try:
                # 尝试其他字体
                title_font = ImageFont.truetype("C:/Windows/Fonts/simhei.ttf", title_font_size)
                subtitle_font = ImageFont.truetype("C:/Windows/Fonts/simhei.ttf", subtitle_font_size)
            except:
                # 使用默认字体
                title_font = ImageFont.load_default()
                subtitle_font = ImageFont.load_default()
        
        # 转换颜色
        def hex_to_rgb(hex_color):
            hex_color = hex_color.lstrip('#')
            return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
        
        title_rgb = hex_to_rgb(title_color)
        title_stroke_rgb = hex_to_rgb(title_stroke_color)
        subtitle_rgb = hex_to_rgb(subtitle_color)
        subtitle_stroke_rgb = hex_to_rgb(subtitle_stroke_color)
        
        # 绘制主标题（支持多行）
        title_lines = title_text.split('\n')
        current_y = title_y
        for line in title_lines:
            if line.strip():
                # 绘制描边（通过多次绘制实现）
                for adj in range(-title_stroke_width, title_stroke_width + 1):
                    for adj2 in range(-title_stroke_width, title_stroke_width + 1):
                        if adj != 0 or adj2 != 0:
                            draw.text((title_x + adj, current_y + adj2), line, 
                                     font=title_font, fill=title_stroke_rgb)
                # 绘制文字
                draw.text((title_x, current_y), line, font=title_font, fill=title_rgb)
                # 计算下一行位置（简单估算）
                current_y += int(title_font_size * 1.2)
        
        # 绘制副标题（支持多行）
        subtitle_lines = subtitle_text.split('\n')
        current_y = subtitle_y
        for line in subtitle_lines:
            if line.strip():
                # 绘制描边
                for adj in range(-subtitle_stroke_width, subtitle_stroke_width + 1):
                    for adj2 in range(-subtitle_stroke_width, subtitle_stroke_width + 1):
                        if adj != 0 or adj2 != 0:
                            draw.text((subtitle_x + adj, current_y + adj2), line, 
                                     font=subtitle_font, fill=subtitle_stroke_rgb)
                # 绘制文字
                draw.text((subtitle_x, current_y), line, font=subtitle_font, fill=subtitle_rgb)
                current_y += int(subtitle_font_size * 1.2)
        
        # 转换为base64返回（不需要保存文件）
        img_buffer = BytesIO()
        img.save(img_buffer, format='JPEG', quality=95)
        img_base64 = base64.b64encode(img_buffer.getvalue()).decode('utf-8')
        
        return jsonify({
            'success': True,
            'preview_image': f'data:image/jpeg;base64,{img_base64}'
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'预览失败: {str(e)}'}), 500

def parse_text_template(template, csv_data):
    """解析文字模板，替换【字段名】为CSV中的实际值"""
    if not template or not csv_data:
        return template or ''
    
    import re
    result = template
    # 匹配【字段名】格式
    pattern = r'【([^】]+)】'
    def replace_field(match):
        field_name = match.group(1)
        value = csv_data.get(field_name, '')
        return str(value) if value is not None else match.group(0)
    
    result = re.sub(pattern, replace_field, result)
    return result

@app.route('/api/apply-text-all', methods=['POST'])
def apply_text_all():
    """批量应用文字到所有图片"""
    try:
        data = request.json
        images = data.get('images', [])  # 图片列表
        text_fields = data.get('text_fields', [])  # 新的动态文字字段格式
        title_config = data.get('title_config', {})  # 旧格式（向后兼容）
        subtitle_config = data.get('subtitle_config', {})  # 旧格式（向后兼容）
        preview_size = data.get('preview_size', {})
        
        if len(images) == 0:
            return jsonify({'error': '没有图片需要处理'}), 400
        
        # 获取预览图片尺寸（用于缩放计算）
        preview_natural_width = preview_size.get('natural_width', 0)
        preview_natural_height = preview_size.get('natural_height', 0)
        preview_display_width = preview_size.get('display_width', 0)
        preview_display_height = preview_size.get('display_height', 0)
        
        # 如果预览尺寸无效，使用默认值（假设预览和实际尺寸相同）
        if preview_natural_width == 0 or preview_natural_height == 0:
            preview_natural_width = preview_display_width if preview_display_width > 0 else 1920
            preview_natural_height = preview_display_height if preview_display_height > 0 else 1080
        
        # 处理文字字段配置（新格式）
        text_field_configs = []
        if text_fields and len(text_fields) > 0:
            # 使用新的动态文字字段格式
            for field_config in text_fields:
                # 支持colors数组，如果只有color则转换为数组
                colors = field_config.get('colors', [])
                if not colors and field_config.get('color'):
                    colors = [field_config.get('color')]
                if not colors:
                    colors = ['#FFFF00']  # 默认颜色
                
                text_field_configs.append({
                    'field_id': field_config.get('field_id'),
                    'field_name': field_config.get('field_name'),
                    'template': field_config.get('template', ''),
                    'font_size': field_config.get('font_size', 60),
                    'colors': colors,  # 颜色数组
                    'color': colors[0] if colors else '#FFFF00',  # 向后兼容，使用第一个颜色
                    'stroke_width': field_config.get('stroke_width', 3),
                    'stroke_color': field_config.get('stroke_color', '#000000'),
                    'line_height': field_config.get('line_height', 1.2),
                    'center_x': field_config.get('center_x'),  # 优先使用中心坐标
                    'center_y': field_config.get('center_y'),
                    'width': field_config.get('width'),
                    'height': field_config.get('height'),
                    'x': field_config.get('x', 50),  # 备用左上角坐标
                    'y': field_config.get('y', 50)
                })
        else:
            # 向后兼容：使用旧的 title_config 和 subtitle_config
            # 主标题（第一个字段）
            text_field_configs.append({
                'field_id': 'title',
                'field_name': '主标题',
                'template': '',  # 旧格式没有模板，使用 title 字段
                'font_size': title_config.get('font_size', 60),
                'color': title_config.get('color', '#FFFF00'),
                'stroke_width': title_config.get('stroke_width', 3),
                'stroke_color': title_config.get('stroke_color', '#000000'),
                'line_height': 1.2,
                'center_x': title_config.get('center_x'),
                'center_y': title_config.get('center_y'),
                'width': title_config.get('width'),
                'height': title_config.get('height'),
                'x': title_config.get('x', 50),
                'y': title_config.get('y', 50)
            })
            # 副标题（第二个字段）
            text_field_configs.append({
                'field_id': 'subtitle',
                'field_name': '副标题',
                'template': '',  # 旧格式没有模板，使用 subtitle 字段
                'font_size': subtitle_config.get('font_size', 40),
                'color': subtitle_config.get('color', '#FFFFFF'),
                'stroke_width': subtitle_config.get('stroke_width', 3),
                'stroke_color': subtitle_config.get('stroke_color', '#000000'),
                'line_height': 1.2,
                'center_x': subtitle_config.get('center_x'),
                'center_y': subtitle_config.get('center_y'),
                'width': subtitle_config.get('width'),
                'height': subtitle_config.get('height'),
                'x': subtitle_config.get('x', 50),
                'y': subtitle_config.get('y', 150)
            })
        
        # 为了向后兼容，保留旧的变量名（使用第一个和第二个字段）
        if len(text_field_configs) > 0:
            title_field = text_field_configs[0]
            title_font_size_base = title_field['font_size']
            title_colors = title_field.get('colors', [title_field.get('color', '#FFFF00')])  # 获取颜色数组
            title_color = title_colors[0] if title_colors else '#FFFF00'  # 默认使用第一个颜色
            title_stroke_width_base = title_field['stroke_width']
            title_stroke_color = title_field['stroke_color']
            title_center_x_base = title_field.get('center_x')
            title_center_y_base = title_field.get('center_y')
            title_width_base = title_field.get('width')
            title_height_base = title_field.get('height')
            title_x_base = title_field.get('x', 50)
            title_y_base = title_field.get('y', 50)
        else:
            title_font_size_base = 60
            title_colors = ['#FFFF00']
            title_color = '#FFFF00'
            title_stroke_width_base = 3
            title_stroke_color = '#000000'
            title_center_x_base = None
            title_center_y_base = None
            title_width_base = None
            title_height_base = None
            title_x_base = 50
            title_y_base = 50
        
        if len(text_field_configs) > 1:
            subtitle_field = text_field_configs[1]
            subtitle_font_size_base = subtitle_field['font_size']
            subtitle_colors = subtitle_field.get('colors', [subtitle_field.get('color', '#FFFFFF')])  # 获取颜色数组
            subtitle_color = subtitle_colors[0] if subtitle_colors else '#FFFFFF'  # 默认使用第一个颜色
            subtitle_stroke_width_base = subtitle_field['stroke_width']
            subtitle_stroke_color = subtitle_field['stroke_color']
            subtitle_center_x_base = subtitle_field.get('center_x')
            subtitle_center_y_base = subtitle_field.get('center_y')
            subtitle_width_base = subtitle_field.get('width')
            subtitle_height_base = subtitle_field.get('height')
            subtitle_x_base = subtitle_field.get('x', 50)
            subtitle_y_base = subtitle_field.get('y', 150)
        else:
            subtitle_font_size_base = 40
            subtitle_colors = ['#FFFFFF']
            subtitle_color = '#FFFFFF'
            subtitle_stroke_width_base = 3
            subtitle_stroke_color = '#000000'
            subtitle_center_x_base = None
            subtitle_center_y_base = None
            subtitle_width_base = None
            subtitle_height_base = None
            subtitle_x_base = 50
            subtitle_y_base = 150
        
        # 转换颜色函数
        def hex_to_rgb(hex_color):
            hex_color = hex_color.lstrip('#')
            return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
        
        # 导入random用于随机选择颜色
        import random
        
        processed_images = []
        os.makedirs(TEXT_OVERLAY_FOLDER, exist_ok=True)
        
        for img_data in images:
            try:
                filepath = img_data.get('filepath')
                if not filepath or not os.path.exists(filepath):
                    continue
                
                # 打开图片
                img = Image.open(filepath)
                if img.mode != 'RGB':
                    img = img.convert('RGB')
                
                # 获取实际图片尺寸
                actual_width, actual_height = img.size
                
                # 计算缩放比例（从预览显示尺寸到实际图片尺寸）
                scale_x = actual_width / preview_display_width if preview_display_width > 0 else 1.0
                scale_y = actual_height / preview_display_height if preview_display_height > 0 else 1.0
                # 使用统一的缩放比例（保持宽高比）
                scale = min(scale_x, scale_y) if preview_display_width > 0 and preview_display_height > 0 else 1.0
                
                # 根据实际图片尺寸缩放配置
                title_font_size = int(title_font_size_base * scale)
                title_stroke_width = max(1, int(title_stroke_width_base * scale))
                subtitle_font_size = int(subtitle_font_size_base * scale)
                subtitle_stroke_width = max(1, int(subtitle_stroke_width_base * scale))
                
                # 重新加载字体（使用缩放后的字号）
                try:
                    title_font = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", title_font_size)
                    subtitle_font = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", subtitle_font_size)
                except:
                    try:
                        title_font = ImageFont.truetype("C:/Windows/Fonts/simhei.ttf", title_font_size)
                        subtitle_font = ImageFont.truetype("C:/Windows/Fonts/simhei.ttf", subtitle_font_size)
                    except:
                        title_font = ImageFont.load_default()
                        subtitle_font = ImageFont.load_default()
                
                draw = ImageDraw.Draw(img)
                
                # 解析文字内容（支持模板和CSV数据）
                csv_data = img_data.get('csv_data', {})
                
                # 获取文字内容（优先使用模板解析，否则使用直接提供的文字）
                title_text = ''
                subtitle_text = ''
                
                if len(text_field_configs) > 0:
                    # 使用新的动态文字字段格式
                    title_field = text_field_configs[0]
                    if title_field.get('template'):
                        # 解析模板
                        title_text = parse_text_template(title_field['template'], csv_data)
                    else:
                        # 向后兼容：使用直接提供的文字
                        title_text = img_data.get('title', '')
                
                # 只处理实际配置的字段（有模板的字段）
                if len(text_field_configs) > 1:
                    subtitle_field = text_field_configs[1]
                    if subtitle_field.get('template') and subtitle_field.get('template').strip():
                        # 解析模板
                        subtitle_text = parse_text_template(subtitle_field['template'], csv_data)
                    else:
                        # 如果第二个字段没有模板，不绘制副标题
                        subtitle_text = ''
                else:
                    # 如果只有一个字段，不绘制副标题
                    subtitle_text = ''
                
                # 为每张图片随机选择颜色（如果有多个颜色）
                current_title_color = random.choice(title_colors) if len(title_colors) > 1 else title_colors[0]
                current_subtitle_color = random.choice(subtitle_colors) if len(subtitle_colors) > 1 else subtitle_colors[0]
                
                title_rgb = hex_to_rgb(current_title_color)
                title_stroke_rgb = hex_to_rgb(title_stroke_color)
                subtitle_rgb = hex_to_rgb(current_subtitle_color)
                subtitle_stroke_rgb = hex_to_rgb(subtitle_stroke_color)
                
                # 绘制主标题
                if title_text:
                    # 如果有中心坐标，使用中心坐标计算左上角坐标
                    if title_center_x_base is not None and title_center_y_base is not None:
                        # 缩放中心坐标
                        title_center_x = int(title_center_x_base * scale_x)
                        title_center_y = int(title_center_y_base * scale_y)
                        
                        # 测量文字尺寸（使用缩放后的字号）
                        title_lines = title_text.split('\n')
                        if title_lines:
                            # 测量第一行文字尺寸（因为 nowrap，通常只有一行）
                            first_line = title_lines[0].strip() if title_lines[0].strip() else title_text
                            bbox = draw.textbbox((0, 0), first_line, font=title_font)
                            text_width = bbox[2] - bbox[0]
                            text_height = bbox[3] - bbox[1]
                            
                            # 如果有多行，计算总高度
                            if len(title_lines) > 1:
                                line_height = int(title_font_size * 1.2)
                                text_height = line_height * len([l for l in title_lines if l.strip()])
                            
                            # 从中心坐标计算左上角坐标
                            title_x = title_center_x - text_width // 2
                            title_y = title_center_y - text_height // 2
                        else:
                            title_x = int(title_x_base * scale_x)
                            title_y = int(title_y_base * scale_y)
                    else:
                        # 没有中心坐标，使用左上角坐标
                        title_x = int(title_x_base * scale_x)
                        title_y = int(title_y_base * scale_y)
                    
                    title_lines = title_text.split('\n')
                    current_y = title_y
                    for line in title_lines:
                        if line.strip():
                            # 计算该行的居中位置
                            if title_center_x_base is not None and title_center_y_base is not None:
                                # 如果有中心坐标，每行单独计算居中位置
                                line_bbox = draw.textbbox((0, 0), line, font=title_font)
                                line_width = line_bbox[2] - line_bbox[0]
                                line_x = title_center_x - line_width // 2
                            else:
                                # 如果没有中心坐标，也计算每行的居中位置（基于整体宽度）
                                line_bbox = draw.textbbox((0, 0), line, font=title_font)
                                line_width = line_bbox[2] - line_bbox[0]
                                # 找到最宽的行作为参考
                                max_line_width = max([draw.textbbox((0, 0), l.strip(), font=title_font)[2] - draw.textbbox((0, 0), l.strip(), font=title_font)[0] 
                                                     for l in title_lines if l.strip()], default=line_width)
                                line_x = title_x + (max_line_width - line_width) // 2
                            
                            # 描边
                            for adj in range(-title_stroke_width, title_stroke_width + 1):
                                for adj2 in range(-title_stroke_width, title_stroke_width + 1):
                                    if adj != 0 or adj2 != 0:
                                        draw.text((line_x + adj, current_y + adj2), line, 
                                                 font=title_font, fill=title_stroke_rgb)
                            # 文字
                            draw.text((line_x, current_y), line, font=title_font, fill=title_rgb)
                            current_y += int(title_font_size * 1.2)
                
                # 绘制副标题
                if subtitle_text:
                    # 如果有中心坐标，使用中心坐标计算左上角坐标
                    if subtitle_center_x_base is not None and subtitle_center_y_base is not None:
                        # 缩放中心坐标
                        subtitle_center_x = int(subtitle_center_x_base * scale_x)
                        subtitle_center_y = int(subtitle_center_y_base * scale_y)
                        
                        # 测量文字尺寸（使用缩放后的字号）
                        subtitle_lines = subtitle_text.split('\n')
                        if subtitle_lines:
                            # 测量第一行文字尺寸（因为 nowrap，通常只有一行）
                            first_line = subtitle_lines[0].strip() if subtitle_lines[0].strip() else subtitle_text
                            bbox = draw.textbbox((0, 0), first_line, font=subtitle_font)
                            text_width = bbox[2] - bbox[0]
                            text_height = bbox[3] - bbox[1]
                            
                            # 如果有多行，计算总高度
                            if len(subtitle_lines) > 1:
                                line_height = int(subtitle_font_size * 1.2)
                                text_height = line_height * len([l for l in subtitle_lines if l.strip()])
                            
                            # 从中心坐标计算左上角坐标
                            subtitle_x = subtitle_center_x - text_width // 2
                            subtitle_y = subtitle_center_y - text_height // 2
                        else:
                            subtitle_x = int(subtitle_x_base * scale_x)
                            subtitle_y = int(subtitle_y_base * scale_y)
                    else:
                        # 没有中心坐标，使用左上角坐标
                        subtitle_x = int(subtitle_x_base * scale_x)
                        subtitle_y = int(subtitle_y_base * scale_y)
                    
                    subtitle_lines = subtitle_text.split('\n')
                    current_y = subtitle_y
                    for line in subtitle_lines:
                        if line.strip():
                            # 计算该行的居中位置
                            if subtitle_center_x_base is not None and subtitle_center_y_base is not None:
                                # 如果有中心坐标，每行单独计算居中位置
                                line_bbox = draw.textbbox((0, 0), line, font=subtitle_font)
                                line_width = line_bbox[2] - line_bbox[0]
                                line_x = subtitle_center_x - line_width // 2
                            else:
                                # 如果没有中心坐标，也计算每行的居中位置（基于整体宽度）
                                line_bbox = draw.textbbox((0, 0), line, font=subtitle_font)
                                line_width = line_bbox[2] - line_bbox[0]
                                # 找到最宽的行作为参考
                                max_line_width = max([draw.textbbox((0, 0), l.strip(), font=subtitle_font)[2] - draw.textbbox((0, 0), l.strip(), font=subtitle_font)[0] 
                                                     for l in subtitle_lines if l.strip()], default=line_width)
                                line_x = subtitle_x + (max_line_width - line_width) // 2
                            
                            # 描边
                            for adj in range(-subtitle_stroke_width, subtitle_stroke_width + 1):
                                for adj2 in range(-subtitle_stroke_width, subtitle_stroke_width + 1):
                                    if adj != 0 or adj2 != 0:
                                        draw.text((line_x + adj, current_y + adj2), line, 
                                                 font=subtitle_font, fill=subtitle_stroke_rgb)
                            # 文字
                            draw.text((line_x, current_y), line, font=subtitle_font, fill=subtitle_rgb)
                            current_y += int(subtitle_font_size * 1.2)
                
                # 保存处理后的图片
                album_id = img_data.get('album_id', str(uuid.uuid4()))
                processed_filename = f"text_{album_id}.jpg"
                processed_path = os.path.join(TEXT_OVERLAY_FOLDER, processed_filename)
                img.save(processed_path, quality=95)
                
                # 保存每张图片实际使用的随机颜色
                applied_colors = {}
                if len(text_field_configs) > 0:
                    applied_colors[text_field_configs[0].get('field_id', 'field_0')] = current_title_color
                if len(text_field_configs) > 1:
                    applied_colors[text_field_configs[1].get('field_id', 'field_1')] = current_subtitle_color
                
                processed_images.append({
                    'id': img_data.get('id'),
                    'album_id': album_id,
                    'filename': processed_filename,
                    'original_filename': img_data.get('original_filename', ''),
                    'original_filepath': filepath,  # 保存原始图片路径
                    'title': title_text,
                    'subtitle': subtitle_text,
                    'applied_colors': applied_colors  # 保存每张图片实际使用的随机颜色
                })
                
            except Exception as e:
                print(f"处理图片 {img_data.get('album_id')} 时出错: {str(e)}")
                continue
        
        return jsonify({
            'success': True,
            'processed': len(processed_images),
            'images': processed_images
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'批量处理失败: {str(e)}'}), 500

@app.route('/api/list-text-images', methods=['GET'])
def list_text_images():
    """列出所有处理后的图片"""
    try:
        images = []
        if os.path.exists(TEXT_OVERLAY_FOLDER):
            for filename in os.listdir(TEXT_OVERLAY_FOLDER):
                if filename.startswith('text_') and filename.lower().endswith(('.jpg', '.jpeg', '.png')):
                    filepath = os.path.join(TEXT_OVERLAY_FOLDER, filename)
                    file_size = os.path.getsize(filepath)
                    mtime = os.path.getmtime(filepath)
                    
                    # 从文件名提取album_id
                    album_id = filename.replace('text_', '').rsplit('.', 1)[0]
                    
                    images.append({
                        'filename': filename,
                        'album_id': album_id,
                        'size': file_size,
                        'modified': mtime
                    })
        
        # 按修改时间排序
        images.sort(key=lambda x: x['modified'], reverse=True)
        
        return jsonify({
            'success': True,
            'images': images,
            'total': len(images)
        })
        
    except Exception as e:
        return jsonify({'error': f'获取列表失败: {str(e)}'}), 500

@app.route('/api/download-text-image/<filename>', methods=['GET'])
def download_text_image(filename):
    """下载单张处理后的图片（用于预览和编辑）"""
    try:
        filepath = os.path.join(TEXT_OVERLAY_FOLDER, filename)
        if not os.path.exists(filepath):
            return jsonify({'error': '文件不存在'}), 404
        response = send_file(filepath)
        # 禁用缓存，确保总是获取最新图片
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response
    except Exception as e:
        return jsonify({'error': f'下载失败: {str(e)}'}), 500

@app.route('/api/download-all-text', methods=['GET'])
def download_all_text():
    """批量下载所有处理后的图片"""
    try:
        zip_buffer = BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            if os.path.exists(TEXT_OVERLAY_FOLDER):
                for filename in os.listdir(TEXT_OVERLAY_FOLDER):
                    if filename.startswith('text_') and filename.lower().endswith(('.jpg', '.jpeg', '.png')):
                        filepath = os.path.join(TEXT_OVERLAY_FOLDER, filename)
                        # 使用album_id作为ZIP内的文件名
                        album_id = filename.replace('text_', '').rsplit('.', 1)[0]
                        zip_file.write(filepath, f"{album_id}.jpg")
        
        zip_buffer.seek(0)
        return send_file(zip_buffer, mimetype='application/zip', 
                        as_attachment=True, download_name='text_overlay_images.zip')
        
    except Exception as e:
        return jsonify({'error': f'打包失败: {str(e)}'}), 500

@app.route('/api/edit-text-single', methods=['POST'])
def edit_text_single():
    """编辑单张图片的文字"""
    try:
        data = request.json
        filename = data.get('filename')  # 处理后的文件名
        original_filepath = data.get('original_filepath')  # 原始图片路径
        title_text = data.get('title_text', '')
        subtitle_text = data.get('subtitle_text', '')
        title_config = data.get('title_config', {})
        subtitle_config = data.get('subtitle_config', {})
        preview_size = data.get('preview_size', {})
        
        if not filename:
            return jsonify({'error': '缺少文件名'}), 400
        
        # 如果没有提供原始路径，尝试从处理后的文件名推断
        if not original_filepath:
            # 从filename提取album_id，然后查找原始文件
            album_id = filename.replace('text_', '').rsplit('.', 1)[0]
            # 在uploads文件夹中查找匹配的文件
            if os.path.exists(UPLOAD_FOLDER):
                for file in os.listdir(UPLOAD_FOLDER):
                    if album_id in file or file.startswith(album_id):
                        original_filepath = os.path.join(UPLOAD_FOLDER, file)
                        break
        
        # 如果还是没有找到，尝试使用已处理的文件作为原始文件（重新处理）
        # 注意：如果使用已处理的文件，需要先清除已处理的文件上的文字，或者从原始文件开始
        if not original_filepath or not os.path.exists(original_filepath):
            # 尝试从已处理的文件开始（如果原始文件不存在，就重新处理已处理的文件）
            processed_path = os.path.join(TEXT_OVERLAY_FOLDER, filename)
            if os.path.exists(processed_path):
                # 如果原始文件不存在，使用已处理的文件
                # 但这样会导致文字叠加，所以最好还是找到原始文件
                original_filepath = processed_path
                print(f'警告：使用已处理的文件作为原始文件: {original_filepath}')
            else:
                return jsonify({'error': f'找不到原始图片文件。filename: {filename}, original_filepath: {original_filepath}'}), 404
        
        print(f'编辑单张图片: filename={filename}, original_filepath={original_filepath}')
        print(f'title_text={title_text}, subtitle_text={subtitle_text}')
        print(f'title_config keys: {title_config.keys()}, center_x={title_config.get("center_x")}, center_y={title_config.get("center_y")}')
        print(f'subtitle_config keys: {subtitle_config.keys()}, center_x={subtitle_config.get("center_x")}, center_y={subtitle_config.get("center_y")}')
        
        # 获取预览图片尺寸（用于缩放计算）
        preview_natural_width = preview_size.get('natural_width', 0)
        preview_natural_height = preview_size.get('natural_height', 0)
        preview_display_width = preview_size.get('display_width', 0)
        preview_display_height = preview_size.get('display_height', 0)
        
        # 如果预览尺寸无效，使用默认值（假设预览和实际尺寸相同）
        if preview_natural_width == 0 or preview_natural_height == 0:
            preview_natural_width = preview_display_width if preview_display_width > 0 else 1920
            preview_natural_height = preview_display_height if preview_display_height > 0 else 1080
        
        # 默认配置（这些是基于预览显示尺寸的）
        title_font_size_base = title_config.get('font_size', 60)
        title_color = title_config.get('color', '#FFFF00')
        title_stroke_width_base = title_config.get('stroke_width', 3)
        title_stroke_color = title_config.get('stroke_color', '#000000')
        # 优先使用中心坐标，如果没有则使用左上角坐标
        title_center_x_base = title_config.get('center_x')
        title_center_y_base = title_config.get('center_y')
        title_width_base = title_config.get('width')
        title_height_base = title_config.get('height')
        title_x_base = title_config.get('x', 50)
        title_y_base = title_config.get('y', 50)
        
        subtitle_font_size_base = subtitle_config.get('font_size', 40)
        subtitle_color = subtitle_config.get('color', '#FFFFFF')
        subtitle_stroke_width_base = subtitle_config.get('stroke_width', 3)
        subtitle_stroke_color = subtitle_config.get('stroke_color', '#000000')
        # 优先使用中心坐标，如果没有则使用左上角坐标
        subtitle_center_x_base = subtitle_config.get('center_x')
        subtitle_center_y_base = subtitle_config.get('center_y')
        subtitle_width_base = subtitle_config.get('width')
        subtitle_height_base = subtitle_config.get('height')
        subtitle_x_base = subtitle_config.get('x', 50)
        subtitle_y_base = subtitle_config.get('y', 150)
        
        def hex_to_rgb(hex_color):
            hex_color = hex_color.lstrip('#')
            return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
        
        title_rgb = hex_to_rgb(title_color)
        title_stroke_rgb = hex_to_rgb(title_stroke_color)
        subtitle_rgb = hex_to_rgb(subtitle_color)
        subtitle_stroke_rgb = hex_to_rgb(subtitle_stroke_color)
        
        # 打开原始图片并重新处理
        img = Image.open(original_filepath)
        if img.mode != 'RGB':
            img = img.convert('RGB')
        
        # 获取实际图片尺寸
        actual_width, actual_height = img.size
        
        # 计算缩放比例（从预览显示尺寸到实际图片尺寸）
        print(f'预览尺寸: {preview_display_width}x{preview_display_height}, 实际图片尺寸: {actual_width}x{actual_height}')
        scale_x = actual_width / preview_display_width if preview_display_width > 0 else 1.0
        scale_y = actual_height / preview_display_height if preview_display_height > 0 else 1.0
        # 使用统一的缩放比例（保持宽高比）
        scale = min(scale_x, scale_y) if preview_display_width > 0 and preview_display_height > 0 else 1.0
        print(f'缩放比例: scale_x={scale_x}, scale_y={scale_y}, scale={scale}')
        
        # 根据实际图片尺寸缩放配置
        title_font_size = int(title_font_size_base * scale)
        title_stroke_width = max(1, int(title_stroke_width_base * scale))
        subtitle_font_size = int(subtitle_font_size_base * scale)
        subtitle_stroke_width = max(1, int(subtitle_stroke_width_base * scale))
        
        # 重新加载字体（使用缩放后的字号）
        try:
            title_font = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", title_font_size)
            subtitle_font = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", subtitle_font_size)
        except:
            try:
                title_font = ImageFont.truetype("C:/Windows/Fonts/simhei.ttf", title_font_size)
                subtitle_font = ImageFont.truetype("C:/Windows/Fonts/simhei.ttf", subtitle_font_size)
            except:
                title_font = ImageFont.load_default()
                subtitle_font = ImageFont.load_default()
        
        draw = ImageDraw.Draw(img)
        
        # 绘制主标题
        if title_text:
            # 如果有中心坐标，使用中心坐标计算左上角坐标
            if title_center_x_base is not None and title_center_y_base is not None:
                # 缩放中心坐标
                title_center_x = int(title_center_x_base * scale_x)
                title_center_y = int(title_center_y_base * scale_y)
                
                # 测量文字尺寸（使用缩放后的字号）
                title_lines = title_text.split('\n')
                if title_lines:
                    # 测量第一行文字尺寸（因为 nowrap，通常只有一行）
                    first_line = title_lines[0].strip() if title_lines[0].strip() else title_text
                    bbox = draw.textbbox((0, 0), first_line, font=title_font)
                    text_width = bbox[2] - bbox[0]
                    text_height = bbox[3] - bbox[1]
                    
                    # 如果有多行，计算总高度
                    if len(title_lines) > 1:
                        line_height = int(title_font_size * 1.2)
                        text_height = line_height * len([l for l in title_lines if l.strip()])
                    
                    # 从中心坐标计算左上角坐标
                    title_x = title_center_x - text_width // 2
                    title_y = title_center_y - text_height // 2
                else:
                    title_x = int(title_x_base * scale_x)
                    title_y = int(title_y_base * scale_y)
            else:
                # 没有中心坐标，使用左上角坐标
                title_x = int(title_x_base * scale_x)
                title_y = int(title_y_base * scale_y)
            
            title_lines = title_text.split('\n')
            current_y = title_y
            for line in title_lines:
                if line.strip():
                    # 计算该行的居中位置
                    if title_center_x_base is not None and title_center_y_base is not None:
                        # 如果有中心坐标，每行单独计算居中位置
                        line_bbox = draw.textbbox((0, 0), line, font=title_font)
                        line_width = line_bbox[2] - line_bbox[0]
                        line_x = title_center_x - line_width // 2
                    else:
                        # 如果没有中心坐标，也计算每行的居中位置（基于整体宽度）
                        line_bbox = draw.textbbox((0, 0), line, font=title_font)
                        line_width = line_bbox[2] - line_bbox[0]
                        # 找到最宽的行作为参考
                        max_line_width = max([draw.textbbox((0, 0), l.strip(), font=title_font)[2] - draw.textbbox((0, 0), l.strip(), font=title_font)[0] 
                                             for l in title_lines if l.strip()], default=line_width)
                        line_x = title_x + (max_line_width - line_width) // 2
                    
                    # 描边
                    for adj in range(-title_stroke_width, title_stroke_width + 1):
                        for adj2 in range(-title_stroke_width, title_stroke_width + 1):
                            if adj != 0 or adj2 != 0:
                                draw.text((line_x + adj, current_y + adj2), line, 
                                         font=title_font, fill=title_stroke_rgb)
                    # 文字
                    draw.text((line_x, current_y), line, font=title_font, fill=title_rgb)
                    current_y += int(title_font_size * 1.2)
        
        # 绘制副标题
        if subtitle_text:
            # 如果有中心坐标，使用中心坐标计算左上角坐标
            if subtitle_center_x_base is not None and subtitle_center_y_base is not None:
                # 缩放中心坐标
                subtitle_center_x = int(subtitle_center_x_base * scale_x)
                subtitle_center_y = int(subtitle_center_y_base * scale_y)
                
                # 测量文字尺寸（使用缩放后的字号）
                subtitle_lines = subtitle_text.split('\n')
                if subtitle_lines:
                    # 测量第一行文字尺寸（因为 nowrap，通常只有一行）
                    first_line = subtitle_lines[0].strip() if subtitle_lines[0].strip() else subtitle_text
                    bbox = draw.textbbox((0, 0), first_line, font=subtitle_font)
                    text_width = bbox[2] - bbox[0]
                    text_height = bbox[3] - bbox[1]
                    
                    # 如果有多行，计算总高度
                    if len(subtitle_lines) > 1:
                        line_height = int(subtitle_font_size * 1.2)
                        text_height = line_height * len([l for l in subtitle_lines if l.strip()])
                    
                    # 从中心坐标计算左上角坐标
                    subtitle_x = subtitle_center_x - text_width // 2
                    subtitle_y = subtitle_center_y - text_height // 2
                else:
                    subtitle_x = int(subtitle_x_base * scale_x)
                    subtitle_y = int(subtitle_y_base * scale_y)
            else:
                # 没有中心坐标，使用左上角坐标
                subtitle_x = int(subtitle_x_base * scale_x)
                subtitle_y = int(subtitle_y_base * scale_y)
            
            subtitle_lines = subtitle_text.split('\n')
            current_y = subtitle_y
            for line in subtitle_lines:
                if line.strip():
                    # 计算该行的居中位置
                    if subtitle_center_x_base is not None and subtitle_center_y_base is not None:
                        # 如果有中心坐标，每行单独计算居中位置
                        line_bbox = draw.textbbox((0, 0), line, font=subtitle_font)
                        line_width = line_bbox[2] - line_bbox[0]
                        line_x = subtitle_center_x - line_width // 2
                    else:
                        # 如果没有中心坐标，也计算每行的居中位置（基于整体宽度）
                        line_bbox = draw.textbbox((0, 0), line, font=subtitle_font)
                        line_width = line_bbox[2] - line_bbox[0]
                        # 找到最宽的行作为参考
                        max_line_width = max([draw.textbbox((0, 0), l.strip(), font=subtitle_font)[2] - draw.textbbox((0, 0), l.strip(), font=subtitle_font)[0] 
                                             for l in subtitle_lines if l.strip()], default=line_width)
                        line_x = subtitle_x + (max_line_width - line_width) // 2
                    
                    # 描边
                    for adj in range(-subtitle_stroke_width, subtitle_stroke_width + 1):
                        for adj2 in range(-subtitle_stroke_width, subtitle_stroke_width + 1):
                            if adj != 0 or adj2 != 0:
                                draw.text((line_x + adj, current_y + adj2), line, 
                                         font=subtitle_font, fill=subtitle_stroke_rgb)
                    # 文字
                    draw.text((line_x, current_y), line, font=subtitle_font, fill=subtitle_rgb)
                    current_y += int(subtitle_font_size * 1.2)
        
        # 保存覆盖原文件
        processed_path = os.path.join(TEXT_OVERLAY_FOLDER, filename)
        os.makedirs(TEXT_OVERLAY_FOLDER, exist_ok=True)
        img.save(processed_path, quality=95)
        
        file_size = os.path.getsize(processed_path)
        print(f'保存成功: {processed_path}, 文件大小: {file_size} bytes')
        print(f'保存的文字内容: title="{title_text}", subtitle="{subtitle_text}"')
        
        return jsonify({
            'success': True,
            'message': '编辑成功',
            'filename': filename,
            'title': title_text,
            'subtitle': subtitle_text
        })
        
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f'编辑失败错误: {str(e)}')
        print(f'错误堆栈: {error_trace}')
        traceback.print_exc()
        return jsonify({'error': f'编辑失败: {str(e)}'}), 500

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
