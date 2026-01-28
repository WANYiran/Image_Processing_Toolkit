// 全局变量
let uploadedFiles = [];
let processedFiles = [];
let processingTasks = new Map(); // 存储任务ID和文件信息的映射
let selectedForRework = new Set(); // 存储选中要重新扩图的文件索引
let fileProcessingStatus = new Map(); // 存储文件处理状态：'idle', 'processing', 'completed', 'reprocessing'
let originalUploadedFiles = []; // 保存原始上传的文件信息，用于重新扩图

// DOM 元素
let uploadArea;
let fileInput;
let fileList;
let expandTopInput;
let expandBottomInput;
let expandLeftInput;
let expandRightInput;
let applyExpandBtn;
let previewGrid;
let downloadAllBtn;
let clearAllBtn;
let uploadBtn;
let progressInfo;
let progressFill;
let progressText;
let reworkSection;
let reworkSelectedBtn;
let clearSelectionBtn;

// 初始化函数
function init() {
    uploadArea = document.getElementById('uploadArea');
    fileInput = document.getElementById('fileInput');
    fileList = document.getElementById('fileList');
    expandTopInput = document.getElementById('expandTop');
    expandBottomInput = document.getElementById('expandBottom');
    expandLeftInput = document.getElementById('expandLeft');
    expandRightInput = document.getElementById('expandRight');
    applyExpandBtn = document.getElementById('applyExpand');
    previewGrid = document.getElementById('previewGrid');
    downloadAllBtn = document.getElementById('downloadAll');
    clearAllBtn = document.getElementById('clearAll');
    uploadBtn = document.getElementById('uploadBtn');
    progressInfo = document.getElementById('progressInfo');
    progressFill = document.getElementById('progressFill');
    progressText = document.getElementById('progressText');
    
    // 重新扩图相关元素
    reworkSection = document.getElementById('reworkSection');
    reworkSelectedBtn = document.getElementById('reworkSelectedBtn');
    clearSelectionBtn = document.getElementById('clearSelectionBtn');
    
    initEventListeners();
    
    // 检查API Key是否配置（通过尝试获取状态来判断）
    checkApiKeyStatus();
}

// 检查API Key配置状态
async function checkApiKeyStatus() {
    try {
        const response = await fetch('/api/check-api-key');
        const data = await response.json();
        
        if (!data.configured) {
            const warningDiv = document.getElementById('apiKeyWarning');
            if (warningDiv) {
                warningDiv.style.display = 'block';
            }
        }
    } catch (error) {
        console.error('检查API Key状态失败:', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

function initEventListeners() {
    if (!fileInput) {
        console.error('fileInput元素未找到');
        return;
    }
    
    if (uploadBtn) {
        uploadBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (fileInput) {
                fileInput.click();
            }
        });
    }
    
    if (uploadArea) {
        uploadArea.addEventListener('click', function(e) {
            if (fileInput) {
                fileInput.click();
            }
        });
    }
    
    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelect);
    }
    
    if (uploadArea) {
        uploadArea.addEventListener('dragover', handleDragOver);
        uploadArea.addEventListener('dragleave', handleDragLeave);
        uploadArea.addEventListener('drop', handleDrop);
    }
    
    if (applyExpandBtn) {
        applyExpandBtn.addEventListener('click', applyExpand);
    }
    
    if (downloadAllBtn) {
        downloadAllBtn.addEventListener('click', downloadAll);
    }
    
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', clearAll);
    }
    
    if (reworkSelectedBtn) {
        reworkSelectedBtn.addEventListener('click', reworkSelected);
    }
    
    if (clearSelectionBtn) {
        clearSelectionBtn.addEventListener('click', clearSelection);
    }
}

function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    uploadFiles(files);
}

function handleDragOver(e) {
    e.preventDefault();
    uploadArea.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
}

function handleDrop(e) {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'));
    if (files.length > 0) {
        uploadFiles(files);
    }
}

