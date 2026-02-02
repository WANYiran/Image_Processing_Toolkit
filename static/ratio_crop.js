// API基础URL
const API_BASE = '/api';

// 全局变量
let allImages = [];  // 所有图片数据（CSV或本地文件）
let selectedImages = new Set();  // 选中的图片ID
let currentCropIndex = 0;  // 当前裁切的图片索引
let cropQueue = [];  // 裁切队列
let croppedImages = [];  // 已裁切的图片数据
let currentImageData = null;  // 当前正在裁切的图片数据
let cropBoxOffsetX = 0;  // 裁切框的X偏移量
let isDragging = false;  // 是否正在拖动
let dragStartX = 0;  // 拖动起始X坐标
let imageWrapper = null;  // 图片包装器元素
let cropBox = null;  // 裁切框元素
let cropImage = null;  // 图片元素
let allCroppedImages = [];  // 所有已裁切的图片列表
let selectedCroppedImages = new Set();  // 选中的已裁切图片索引
let uploadType = 'csv';  // 'local' 或 'csv'
let uploadedLocalFiles = [];  // 本地上传的文件列表
let csvColumns = [];  // CSV列名
let csvData = [];  // 完整的CSV数据

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    initUpload();
    initCropInteraction();
    // 默认加载已裁切图片列表
    loadAllCroppedImages();
});

// 切换上传类型
window.switchUploadType = function(type) {
    uploadType = type;
    const localSection = document.getElementById('localUploadSection');
    const csvSection = document.getElementById('csvUploadSection');
    
    if (type === 'local') {
        localSection.style.display = 'block';
        csvSection.style.display = 'none';
        allImages = [];
        selectedImages.clear();
    } else {
        localSection.style.display = 'none';
        csvSection.style.display = 'block';
        uploadedLocalFiles = [];
        allImages = [];
        selectedImages.clear();
    }
    
    document.getElementById('gallerySection').style.display = 'none';
};

// 初始化上传功能
function initUpload() {
    // CSV上传
    const uploadArea = document.getElementById('uploadArea');
    const csvFile = document.getElementById('csvFile');
    
    if (uploadArea && csvFile) {
        uploadArea.addEventListener('click', () => csvFile.click());
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && file.name.endsWith('.csv')) {
                handleCSVUpload(file);
            }
        });
        
        csvFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                handleCSVUpload(file);
            }
        });
    }
    
    // 本地上传
    const localUploadArea = document.getElementById('localUploadArea');
    const localFileInput = document.getElementById('localFileInput');
    
    if (localUploadArea && localFileInput) {
        localUploadArea.addEventListener('click', () => localFileInput.click());
        localUploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            localUploadArea.classList.add('dragover');
        });
        localUploadArea.addEventListener('dragleave', () => {
            localUploadArea.classList.remove('dragover');
        });
        localUploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            localUploadArea.classList.remove('dragover');
            const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'));
            if (files.length > 0) {
                handleLocalUpload(files);
            }
        });
        
        localFileInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            if (files.length > 0) {
                handleLocalUpload(files);
            }
        });
    }
}

// 处理本地上传
async function handleLocalUpload(files) {
    const formData = new FormData();
    files.forEach(file => {
        formData.append('files', file);
    });
    
    showToast('上传图片文件中...', 'info');
    
    try {
        const response = await fetch(`${API_BASE}/upload`, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.files && data.files.length > 0) {
            uploadedLocalFiles = data.files;
            // 转换为allImages格式
            allImages = data.files.map((file, index) => ({
                id: index,
                url: null,  // 本地文件没有URL
                file_path: file.path,
                saved_name: file.saved_name,
                original_name: file.original_name,
                album_id: null,  // 本地上传不使用album_id
                is_local: true
            }));
            
            selectedImages.clear();
            updateLocalFileList();
            document.getElementById('gallerySection').style.display = 'block';
            loadGallery();
            showToast(`成功上传 ${data.files.length} 张图片`, 'success');
        } else {
            showToast(data.error || '上传失败', 'error');
        }
    } catch (error) {
        showToast('上传失败: ' + error.message, 'error');
    }
}

