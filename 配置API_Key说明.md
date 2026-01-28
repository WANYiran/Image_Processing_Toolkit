# 配置通义千问API Key说明

## 问题
如果使用AI智能扩图功能时出现错误："未配置DASHSCOPE_API_KEY环境变量"，请按照以下步骤配置。

## 配置方法

### Windows系统

**方法1：在命令行中设置（临时，关闭命令行后失效）**
```cmd
set DASHSCOPE_API_KEY=your_api_key_here
python app.py
```

**方法2：在系统环境变量中设置（永久）**
1. 右键点击"此电脑" -> "属性"
2. 点击"高级系统设置"
3. 点击"环境变量"
4. 在"用户变量"或"系统变量"中点击"新建"
5. 变量名：`DASHSCOPE_API_KEY`
6. 变量值：你的API Key
7. 点击"确定"保存
8. 重启应用

**方法3：在PowerShell中设置（当前会话）**
```powershell
$env:DASHSCOPE_API_KEY="your_api_key_here"
python app.py
```

### Linux/Mac系统

**方法1：在终端中设置（临时）**
```bash
export DASHSCOPE_API_KEY=your_api_key_here
python app.py
```

**方法2：添加到 ~/.bashrc 或 ~/.zshrc（永久）**
```bash
# 编辑配置文件
nano ~/.bashrc  # 或 ~/.zshrc

# 添加以下行
export DASHSCOPE_API_KEY=your_api_key_here

# 保存后执行
source ~/.bashrc  # 或 source ~/.zshrc
```

### 使用 .env 文件（推荐）

1. 在项目根目录创建 `.env` 文件
2. 添加以下内容：
```
DASHSCOPE_API_KEY=your_api_key_here
```

3. 安装 python-dotenv（如果还没有）：
```bash
pip install python-dotenv
```

4. 在 app.py 开头添加：
```python
from dotenv import load_dotenv
load_dotenv()
```

## 验证配置

配置完成后，重启应用。启动时应该看到：
```
✅ 通义千问API Key已配置
```

如果看到：
```
⚠️  通义千问API Key未配置，扩图功能将不可用
```
说明配置未生效，请检查：
1. 环境变量名称是否正确（必须是 `DASHSCOPE_API_KEY`）
2. API Key是否正确
3. 是否重启了应用

## 获取API Key

如果您还没有通义千问的API Key，请访问：
- 阿里云DashScope控制台：https://dashscope.console.aliyun.com/
- 注册账号并创建API Key

## 注意事项

1. **安全性**：不要将API Key提交到代码仓库
2. **重启应用**：修改环境变量后必须重启应用才能生效
3. **权限**：确保API Key有调用图像扩展服务的权限