async function uploadFiles(files) {
    if (files.length === 0) return;
    
    const formData = new FormData();
    files.forEach(file => {
        formData.append('files', file);
    });
    
    try {
        showLoading('正在上传图片...');
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok && data.files && data.files.length > 0) {
            uploadedFiles = uploadedFiles.concat(data.files);
            // 保存原始上传的文件信息，用于重新扩图
            originalUploadedFiles = originalUploadedFiles.concat(data.files.map(f => ({...f})));
            updateFileList();
            hideLoading();
            showMessage(`成功上传 ${data.files.length} 张图片！`, 'success');
            if (fileInput) {
                fileInput.value = '';
            }
        } else {
            hideLoading();
            showMessage(data.error || '上传失败：没有文件被上传', 'error');
        }
    } catch (error) {
        hideLoading();
        showMessage('上传出错: ' + error.message, 'error');
        console.error('上传错误:', error);
    }
}

function updateFileList() {
    if (!fileList) return;
    
    fileList.innerHTML = '';
    
    if (uploadedFiles.length === 0) {
        fileList.innerHTML = '<p style="color: #9E9E9E; font-weight: 300; font-size: 0.9em;">暂无上传文件</p>';
        return;
    }
    
    uploadedFiles.forEach((file, index) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            <span>${file.original_name}</span>
            <button class="remove-btn" onclick="removeFile(${index})">×</button>
        `;
        fileList.appendChild(fileItem);
    });
}

window.removeFile = function(index) {
    if (index >= 0 && index < uploadedFiles.length) {
        uploadedFiles.splice(index, 1);
        updateFileList();
        showMessage('已移除文件', 'info');
    }
};

async function applyExpand() {
    if (uploadedFiles.length === 0) {
        showMessage('请先上传图片', 'error');
        return;
    }
    
    const expandTop = parseInt(expandTopInput.value) || 0;
    const expandBottom = parseInt(expandBottomInput.value) || 0;
    const expandLeft = parseInt(expandLeftInput.value) || 0;
    const expandRight = parseInt(expandRightInput.value) || 0;
    
    if (expandTop < 0 || expandBottom < 0 || expandLeft < 0 || expandRight < 0) {
        showMessage('扩图像素值不能为负数', 'error');
        return;
    }
    
    if (expandTop === 0 && expandBottom === 0 && expandLeft === 0 && expandRight === 0) {
        showMessage('请至少设置一个方向的扩图像素', 'error');
        return;
    }
    
    try {
        showLoading('正在提交扩图任务...');
        applyExpandBtn.disabled = true;
        progressInfo.style.display = 'block';
        progressFill.style.width = '10%';
        progressText.textContent = '正在提交任务...';
        
        // 如果是第一次扩图，清空之前的结果
        if (processedFiles.length === 0) {
            previewGrid.innerHTML = '';
            downloadAllBtn.disabled = true;
            document.getElementById('downloadSection').style.display = 'none';
            selectedForRework.clear();
            fileProcessingStatus.clear();
        }
        
        // 重置重新扩图选择（仅在第一次扩图时）
        if (processedFiles.length === 0) {
            updateReworkSection();
        }
        
        // 提交所有文件的扩图任务
        const totalFiles = uploadedFiles.length;
        let completedTasks = 0;
        
        for (let i = 0; i < uploadedFiles.length; i++) {
            const file = uploadedFiles[i];
            try {
                progressText.textContent = `正在处理 ${i + 1}/${totalFiles}: ${file.original_name}`;
                
                const response = await fetch('/api/expand', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        file: file,
                        expandTop: expandTop,
                        expandBottom: expandBottom,
                        expandLeft: expandLeft,
                        expandRight: expandRight
                    })
                });
                
                const data = await response.json();
                
                if (response.ok && data.task_id) {
                    // 存储任务信息
                    processingTasks.set(data.task_id, {
                        file: file,
                        index: i,
                        total: totalFiles,
                        isRework: false
                    });
                    
                    // 设置初始状态为处理中
                    fileProcessingStatus.set(i, 'processing');
                    
                    // 开始轮询这个任务
                    pollTaskStatus(data.task_id);
                } else {
                    let errorMsg = data.error || '未知错误';
                    // 如果是API Key未配置的错误，显示更友好的提示
                    if (errorMsg.includes('DASHSCOPE_API_KEY')) {
                        errorMsg = 'API Key未配置！\n\n请配置环境变量 DASHSCOPE_API_KEY 后重启应用。\n\nWindows: set DASHSCOPE_API_KEY=your_key\nLinux/Mac: export DASHSCOPE_API_KEY=your_key';
                    }
                    showMessage(`文件 ${file.original_name} 提交失败: ${errorMsg}`, 'error');
                    completedTasks++;
                    updateProgress(completedTasks, totalFiles);
                }
            } catch (error) {
                showMessage(`处理文件 ${file.original_name} 时出错: ${error.message}`, 'error');
                completedTasks++;
                updateProgress(completedTasks, totalFiles);
            }
        }
        
        hideLoading();
    } catch (error) {
        hideLoading();
        showMessage('处理出错: ' + error.message, 'error');
        applyExpandBtn.disabled = false;
    }
}

async function pollTaskStatus(taskId) {
    const taskInfo = processingTasks.get(taskId);
    if (!taskInfo) return;
    
    try {
        const response = await fetch(`/api/expand-status/${taskId}`);
        const data = await response.json();
        
        if (response.ok) {
            if (data.task_status === 'SUCCEEDED') {
                // 任务成功，保存图片URL（不自动下载）
                await saveExpandedImageInfo(taskId, data.output_image_url, taskInfo.file, taskInfo.isRework);
                processingTasks.delete(taskId);
                
                // 更新进度
                const completedTasks = Array.from(fileProcessingStatus.values()).filter(s => s === 'completed').length;
                const totalFiles = taskInfo.total;
                updateProgress(completedTasks, totalFiles);
                
                // 如果是重新扩图，更新对应索引的状态
                if (taskInfo.isRework && taskInfo.index !== undefined) {
                    fileProcessingStatus.set(taskInfo.index, 'completed');
                }
                
                // 检查是否所有任务都完成
                // 检查是否还有正在处理的任务
                const hasProcessing = Array.from(fileProcessingStatus.values()).some(s => s === 'processing' || s === 'reprocessing');
                const hasCompleted = processedFiles.length > 0;
                
                if (!hasProcessing && hasCompleted) {
                    progressText.textContent = '所有任务已完成！';
                    applyExpandBtn.disabled = false;
                    if (reworkSelectedBtn) {
                        reworkSelectedBtn.disabled = false;
                    }
                    if (downloadAllBtn) {
                        downloadAllBtn.disabled = false;
                    }
                    const downloadSection = document.getElementById('downloadSection');
                    if (downloadSection) {
                        downloadSection.style.display = 'flex';
                    }
                }
            } else if (data.task_status === 'FAILED') {
                // 显示详细的失败原因
                let errorMsg = `文件 ${taskInfo.file.original_name} 扩图失败`;
                if (data.error_message) {
                    errorMsg += `: ${data.error_message}`;
                } else {
                    errorMsg += ': 任务处理失败，请检查图片格式和扩图参数';
                }
                console.error('扩图任务失败:', data);
                showMessage(errorMsg, 'error');
                processingTasks.delete(taskId);
                
                // 如果是重新扩图，恢复状态
                if (taskInfo.isRework && taskInfo.index !== undefined) {
                    fileProcessingStatus.set(taskInfo.index, 'completed');
                }
                
                const completedTasks = Array.from(fileProcessingStatus.values()).filter(s => s === 'completed').length;
                const totalFiles = taskInfo.total;
                updateProgress(completedTasks, totalFiles);
                
                const allCompleted = Array.from(fileProcessingStatus.values()).every(s => s === 'completed');
                if (allCompleted) {
                    applyExpandBtn.disabled = false;
                    reworkSelectedBtn.disabled = false;
                }
            } else if (data.task_status === 'PENDING' || data.task_status === 'RUNNING') {
                // 任务还在处理中，继续轮询
                setTimeout(() => pollTaskStatus(taskId), 3000); // 3秒后再次查询
            } else {
                // 未知状态，也继续轮询
                console.warn('未知任务状态:', data.task_status);
                setTimeout(() => pollTaskStatus(taskId), 3000);
            }
        } else {
            showMessage(`查询任务状态失败: ${data.error || '未知错误'}`, 'error');
            processingTasks.delete(taskId);
        }
    } catch (error) {
        console.error('轮询任务状态出错:', error);
        setTimeout(() => pollTaskStatus(taskId), 3000); // 出错也继续轮询
    }
}

async function saveExpandedImageInfo(taskId, imageUrl, originalFile, isRework = false) {
    try {
        if (!imageUrl) {
            showMessage(`文件 ${originalFile.original_name} 扩图失败: 未获取到扩图后的图片URL`, 'error');
            return;
        }
        
        console.log(`扩图成功: imageUrl=${imageUrl}, originalFile=${originalFile.original_name}`);
        
        // 查找是否已有该文件的记录（重新扩图的情况）
        const existingIndex = processedFiles.findIndex(f => f.original_name === originalFile.original_name);
        
        // 生成一个临时文件名用于预览（使用原始文件名+时间戳）
        const timestamp = Date.now();
        const fileExt = originalFile.original_name.split('.').pop() || 'jpg';
        const tempFileName = `${originalFile.original_name.replace(/\.[^/.]+$/, '')}_${timestamp}.${fileExt}`;
        
        const fileData = {
            original_name: originalFile.original_name,
            expanded_name: tempFileName, // 临时文件名，用于预览
            image_url: imageUrl, // 保存API返回的图片URL
            rework_count: existingIndex >= 0 ? (processedFiles[existingIndex].rework_count || 0) + 1 : 0,
            downloaded: false // 标记是否已下载到本地
        };
        
        if (existingIndex >= 0) {
            // 更新现有记录（重新扩图）
            processedFiles[existingIndex] = fileData;
            fileProcessingStatus.set(existingIndex, 'completed');
        } else {
            // 新增记录（第一次扩图）
            processedFiles.push(fileData);
            fileProcessingStatus.set(processedFiles.length - 1, 'completed');
        }
        
        updatePreview();
        showMessage(`文件 ${originalFile.original_name} 扩图成功！`, 'success');
        
        // 检查并显示下载区域
        checkAndShowDownloadSection();
    } catch (error) {
        console.error('保存扩图信息时出错:', error);
        showMessage(`文件 ${originalFile.original_name} 保存扩图信息时出错: ${error.message}`, 'error');
    }
}

async function downloadExpandedImage(imageUrl, originalFileName) {
    try {
        if (!imageUrl) {
            showMessage(`下载失败: 未获取到图片URL`, 'error');
            return;
        }
        
        console.log(`开始下载扩图结果: imageUrl=${imageUrl}, originalFileName=${originalFileName}`);
        
        const response = await fetch('/api/download-expanded', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                image_url: imageUrl,
                original_filename: originalFileName
            })
        });
        
        const data = await response.json();
        console.log('下载扩图结果响应:', data);
        
        if (response.ok && data.success) {
            console.log(`文件保存成功: ${data.filename}`);
            
            // 更新文件记录，标记为已下载
            const fileIndex = processedFiles.findIndex(f => f.original_name === originalFileName);
            if (fileIndex >= 0) {
                processedFiles[fileIndex].expanded_name = data.filename;
                processedFiles[fileIndex].downloaded = true;
                processedFiles[fileIndex].path = data.path;
            }
            
            // 触发浏览器下载
            window.open(`/api/download-expand/${data.filename}?name=${encodeURIComponent(originalFileName)}`, '_blank');
            showMessage(`文件 ${originalFileName} 下载成功！`, 'success');
        } else {
            const errorMsg = data.error || '未知错误';
            console.error('下载扩图结果失败:', errorMsg);
            showMessage(`文件 ${originalFileName} 下载失败: ${errorMsg}`, 'error');
        }
    } catch (error) {
        console.error('下载扩图结果时出错:', error);
        showMessage(`文件 ${originalFileName} 下载时出错: ${error.message}`, 'error');
    }
}

function updateProgress(completed, total) {
    const percentage = Math.round((completed / total) * 100);
    progressFill.style.width = `${percentage}%`;
    progressText.textContent = `处理进度: ${completed}/${total} (${percentage}%)`;
}

function updatePreview() {
    previewGrid.innerHTML = '';
    
    if (processedFiles.length === 0) {
        previewGrid.innerHTML = '<p style="text-align: center; color: #999; grid-column: 1 / -1;">暂无预览图片</p>';
        return;
    }
    
    processedFiles.forEach((file, index) => {
        const status = fileProcessingStatus.get(index) || 'completed';
        const isSelected = selectedForRework.has(index);
        const isReprocessing = status === 'reprocessing';
        const isHighlighted = file.rework_count > 0; // 标记是否重新扩图过
        
        const previewItem = document.createElement('div');
        previewItem.className = 'preview-item';
        if (isHighlighted) {
            previewItem.classList.add('rework-highlight');
        }
        if (isSelected) {
            previewItem.classList.add('selected');
        }
        
        let content = '';
        
        if (isReprocessing) {
            // 显示"再次加工中"状态
            content = `
                <div style="position: relative; width: 100%; height: 180px; background: #f5f5f5; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 2px dashed #2196F3;">
                    <div class="spinner" style="width: 30px; height: 30px; border: 3px solid #E3F2FD; border-top: 3px solid #2196F3; margin-bottom: 10px;"></div>
                    <div style="color: #2196F3; font-size: 0.9em; font-weight: 500;">再次加工中...</div>
                </div>
            `;
        } else {
            // 正常显示图片，添加复选框
            // 如果已下载到本地，使用本地预览；否则使用API返回的URL
            const imageSrc = file.downloaded && file.expanded_name
                ? `/api/preview-expand/${file.expanded_name}` 
                : (file.image_url || '/api/preview-expand/' + file.expanded_name);
            
            content = `
                <div style="position: relative;">
                    <input type="checkbox" class="rework-checkbox" data-index="${index}" ${isSelected ? 'checked' : ''} onchange="toggleReworkSelection(${index})" style="position: absolute; top: 10px; left: 10px; z-index: 10; width: 20px; height: 20px; cursor: pointer; background: white; border: 2px solid #2196F3;">
                    <img src="${imageSrc}" alt="${file.original_name}" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'200\\' height=\\'200\\'%3E%3Ctext x=\\'50%25\\' y=\\'50%25\\' text-anchor=\\'middle\\' dy=\\'.3em\\'%3E图片加载失败%3C/text%3E%3C/svg%3E'">
                </div>
            `;
        }
        
        previewItem.innerHTML = content + `
            <div class="preview-name">${file.original_name}${file.rework_count > 0 ? ` <span style="color: #FF9800; font-size: 0.8em;">(第${file.rework_count + 1}次扩图)</span>` : ''}</div>
            <div class="preview-actions">
                <button class="btn btn-primary btn-small" onclick="downloadSingle(${index})">下载</button>
            </div>
        `;
        previewGrid.appendChild(previewItem);
    });
    
    // 如果有已完成的图片，显示重新扩图区域
    if (processedFiles.length > 0) {
        const hasCompleted = Array.from(fileProcessingStatus.values()).some(s => s === 'completed');
        if (hasCompleted) {
            document.getElementById('reworkSection').style.display = 'block';
        }
    }
    
    updateReworkSection();
    
    // 检查并显示下载区域
    checkAndShowDownloadSection();
}

function checkAndShowDownloadSection() {
    // 只要有已完成的文件，就显示下载区域
    if (processedFiles.length > 0) {
        if (downloadAllBtn) {
            downloadAllBtn.disabled = false;
        }
        const downloadSection = document.getElementById('downloadSection');
        if (downloadSection) {
            downloadSection.style.display = 'flex';
        }
    }
}

async function downloadSingle(index) {
    const file = processedFiles[index];
    if (!file) {
        showMessage('文件信息不存在', 'error');
        return;
    }
    
    // 如果已下载到本地，直接下载本地文件
    if (file.downloaded && file.expanded_name) {
        window.open(`/api/download-expand/${file.expanded_name}?name=${encodeURIComponent(file.original_name)}`, '_blank');
    } else {
        // 否则从API URL下载
        await downloadExpandedImage(file.image_url, file.original_name);
    }
}

async function downloadAll() {
    if (processedFiles.length === 0) {
        showMessage('没有可下载的图片', 'error');
        return;
    }
    
    try {
        showLoading('正在批量下载图片...');
        downloadAllBtn.disabled = true;
        downloadAllBtn.textContent = '正在下载...';
        
        // 先确保所有文件都下载到本地
        for (let i = 0; i < processedFiles.length; i++) {
            const file = processedFiles[i];
            if (!file.downloaded && file.image_url) {
                // 如果文件还未下载，先下载到本地
                await downloadExpandedImage(file.image_url, file.original_name);
                // 延迟避免请求过快
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }
        
        // 等待所有文件下载完成后再打包
        downloadAllBtn.textContent = '正在打包...';
        
        const response = await fetch('/api/download-all-expand', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                files: processedFiles.filter(f => f.downloaded && f.expanded_name).map(f => ({
                    expanded_name: f.expanded_name,
                    original_name: f.original_name
                }))
            })
        });
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'expanded_images.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            showMessage('下载完成！', 'success');
        } else {
            const data = await response.json();
            showMessage(data.error || '下载失败', 'error');
        }
    } catch (error) {
        showMessage('下载出错: ' + error.message, 'error');
    } finally {
        hideLoading();
        downloadAllBtn.disabled = false;
        downloadAllBtn.textContent = '批量下载所有图片';
    }
}

async function clearAll() {
    if (confirm('确定要清空所有图片吗？')) {
        try {
            await fetch('/api/cleanup', {
                method: 'POST'
            });
            
            uploadedFiles = [];
            processedFiles = [];
            processingTasks.clear();
            fileList.innerHTML = '';
            previewGrid.innerHTML = '';
            fileInput.value = '';
            downloadAllBtn.disabled = true;
            document.getElementById('downloadSection').style.display = 'none';
            progressInfo.style.display = 'none';
            
            showMessage('已清空所有内容', 'success');
        } catch (error) {
            showMessage('清理出错: ' + error.message, 'error');
        }
    }
}

function showLoading(message) {
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.id = 'loadingIndicator';
    loading.innerHTML = `
        <div class="spinner"></div>
        <p>${message}</p>
    `;
    document.body.appendChild(loading);
}

function hideLoading() {
    const loading = document.getElementById('loadingIndicator');
    if (loading) {
        loading.remove();
    }
}

function showMessage(message, type = 'info') {
    const messageDiv = document.createElement('div');
    const colors = {
        success: '#4CAF50',
        error: '#F44336',
        info: '#2196F3'
    };
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 16px 24px;
        background: ${colors[type] || colors.info};
        color: white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 10000;
        animation: slideIn 0.3s ease;
        font-weight: 400;
        font-size: 0.9em;
        min-width: 200px;
    `;
    messageDiv.textContent = message;
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        messageDiv.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => messageDiv.remove(), 300);
    }, 3000);
}