// 更新本地文件列表显示
function updateLocalFileList() {
    const localFileList = document.getElementById('localFileList');
    if (!localFileList) return;
    
    if (uploadedLocalFiles.length === 0) {
        localFileList.innerHTML = '<p style="color: #9E9E9E; font-weight: 300; font-size: 0.9em;">暂无上传文件</p>';
        return;
    }
    
    localFileList.innerHTML = `<div style="margin-bottom: 10px; color: #666; font-weight: bold;">已上传 ${uploadedLocalFiles.length} 张图片：</div>`;
    
    uploadedLocalFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `<span>${index + 1}. ${file.original_name}</span>`;
        localFileList.appendChild(item);
    });
}

// 处理CSV上传
async function handleCSVUpload(file) {
    const formData = new FormData();
    formData.append('file', file);
    
    showToast('上传CSV文件中...', 'info');
    
    try {
        const response = await fetch(`${API_BASE}/upload-csv-ratio`, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            csvColumns = data.columns || [];
            csvData = data.csv_data || [];
            selectedImages.clear();
            
            document.getElementById('fileName').textContent = file.name;
            document.getElementById('imageCount').textContent = data.total;
            document.getElementById('fileInfo').style.display = 'block';
            document.getElementById('gallerySection').style.display = 'block';
            
            // 更新列选择器
            updateCsvColumnSelectors();
            
            showToast(`成功加载 ${data.total} 条数据！请选择URL列和命名列`, 'success');
        } else {
            showToast(data.error || '上传失败', 'error');
        }
    } catch (error) {
        showToast('上传失败: ' + error.message, 'error');
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
    urlSelector.addEventListener('change', updateImagesFromColumns);
    nameSelector.addEventListener('change', updateImagesFromColumns);
    
    // 初始化图片列表
    updateImagesFromColumns();
}

// 根据选择的列更新CSV图片列表
function updateImagesFromColumns() {
    const urlColumn = document.getElementById('csvUrlColumnSelect')?.value;
    const nameColumn = document.getElementById('csvNameColumnSelect')?.value;
    
    if (!urlColumn || !nameColumn || csvData.length === 0) {
        allImages = [];
        selectedImages.clear();
        document.getElementById('imageCount').textContent = '0';
        loadGallery();
        return;
    }
    
    allImages = [];
    selectedImages.clear();
    
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
        allImages.push(imageData);
    });
    
    document.getElementById('imageCount').textContent = allImages.length;
    loadGallery();
}

// 加载图片画廊
async function loadGallery() {
    const galleryGrid = document.getElementById('galleryGrid');
    galleryGrid.innerHTML = '';
    
    for (let i = 0; i < allImages.length; i++) {
        const image = allImages[i];
        const item = document.createElement('div');
        item.className = 'gallery-item';
        item.dataset.index = i;
        
        // 检查是否已裁切
        const isCropped = croppedImages.some(c => c.imageId === image.id);
        
        item.innerHTML = `
            <img src="${image.url}" alt="图片 ${i + 1}" loading="lazy" 
                 onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'200\\' height=\\'200\\'%3E%3Crect fill=\\'%23ddd\\' width=\\'200\\' height=\\'200\\'/%3E%3Ctext fill=\\'%23999\\' font-family=\\'sans-serif\\' font-size=\\'14\\' dy=\\'10.5\\' font-weight=\\'bold\\' x=\\'50%25\\' y=\\'50%25\\' text-anchor=\\'middle\\'%3E加载失败%3C/text%3E%3C/svg%3E'">
            <div class="status ${isCropped ? 'cropped' : ''}">${isCropped ? '已裁切' : '未裁切'}</div>
        `;
        
        item.addEventListener('click', () => toggleSelect(i));
        if (selectedImages.has(i)) {
            item.classList.add('selected');
        }
        
        galleryGrid.appendChild(item);
    }
}

// 切换选择
function toggleSelect(index) {
    if (selectedImages.has(index)) {
        selectedImages.delete(index);
    } else {
        selectedImages.add(index);
    }
    loadGallery();
}

