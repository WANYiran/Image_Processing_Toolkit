// 全局变量
let uploadedFiles = [];
let selectedImages = [];  // CSV上传的图片列表
let processedFiles = [];
let uploadType = 'local';  // 'local' 或 'csv'
let csvColumns = [];  // CSV列名
let csvData = [];  // 完整的CSV数据

// DOM 元素
let uploadArea;
let fileInput;
let fileList;
let cropTopInput;
let cropBottomInput;
let cropLeftInput;
let cropRightInput;
let applyCropBtn;
let previewGrid;
let downloadAllBtn;
let clearAllBtn;
let uploadBtn;

// 初始化函数
function init() {
    uploadArea = document.getElementById('uploadArea');
    fileInput = document.getElementById('fileInput');
    fileList = document.getElementById('fileList');
    cropTopInput = document.getElementById('cropTop');
    cropBottomInput = document.getElementById('cropBottom');
    cropLeftInput = document.getElementById('cropLeft');
    cropRightInput = document.getElementById('cropRight');
    applyCropBtn = document.getElementById('applyCrop');
    previewGrid = document.getElementById('previewGrid');
    downloadAllBtn = document.getElementById('downloadAll');
    clearAllBtn = document.getElementById('clearAll');
    uploadBtn = document.getElementById('uploadBtn');
    
    initEventListeners();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// 切换上传类型
window.switchUploadType = function(type) {
    uploadType = type;
    const localSection = document.getElementById('localUploadSection');
    const csvSection = document.getElementById('csvUploadSection');
    
    if (type === 'local') {
        localSection.style.display = 'block';
        csvSection.style.display = 'none';
        selectedImages = [];
    } else {
        localSection.style.display = 'none';
        csvSection.style.display = 'block';
        uploadedFiles = [];
    }
    
    updateFileList();
};

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
    
    // CSV文件选择
    const csvFileInput = document.getElementById('csvFileInput');
    const selectCsvBtn = document.getElementById('selectCsvBtn');
    if (csvFileInput && selectCsvBtn) {
        csvFileInput.addEventListener('change', handleCSVUpload);
    }
    
    if (applyCropBtn) {
        applyCropBtn.addEventListener('click', applyCrop);
    }
    
    if (downloadAllBtn) {
        downloadAllBtn.addEventListener('click', downloadAll);
    }
    
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', clearAll);
    }
}

// 处理CSV上传
async function handleCSVUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    const selectCsvBtn = document.getElementById('selectCsvBtn');
    if (selectCsvBtn) {
        selectCsvBtn.disabled = true;
        selectCsvBtn.textContent = '上传中...';
    }
    
    try {
        showLoading('上传CSV文件中...');
        const response = await fetch('/api/upload-csv-crop', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            csvColumns = data.columns || [];
            csvData = data.csv_data || [];
            document.getElementById('csvFileName').textContent = file.name;
            document.getElementById('csvImageCount').textContent = data.total;
            document.getElementById('csvFileInfo').style.display = 'block';
            
            // 更新列选择器
            updateCsvColumnSelectors();
            
            hideLoading();
            showMessage(`成功加载 ${data.total} 条数据！请选择URL列和命名列`, 'success');
        } else {
            hideLoading();
            showMessage(data.error || '上传失败', 'error');
        }
    } catch (error) {
        hideLoading();
        showMessage('上传出错: ' + error.message, 'error');
        console.error('上传错误:', error);
    } finally {
        if (selectCsvBtn) {
            selectCsvBtn.disabled = false;
            selectCsvBtn.textContent = '选择CSV文件';
        }
        e.target.value = '';
    }
}

// 更新CSV列选择器
function updateCsvColumnSelectors() {
    const urlSelector = document.getElementById('csvUrlColumnSelect');
    const nameSelector = document.getElementById('csvNameColumnSelect');
    const container = document.getElementById('csvColumnSelectors');
    
    if (!urlSelector || !nameSelector || csvColumns.length === 0) {
        if (container) container.style.display = 'none';
        return;
    }
    
    container.style.display = 'block';
    
    // 清空选择器
    urlSelector.innerHTML = '';
    nameSelector.innerHTML = '';
    
    // 添加所有列作为选项
    csvColumns.forEach(col => {
        // URL列选择器
        const urlOption = document.createElement('option');
        urlOption.value = col;
        urlOption.textContent = col;
        // 默认选择包含url、link、image关键词的列
        const colLower = col.toLowerCase();
        if (colLower.includes('url') || colLower.includes('link') || colLower.includes('image')) {
            urlOption.selected = true;
        }
        urlSelector.appendChild(urlOption);
        
        // 命名列选择器
        const nameOption = document.createElement('option');
        nameOption.value = col;
        nameOption.textContent = col;
        // 默认选择 album_id（如果存在）
        if (col === 'album_id' || col.toLowerCase() === 'album_id') {
            nameOption.selected = true;
        }
        nameSelector.appendChild(nameOption);
    });
    
    // 如果没有自动选中URL列，选择第一列
    if (!urlSelector.value && csvColumns.length > 0) {
        urlSelector.value = csvColumns[0];
    }
    
    // 如果没有 album_id，选择第一列作为命名列
    if (!nameSelector.value && csvColumns.length > 0) {
        nameSelector.value = csvColumns[0];
    }
    
    // 添加事件监听器，当列选择改变时更新图片列表
    urlSelector.addEventListener('change', updateCsvImagesFromColumns);
    nameSelector.addEventListener('change', updateCsvImagesFromColumns);
    
    // 初始化图片列表
    updateCsvImagesFromColumns();
}