// 重新扩图相关函数
function toggleReworkSelection(index) {
    if (selectedForRework.has(index)) {
        selectedForRework.delete(index);
    } else {
        selectedForRework.add(index);
    }
    updateReworkSection();
    updatePreview();
}

function updateReworkSection() {
    const selectedCount = selectedForRework.size;
    const selectedCountEl = document.getElementById('selectedCount');
    if (selectedCountEl) {
        selectedCountEl.textContent = selectedCount;
    }
    
    if (reworkSelectedBtn) {
        reworkSelectedBtn.disabled = selectedCount === 0;
    }
    
    if (reworkSection) {
        reworkSection.style.display = processedFiles.length > 0 && selectedCount > 0 ? 'block' : 'none';
    }
}

function clearSelection() {
    selectedForRework.clear();
    updateReworkSection();
    updatePreview();
}

async function reworkSelected() {
    if (selectedForRework.size === 0) {
        showMessage('请先选择要重新扩图的图片', 'error');
        return;
    }
    
    const expandTop = parseInt(expandTopInput.value) || 0;
    const expandBottom = parseInt(expandBottomInput.value) || 0;
    const expandLeft = parseInt(expandLeftInput.value) || 0;
    const expandRight = parseInt(expandRightInput.value) || 0;
    
    if (expandTop < 0 || expandBottom < 0 || expandLeft < 0 || expandRight < 0) {
        showMessage('扩图像素值不能为负数', 'error');
        return;
    }
    
    if (expandTop === 0 && expandBottom === 0 && expandLeft === 0 && expandRight === 0) {
        showMessage('请至少设置一个方向的扩图像素', 'error');
        return;
    }
    
    try {
        showLoading('正在提交重新扩图任务...');
        if (reworkSelectedBtn) {
            reworkSelectedBtn.disabled = true;
        }
        progressInfo.style.display = 'block';
        progressFill.style.width = '10%';
        progressText.textContent = '正在提交重新扩图任务...';
        
        // 获取选中的文件
        const selectedIndices = Array.from(selectedForRework);
        const filesToRework = selectedIndices.map(index => {
            const processedFile = processedFiles[index];
            // 查找原始上传的文件信息
            const originalFile = originalUploadedFiles.find(f => f.original_name === processedFile.original_name);
            return originalFile || processedFile; // 如果找不到原始文件，使用处理后的文件
        });
        
        // 设置状态为重新处理中
        selectedIndices.forEach(index => {
            fileProcessingStatus.set(index, 'reprocessing');
        });
        updatePreview();
        
        const totalFiles = filesToRework.length;
        let completedTasks = 0;
        
        for (let i = 0; i < filesToRework.length; i++) {
            const file = filesToRework[i];
            const originalIndex = selectedIndices[i];
            
            try {
                progressText.textContent = `正在重新处理 ${i + 1}/${totalFiles}: ${file.original_name}`;
                
                const response = await fetch('/api/expand', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        file: file,
                        expandTop: expandTop,
                        expandBottom: expandBottom,
                        expandLeft: expandLeft,
                        expandRight: expandRight
                    })
                });
                
                const data = await response.json();
                
                if (response.ok && data.task_id) {
                    // 存储任务信息，关联到原始索引
                    processingTasks.set(data.task_id, {
                        file: file,
                        index: originalIndex, // 使用原始索引
                        total: totalFiles,
                        isRework: true
                    });
                    
                    // 开始轮询这个任务
                    pollTaskStatus(data.task_id);
                } else {
                    let errorMsg = data.error || '未知错误';
                    showMessage(`文件 ${file.original_name} 重新扩图提交失败: ${errorMsg}`, 'error');
                    fileProcessingStatus.set(originalIndex, 'completed');
                    completedTasks++;
                    updateProgress(completedTasks, totalFiles);
                }
            } catch (error) {
                showMessage(`处理文件 ${file.original_name} 时出错: ${error.message}`, 'error');
                fileProcessingStatus.set(originalIndex, 'completed');
                completedTasks++;
                updateProgress(completedTasks, totalFiles);
            }
        }
        
        // 清除选择
        selectedForRework.clear();
        updateReworkSection();
        
        hideLoading();
    } catch (error) {
        hideLoading();
        showMessage('处理出错: ' + error.message, 'error');
        if (reworkSelectedBtn) {
            reworkSelectedBtn.disabled = false;
        }
    }
}

// 将函数暴露到全局作用域
window.toggleReworkSelection = toggleReworkSelection;

const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    @keyframes highlightPulse {
        0%, 100% {
            box-shadow: 0 0 10px rgba(255, 152, 0, 0.5);
        }
        50% {
            box-shadow: 0 0 20px rgba(255, 152, 0, 0.8);
        }
    }
    .spinner {
        border: 3px solid #E3F2FD;
        border-top: 3px solid #2196F3;
        border-radius: 50%;
        width: 30px;
        height: 30px;
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
`;
document.head.appendChild(style);