// 全选
function selectAll() {
    for (let i = 0; i < allImages.length; i++) {
        selectedImages.add(i);
    }
    loadGallery();
}

// 取消全选
function clearSelection() {
    selectedImages.clear();
    loadGallery();
}

// 开始裁切
function startCrop() {
    if (selectedImages.size === 0) {
        showToast('请至少选择一张图片', 'error');
        return;
    }
    
    cropQueue = Array.from(selectedImages).sort((a, b) => a - b);
    currentCropIndex = 0;
    
    document.getElementById('gallerySection').style.display = 'none';
    document.getElementById('cropSection').style.display = 'block';
    
    loadNextImage();
}

// 加载下一张图片
async function loadNextImage() {
    if (currentCropIndex >= cropQueue.length) {
        // 所有图片裁切完成
        document.getElementById('cropSection').style.display = 'none';
        document.getElementById('previewSection').style.display = 'block';
        loadPreview();
        showToast('所有图片裁切完成！', 'success');
        return;
    }
    
    const imageIndex = cropQueue[currentCropIndex];
    const image = allImages[imageIndex];
    currentImageData = {
        ...image,
        index: imageIndex
    };
    
    // 更新进度
    document.getElementById('cropProgress').textContent = `${currentCropIndex + 1} / ${cropQueue.length}`;
    document.getElementById('currentImageName').textContent = image.original_name || `图片 ${imageIndex + 1}`;
    
    // 加载图片
    try {
        showToast('加载图片中...', 'info');
        
        if (image.is_local) {
            // 本地上传：从服务器加载预览
            cropImage.src = `/api/preview-upload/${image.saved_name}`;
            
            // 等待图片加载完成后获取尺寸
            cropImage.onload = () => {
                currentImageData.width = cropImage.naturalWidth;
                currentImageData.height = cropImage.naturalHeight;
                currentImageData.format = 'JPEG';
                initCropBox();
            };
            
            cropImage.onerror = () => {
                showToast('加载图片失败', 'error');
                skipCurrent();
            };
        } else {
            // CSV上传：从URL加载
            const response = await fetch(`${API_BASE}/load-image-ratio`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url: image.url })
            });
            
            const data = await response.json();
            
            if (data.success) {
                cropImage.src = data.data_url;
                currentImageData.width = data.width;
                currentImageData.height = data.height;
                currentImageData.format = data.format;
                
                // 等待图片加载完成后初始化裁切框
                cropImage.onload = () => {
                    initCropBox();
                };
            } else {
                showToast('加载图片失败: ' + data.error, 'error');
                skipCurrent();
            }
        }
    } catch (error) {
        showToast('加载图片失败: ' + error.message, 'error');
        skipCurrent();
    }
}

// 初始化裁切框
function initCropBox() {
    if (!currentImageData) return;
    
    // 确保元素已获取
    imageWrapper = document.getElementById('cropImageWrapper');
    cropBox = document.getElementById('cropBox');
    cropImage = document.getElementById('cropImage');
    
    if (!cropImage || !cropBox) return;
    
    // 计算3:4比例的宽度（保持高度不变）
    const imageHeight = currentImageData.height;
    const imageWidth = currentImageData.width;
    const targetHeight = imageHeight;
    const targetWidth = Math.floor(targetHeight * 3 / 4);
    
    // 设置图片显示尺寸（保持比例）
    const displayHeight = Math.min(800, imageHeight);  // 最大显示高度800px
    const displayWidth = (displayHeight / imageHeight) * imageWidth;
    const displayCropWidth = (displayHeight / imageHeight) * targetWidth;
    
    // 使用固定尺寸，防止图片变形
    cropImage.style.width = displayWidth + 'px';
    cropImage.style.height = displayHeight + 'px';
    cropImage.style.maxWidth = 'none';
    cropImage.style.maxHeight = 'none';
    cropImage.style.objectFit = 'none';  // 不使用object-fit，使用精确尺寸
    
    // 初始化裁切框位置（居中）
    const maxOffset = displayWidth - displayCropWidth;
    cropBoxOffsetX = Math.max(0, Math.floor(maxOffset / 2));
    
    // 设置裁切框样式
    cropBox.style.width = displayCropWidth + 'px';
    cropBox.style.height = displayHeight + 'px';
    cropBox.style.left = cropBoxOffsetX + 'px';
    cropBox.style.top = '0px';
    
    // 更新遮罩层
    updateCropOverlay();
}