// 根据选择的列更新CSV图片列表
function updateCsvImagesFromColumns() {
    const urlColumn = document.getElementById('csvUrlColumnSelect')?.value;
    const nameColumn = document.getElementById('csvNameColumnSelect')?.value;
    
    if (!urlColumn || !nameColumn || csvData.length === 0) {
        selectedImages = [];
        updateCsvImageList();
        return;
    }
    
    selectedImages = [];
    
    csvData.forEach((row, index) => {
        const url = row[urlColumn] ? String(row[urlColumn]).trim() : '';
        if (!url || url === 'nan' || url === '' || !url.startsWith('http')) {
            return;
        }
        
        const name = row[nameColumn] ? String(row[nameColumn]).trim() : String(index);
        const albumId = name || String(index);
        
        const imageData = {
            'id': index,
            'url': url,
            'album_id': albumId,
            'original_name': `${albumId}.jpg`,
            'csv_data': row  // 保存完整的CSV行数据
        };
        selectedImages.push(imageData);
    });
    
    document.getElementById('csvImageCount').textContent = selectedImages.length;
    updateCsvImageList();
}

// 更新CSV图片列表显示
function updateCsvImageList() {
    const csvImageList = document.getElementById('csvImageList');
    if (!csvImageList) return;
    
    if (selectedImages.length === 0) {
        csvImageList.innerHTML = '<p style="color: #9E9E9E; font-weight: 300; font-size: 0.9em;">暂无上传文件</p>';
        return;
    }
    
    csvImageList.innerHTML = `<div style="margin-bottom: 10px; color: #666; font-weight: bold;">已选择 ${selectedImages.length} 张图片：</div>`;
    
    selectedImages.forEach((image, index) => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `
            <span>${index + 1}. ${image.original_name} (${image.album_id})</span>
        `;
        csvImageList.appendChild(item);
    });
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
    
    if (uploadType === 'csv') {
        return;  // CSV上传时，使用updateCsvImageList
    }
    
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

async function applyCrop() {
    if (uploadType === 'local' && uploadedFiles.length === 0) {
        showMessage('请先上传图片', 'error');
        return;
    }
    if (uploadType === 'csv' && selectedImages.length === 0) {
        showMessage('请先上传CSV文件', 'error');
        return;
    }
    
    const cropTop = parseInt(cropTopInput.value) || 0;
    const cropBottom = parseInt(cropBottomInput.value) || 0;
    const cropLeft = parseInt(cropLeftInput.value) || 0;
    const cropRight = parseInt(cropRightInput.value) || 0;
    
    if (cropTop < 0 || cropBottom < 0 || cropLeft < 0 || cropRight < 0) {
        showMessage('裁切像素值不能为负数', 'error');
        return;
    }
    
    try {
        showLoading('正在处理图片...');
        applyCropBtn.disabled = true;
        
        const requestBody = {
            cropTop: cropTop,
            cropBottom: cropBottom,
            cropLeft: cropLeft,
            cropRight: cropRight
        };
        
        if (uploadType === 'local') {
            requestBody.files = uploadedFiles;
        } else {
            requestBody.images = selectedImages;
            // 传递命名列（如果使用CSV上传）
            const nameColumn = document.getElementById('csvNameColumnSelect')?.value;
            if (nameColumn) {
                requestBody.name_column = nameColumn;
            }
        }
        
        const response = await fetch('/api/crop', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            processedFiles = data.files;
            updatePreview();
            downloadAllBtn.disabled = false;
            hideLoading();
            showMessage('裁切完成！', 'success');
        } else {
            hideLoading();
            showMessage(data.error || '裁切失败', 'error');
        }
    } catch (error) {
        hideLoading();
        showMessage('处理出错: ' + error.message, 'error');
    } finally {
        applyCropBtn.disabled = false;
    }
}

function updatePreview() {
    previewGrid.innerHTML = '';
    
    if (processedFiles.length === 0) {
        previewGrid.innerHTML = '<p style="text-align: center; color: #999; grid-column: 1 / -1;">暂无预览图片</p>';
        return;
    }
    
    processedFiles.forEach((file, index) => {
        const previewItem = document.createElement('div');
        previewItem.className = 'preview-item';
        previewItem.innerHTML = `
            <img src="/api/preview-crop/${file.processed_name}" alt="${file.original_name}" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'200\\' height=\\'200\\'%3E%3Ctext x=\\'50%25\\' y=\\'50%25\\' text-anchor=\\'middle\\' dy=\\'.3em\\'%3E图片加载失败%3C/text%3E%3C/svg%3E'">
            <div class="preview-name">${file.original_name}</div>
            <div class="preview-actions">
                <button class="btn btn-primary btn-small" onclick="downloadSingle('${file.processed_name}', '${file.original_name}')">下载</button>
            </div>
        `;
        previewGrid.appendChild(previewItem);
    });
}

function downloadSingle(processedName, originalName) {
    const encodedName = encodeURIComponent(originalName);
    window.open(`/api/download-crop/${processedName}?name=${encodedName}`, '_blank');
}

async function downloadAll() {
    if (processedFiles.length === 0) {
        showMessage('没有可下载的图片', 'error');
        return;
    }
    
    try {
        downloadAllBtn.disabled = true;
        downloadAllBtn.textContent = '正在打包...';
        
        const response = await fetch('/api/download-all-crop', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                files: processedFiles
            })
        });
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'cropped_images.zip';
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
            fileList.innerHTML = '';
            previewGrid.innerHTML = '';
            fileInput.value = '';
            downloadAllBtn.disabled = true;
            
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
`;
document.head.appendChild(style);
