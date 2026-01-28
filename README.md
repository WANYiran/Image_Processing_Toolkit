# 🖼️ 图片处理工具 - 整合版

一个功能强大的图片处理工具集，整合了多种常用的图片处理功能，支持批量操作，简单易用。

## ✨ 主要功能

- **批量图片处理**：支持批量上传、处理和下载图片
- **多种处理方式**：裁剪、调整大小、格式转换等
- **智能识别**：自动识别CSV文件中的图片URL和相关信息
- **AI增强**：集成AI智能扩图功能（需配置API Key）
- **交互式操作**：直观的Web界面，拖拽上传，实时预览
- **自动更新**：内置更新检查机制，及时获取最新版本

## 🚀 快速开始

### 方式一：使用打包好的可执行文件（Windows用户推荐）

1. 从 [GitHub Releases](https://github.com/WANYiran/Image_Processing_Toolkit/releases) 下载 `图片处理工具.exe`
2. 双击运行即可
3. 程序会自动打开浏览器，如果没有自动打开，请手动访问 `http://localhost:5000`

### 方式二：从源码运行（macOS/Linux用户推荐，Windows也可用）

#### 1. 克隆仓库
```bash
git clone https://github.com/WANYiran/Image_Processing_Toolkit.git
cd Image_Processing_Toolkit/integrated_image_tool
```

#### 2. 安装依赖
```bash
# Windows
pip install -r requirements.txt

# macOS/Linux
pip3 install -r requirements.txt
```

#### 3. 配置API Key（可选，仅AI功能需要）
**Windows:**
```bash
set DASHSCOPE_API_KEY=your_api_key_here
```

**macOS/Linux:**
```bash
export DASHSCOPE_API_KEY=your_api_key_here
```

#### 4. 运行程序

**Windows:**
```bash
python app.py
# 或双击 run.bat
```

**macOS/Linux:**
```bash
python3 app.py
# 或运行 run.sh
chmod +x run.sh
./run.sh
```

#### 5. 访问应用
打开浏览器访问：`http://localhost:5000`

## 📖 使用说明

1. **选择功能**：在主页点击需要的功能卡片
2. **上传文件**：根据提示上传图片或CSV文件（支持拖拽上传）
3. **设置参数**：根据需要调整处理参数
4. **开始处理**：点击处理按钮，等待完成
5. **下载结果**：处理完成后，可以预览、单个下载或批量下载

## ⚙️ 配置说明

### 更新源配置（可选）

如果需要使用自动更新功能，编辑 `config.py` 文件：

```python
# GitHub Release API URL
GITHUB_RELEASE_API = "https://api.github.com/repos/你的用户名/你的仓库名/releases/latest"
```

## 🔄 更新机制

- 程序启动时自动检查是否有新版本
- 如果有新版本，主页会显示"下载更新"链接
- 点击链接下载新版本，手动替换旧版本即可

**注意：** 不会自动删除旧版本，需要手动替换。

## 📋 系统要求

### 运行可执行文件版本
- **Windows**：Windows 7 或更高版本，无需安装Python
- **macOS/Linux**：需要对应平台的可执行文件（目前主要提供Windows版本）

### 运行源码版本（推荐用于macOS/Linux）
- Python 3.8 或更高版本
- pip 包管理器
- 操作系统：Windows / Linux / macOS 都支持

## ⚠️ 注意事项

- **文件大小限制**：单个文件最大5GB，批量上传总大小最大5GB
- **支持的格式**：PNG、JPG、JPEG、GIF、BMP、WEBP
- **CSV文件**：必须使用UTF-8编码
- **临时文件**：所有处理文件存储在系统临时目录，程序关闭时自动清理
- **网络要求**：部分功能需要网络连接（如下载图片、AI扩图等）
- **AI功能**：需要配置通义千问API Key才能使用

## 🐛 常见问题

### Q: 程序无法启动？
A: 检查是否安装了所有依赖：`pip install -r requirements.txt`，查看控制台错误信息

### Q: AI功能不可用？
A: 检查是否配置了 `DASHSCOPE_API_KEY` 环境变量，确认API Key是否正确，重启程序使环境变量生效

### Q: 如何更新到新版本？
A: 程序会自动检查更新，如果有新版本，点击"下载更新"链接，下载新版本exe并替换旧版本

### Q: 临时文件在哪里？
A: 存储在系统临时目录，程序关闭时自动清理，不会在本地留下处理痕迹

## 🛠️ 技术栈

- **后端**：Flask
- **前端**：HTML + CSS + JavaScript
- **图片处理**：Pillow (PIL)
- **数据处理**：Pandas
- **打包工具**：PyInstaller

## 📁 项目结构

```
integrated_image_tool/
├── app.py                 # Flask后端主文件
├── config.py             # 配置文件
├── requirements.txt      # Python依赖包
├── templates/            # HTML模板文件夹
├── static/               # 静态文件文件夹（CSS、JS）
└── dist/                 # 打包输出文件夹
```

## 📄 许可证

本项目仅供学习和个人使用。

## 👤 作者

- GitHub: [@WANYiran](https://github.com/WANYiran)
- 项目地址: [Image_Processing_Toolkit](https://github.com/WANYiran/Image_Processing_Toolkit)

---

**⭐ 如果这个项目对你有帮助，请给个Star！**