// 初始化裁切交互
function initCropInteraction() {
    cropImage = document.getElementById('cropImage');
    const cropOverlay = document.getElementById('cropOverlay');
    
    cropOverlay.addEventListener('mousedown', (e) => {
        isDragging = true;
        dragStartX = e.clientX - cropBoxOffsetX;
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isDragging || !cropBox || !currentImageData) return;
        
        const imageHeight = currentImageData.height;
        const displayHeight = Math.min(800, imageHeight);
        const displayWidth = (displayHeight / imageHeight) * currentImageData.width;
        const displayCropWidth = (displayHeight / imageHeight) * Math.floor(imageHeight * 3 / 4);
        
        const newOffsetX = e.clientX - dragStartX;
        const maxOffset = displayWidth - displayCropWidth;
        
        cropBoxOffsetX = Math.max(0, Math.min(maxOffset, newOffsetX));
        cropBox.style.left = cropBoxOffsetX + 'px';
        
        updateCropOverlay();
    });
    
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
    
    // 触摸支持
    cropOverlay.addEventListener('touchstart', (e) => {
        isDragging = true;
        const touch = e.touches[0];
        dragStartX = touch.clientX - cropBoxOffsetX;
        e.preventDefault();
    });
    
    document.addEventListener('touchmove', (e) => {
        if (!isDragging || !cropBox || !currentImageData) return;
        
        const touch = e.touches[0];
        const imageHeight = currentImageData.height;
        const displayHeight = Math.min(800, imageHeight);
        const displayWidth = (displayHeight / imageHeight) * currentImageData.width;
        const displayCropWidth = (displayHeight / imageHeight) * Math.floor(imageHeight * 3 / 4);
        
        const newOffsetX = touch.clientX - dragStartX;
        const maxOffset = displayWidth - displayCropWidth;
        
        cropBoxOffsetX = Math.max(0, Math.min(maxOffset, newOffsetX));
        cropBox.style.left = cropBoxOffsetX + 'px';
        
        updateCropOverlay();
        e.preventDefault();
    });
    
    document.addEventListener('touchend', () => {
        isDragging = false;
    });
}

// 更新裁切遮罩
function updateCropOverlay() {
    // 遮罩层由CSS的box-shadow实现，这里不需要额外操作
    // 裁切框的位置已经通过left属性设置
}

// 确认裁切
async function confirmCrop() {
    if (!currentImageData) return;
    
    // 计算实际像素偏移量
    const imageHeight = currentImageData.height;
    const imageWidth = currentImageData.width;
    const displayHeight = Math.min(800, imageHeight);
    const displayWidth = (displayHeight / imageHeight) * imageWidth;
    
    // 计算缩放比例：显示宽度 / 实际宽度
    const scale = displayWidth / imageWidth;
    const actualOffsetX = Math.floor(cropBoxOffsetX / scale);
    
    showToast('裁切中...', 'info');
    
    try {
        const requestBody = {
            offsetX: actualOffsetX,
            originalWidth: imageWidth,
            originalHeight: imageHeight,
            imageId: currentImageData.id,
            originalName: currentImageData.original_name,
            is_local_upload: currentImageData.is_local || false
        };
        
        if (currentImageData.is_local) {
            // 本地上传：传递文件路径
            requestBody.file_path = currentImageData.file_path;
            requestBody.saved_name = currentImageData.saved_name;
        } else {
            // CSV上传：传递URL和album_id
            requestBody.url = currentImageData.url;
            requestBody.albumId = currentImageData.album_id || currentImageData.id;
            // 传递命名列和CSV数据
            const nameColumn = document.getElementById('csvNameColumnSelect')?.value;
            if (nameColumn) {
                requestBody.name_column = nameColumn;
            }
            if (currentImageData.csv_data) {
                requestBody.csv_data = currentImageData.csv_data;
            }
        }
        
        const response = await fetch(`${API_BASE}/crop-ratio`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        const data = await response.json();
        
        if (data.success) {
            // 保存裁切结果
            croppedImages.push({
                imageId: currentImageData.id,
                albumId: currentImageData.album_id || currentImageData.id,
                originalName: data.original_name || currentImageData.original_name,
                processedName: data.processed_name,
                width: data.width,
                height: data.height
            });
            
            showToast('裁切成功！', 'success');
            
            // 继续下一张
            currentCropIndex++;
            setTimeout(() => {
                loadNextImage();
            }, 500);
        } else {
            showToast('裁切失败: ' + data.error, 'error');
        }
    } catch (error) {
        showToast('裁切失败: ' + error.message, 'error');
    }
}

// 重新裁切
function resetCrop() {
    initCropBox();
}

// 跳过当前图片
function skipCurrent() {
    currentCropIndex++;
    loadNextImage();
}

// 加载预览
function loadPreview() {
    const previewGrid = document.getElementById('previewGrid');
    previewGrid.innerHTML = '';
    
    if (croppedImages.length === 0) {
        previewGrid.innerHTML = '<p style="text-align: center; color: #666;">暂无裁切完成的图片</p>';
        return;
    }
    
    croppedImages.forEach((item, index) => {
        const previewItem = document.createElement('div');
        previewItem.className = 'preview-item';
        
        const previewUrl = `${API_BASE}/preview-ratio-crop/${item.processedName}`;
        
        previewItem.innerHTML = `
            <img src="${previewUrl}" alt="${item.originalName}" loading="lazy"
                 onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'250\\' height=\\'333\\'%3E%3Crect fill=\\'%23ddd\\' width=\\'250\\' height=\\'333\\'/%3E%3Ctext fill=\\'%23999\\' font-family=\\'sans-serif\\' font-size=\\'14\\' dy=\\'10.5\\' font-weight=\\'bold\\' x=\\'50%25\\' y=\\'50%25\\' text-anchor=\\'middle\\'%3E加载失败%3C/text%3E%3C/svg%3E'">
            <div class="info">
                <div class="name">${item.originalName}</div>
                <div class="btn-group">
                    <button class="btn btn-primary" onclick="downloadSingle('${item.processedName}', '${item.originalName}')">下载</button>
                </div>
            </div>
        `;
        
        previewGrid.appendChild(previewItem);
    });
}

// 下载单张图片
function downloadSingle(processedName, originalName) {
    const url = `${API_BASE}/download-ratio-crop/${processedName}?name=${encodeURIComponent(originalName)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = originalName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// 批量下载
async function downloadAll() {
    if (croppedImages.length === 0) {
        showToast('没有可下载的图片', 'error');
        return;
    }
    
    showToast('准备下载中...', 'info');
    
    try {
        const response = await fetch(`${API_BASE}/download-all-ratio-crop`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                files: croppedImages.map(item => ({
                    processed_name: item.processedName,
                    original_name: item.originalName
                }))
            })
        });
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'ratio_cropped_images.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            showToast('下载成功！', 'success');
        } else {
            const data = await response.json();
            showToast('下载失败: ' + (data.error || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('下载失败: ' + error.message, 'error');
    }
}

// 显示提示消息
function showToast(message, type = 'info') {
    // 简单的提示实现，可以后续优化
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
        color: white;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, 3000);
}

// 添加CSS动画
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

// ==================== Tab切换功能 ====================
function switchTab(tabName) {
    // 更新tab按钮状态
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach((btn, index) => {
        if ((tabName === 'crop' && index === 0) || (tabName === 'all-cropped' && index === 1)) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // 更新tab内容显示
    const cropTab = document.getElementById('cropTab');
    const allCroppedTab = document.getElementById('allCroppedTab');
    
    if (tabName === 'crop') {
        if (cropTab) cropTab.classList.add('active');
        if (allCroppedTab) allCroppedTab.classList.remove('active');
    } else if (tabName === 'all-cropped') {
        if (cropTab) cropTab.classList.remove('active');
        if (allCroppedTab) allCroppedTab.classList.add('active');
        // 切换到已裁切图片tab时，刷新列表
        loadAllCroppedImages();
    }
}

// ==================== 已裁切图片管理功能 ====================
async function loadAllCroppedImages() {
    const grid = document.getElementById('allCroppedGrid');
    grid.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">加载中...</p>';
    
    try {
        const response = await fetch(`${API_BASE}/list-ratio-crop`);
        const data = await response.json();
        
        if (data.success) {
            allCroppedImages = data.images;
            selectedCroppedImages.clear();
            
            document.getElementById('allCroppedCount').textContent = `共 ${data.total} 张图片`;
            
            if (data.total === 0) {
                grid.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">暂无已裁切的图片</p>';
                return;
            }
            
            grid.innerHTML = '';
            
            allCroppedImages.forEach((image, index) => {
                const item = document.createElement('div');
                item.className = 'all-cropped-item';
                item.dataset.index = index;
                
                const previewUrl = `${API_BASE}/preview-ratio-crop/${image.processed_name}`;
                
                item.innerHTML = `
                    <div class="checkbox"></div>
                    <img src="${previewUrl}" alt="${image.original_name}" loading="lazy"
                         onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'200\\' height=\\'266\\'%3E%3Crect fill=\\'%23ddd\\' width=\\'200\\' height=\\'266\\'/%3E%3Ctext fill=\\'%23999\\' font-family=\\'sans-serif\\' font-size=\\'14\\' dy=\\'10.5\\' font-weight=\\'bold\\' x=\\'50%25\\' y=\\'50%25\\' text-anchor=\\'middle\\'%3E加载失败%3C/text%3E%3C/svg%3E'">
                `;
                
                item.addEventListener('click', () => toggleCroppedSelection(index));
                
                grid.appendChild(item);
            });
        } else {
            grid.innerHTML = '<p style="text-align: center; color: #f44336; padding: 40px;">加载失败: ' + (data.error || '未知错误') + '</p>';
        }
    } catch (error) {
        grid.innerHTML = '<p style="text-align: center; color: #f44336; padding: 40px;">加载失败: ' + error.message + '</p>';
    }
}

function toggleCroppedSelection(index) {
    if (selectedCroppedImages.has(index)) {
        selectedCroppedImages.delete(index);
    } else {
        selectedCroppedImages.add(index);
    }
    updateCroppedSelectionDisplay();
}

function selectAllCropped() {
    for (let i = 0; i < allCroppedImages.length; i++) {
        selectedCroppedImages.add(i);
    }
    updateCroppedSelectionDisplay();
}

function clearAllCroppedSelection() {
    selectedCroppedImages.clear();
    updateCroppedSelectionDisplay();
}

function updateCroppedSelectionDisplay() {
    const items = document.querySelectorAll('.all-cropped-item');
    items.forEach((item, index) => {
        if (selectedCroppedImages.has(index)) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });
}

async function downloadSelectedCropped() {
    if (selectedCroppedImages.size === 0) {
        showToast('请至少选择一张图片', 'error');
        return;
    }
    
    const selectedFiles = Array.from(selectedCroppedImages).map(index => ({
        processed_name: allCroppedImages[index].processed_name,
        original_name: allCroppedImages[index].original_name
    }));
    
    showToast('准备下载中...', 'info');
    
    try {
        const response = await fetch(`${API_BASE}/download-all-ratio-crop`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                files: selectedFiles
            })
        });
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'ratio_cropped_images.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            showToast(`成功下载 ${selectedFiles.length} 张图片！`, 'success');
        } else {
            const data = await response.json();
            showToast('下载失败: ' + (data.error || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('下载失败: ' + error.message, 'error');
    }
}

function refreshAllCropped() {
    loadAllCroppedImages();
    showToast('列表已刷新', 'success');
}
