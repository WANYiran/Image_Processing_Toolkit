// 图片加字工具 JavaScript

let uploadedImages = [];  // 存储上传的图片信息
let currentSampleImage = null;  // 当前示例图片
let processedImages = [];  // 处理后的图片列表
let imageDataMap = {};  // 图片数据映射 {filename: {original_filepath, title, subtitle, ...}}
let csvColumns = [];  // CSV的所有列名
let csvData = [];  // 完整的CSV数据
let csvFilename = null;  // CSV文件名（后端保存的）
let textFields = [];  // 动态文字字段配置 [{id, name, template, fontSize, color, ...}]
let textFieldCounter = 0;  // 文字字段计数器

// 交互式拖动相关
let currentDraggingElement = null;
let dragOffset = {x: 0, y: 0};
let isResizing = false;
let resizeStartSize = {width: 0, height: 0};
let resizeStartPos = {x: 0, y: 0};
let selectedTextElement = null;
let isShiftPressed = false;
let snapThreshold = 10;  // 吸附阈值（像素）
let imageCenter = {x: 0, y: 0};
let imageSize = {width: 0, height: 0};
// 存储文字元素的固定中心点（用于字号调整时保持位置）
let textElementCenters = {
    title: null,
    subtitle: null
};
// 动态文字字段的中心点（使用 fieldId 作为 key）
let fieldElementCenters = {};

// 编辑模态框的变量（完全复制主预览区域的逻辑）
let editImageCenter = {x: 0, y: 0};
let editImageSize = {width: 0, height: 0};
let editTextElementCenters = {
    title: null,
    subtitle: null
};
let currentEditImageData = null;

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    initEventListeners();
});

function initEventListeners() {
    // 图片上传
    const imageUploadArea = document.getElementById('imageUploadArea');
    const imageInput = document.getElementById('imageInput');
    const csvUploadArea = document.getElementById('csvUploadArea');
    const csvInput = document.getElementById('csvInput');
    
    imageUploadArea.addEventListener('click', () => imageInput.click());
    imageUploadArea.addEventListener('dragover', handleDragOver);
    imageUploadArea.addEventListener('drop', (e) => handleImageDrop(e));
    
    csvUploadArea.addEventListener('click', () => csvInput.click());
    csvUploadArea.addEventListener('dragover', handleDragOver);
    csvUploadArea.addEventListener('drop', (e) => handleCSVDrop(e));
    
    imageInput.addEventListener('change', (e) => handleImageSelect(e));
    csvInput.addEventListener('change', (e) => handleCSVSelect(e));
    
    // 参数调整
    setupControlListeners();
    
    // Shift键检测
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Shift') {
            isShiftPressed = true;
        }
    });
    
    document.addEventListener('keyup', (e) => {
        if (e.key === 'Shift') {
            isShiftPressed = false;
        }
    });
    
    // 点击图片外部取消选中
    document.getElementById('previewContainer').addEventListener('click', (e) => {
        if (e.target.id === 'previewImage' || e.target.id === 'textOverlayContainer' || e.target.id === 'snapIndicators') {
            document.querySelectorAll('.text-overlay').forEach(el => {
                el.classList.remove('selected');
            });
            document.querySelectorAll('.selection-box').forEach(box => {
                box.classList.remove('active');
            });
            selectedTextElement = null;
            clearSnapIndicators();
        }
    });
    
    // 点击外部关闭CSV字段选择器的逻辑已移到showCSVFieldSelector函数中
    
    // 按钮事件
    document.getElementById('applyToAllBtn').addEventListener('click', applyToAllImages);
    document.getElementById('resetBtn').addEventListener('click', resetControls);
    document.getElementById('batchSaveBtn').addEventListener('click', batchSaveAll);
    document.getElementById('refreshBtn').addEventListener('click', refreshGallery);
    
    // 动态文字字段管理
    const addTextFieldBtn = document.getElementById('addTextFieldBtn');
    if (addTextFieldBtn) {
        addTextFieldBtn.addEventListener('click', () => {
            const fieldName = `文字${textFields.length + 1}`;
            addTextField(fieldName, '');
            renderTextFields();
        });
    }
    
    // 模态框
    document.getElementById('closeModal').addEventListener('click', closeEditModal);
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('editModal');
        if (e.target === modal) {
            closeEditModal();
        }
    });
}

function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('dragover');
}

function handleImageDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('dragover');
    const files = e.dataTransfer.files;
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length > 0) {
        imageInput.files = createFileList(imageFiles);
        handleImageSelect({target: {files: imageFiles}});
    }
}

function handleCSVDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('dragover');
    const files = e.dataTransfer.files;
    const csvFile = Array.from(files).find(f => f.name.endsWith('.csv'));
    if (csvFile) {
        csvInput.files = createFileList([csvFile]);
        handleCSVSelect({target: {files: [csvFile]}});
    }
}

function createFileList(files) {
    const dt = new DataTransfer();
    files.forEach(file => dt.items.add(file));
    return dt.files;
}

let selectedImageFiles = [];
let selectedCSVFile = null;

function handleImageSelect(e) {
    const files = Array.from(e.target.files || []);
    selectedImageFiles = files;
    updateUploadInfo();
    checkReadyToUpload();
}

function handleCSVSelect(e) {
    const file = e.target.files[0];
    selectedCSVFile = file;
    updateUploadInfo();
    checkReadyToUpload();
}

function updateUploadInfo() {
    const imageCount = selectedImageFiles.length;
    const csvFileName = selectedCSVFile ? selectedCSVFile.name : '-';
    document.getElementById('imageCount').textContent = imageCount;
    document.getElementById('csvFileName').textContent = csvFileName;
    document.getElementById('uploadInfo').style.display = 'block';
}

function checkReadyToUpload() {
    if (selectedImageFiles.length > 0 && selectedCSVFile) {
        // 先上传CSV获取列信息
        uploadCSVFirst();
    }
}

async function uploadCSVFirst() {
    if (!selectedCSVFile) {
        alert('请先选择CSV文件');
        return;
    }
    
    const formData = new FormData();
    formData.append('csv', selectedCSVFile);
    
    try {
        const response = await fetch('/api/upload-csv-text', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            csvColumns = data.columns || [];
            csvData = data.csv_data || [];
            csvFilename = data.csv_filename;
            
            // 更新列选择器
            updateMatchColumnSelector();
        } else {
            alert('CSV上传失败：' + data.error);
        }
    } catch (error) {
        console.error('CSV上传错误：', error);
        alert('CSV上传失败：' + error.message);
    }
}

function updateMatchColumnSelector() {
    const selector = document.getElementById('matchColumnSelect');
    const container = document.getElementById('csvColumnSelector');
    
    if (!selector || csvColumns.length === 0) {
        if (container) container.style.display = 'none';
        return;
    }
    
    container.style.display = 'block';
    
    // 清空选择器
    selector.innerHTML = '';
    
    // 添加所有列作为选项
    csvColumns.forEach(col => {
        const option = document.createElement('option');
        option.value = col;
        option.textContent = col;
        // 默认选择第一列
        if (csvColumns.indexOf(col) === 0) {
            option.selected = true;
        }
        selector.appendChild(option);
    });
    
    // 如果没有自动选中，选择第一列
    if (!selector.value && csvColumns.length > 0) {
        selector.value = csvColumns[0];
    }
    
    // 添加事件监听器，当列选择改变时，如果图片已上传则重新匹配
    selector.addEventListener('change', () => {
        if (selectedImageFiles.length > 0) {
            uploadImagesWithMatch();
        }
    });
    
    // 如果图片已上传，立即进行匹配
    if (selectedImageFiles.length > 0) {
        uploadImagesWithMatch();
    }
}

async function uploadImagesWithMatch() {
    if (selectedImageFiles.length === 0 || !csvFilename) {
        return;
    }
    
    const matchColumn = document.getElementById('matchColumnSelect')?.value;
    if (!matchColumn) {
        alert('请选择用于匹配图片文件名的列');
        return;
    }
    
    const formData = new FormData();
    selectedImageFiles.forEach(file => {
        formData.append('images', file);
    });
    formData.append('csv_filename', csvFilename);
    formData.append('match_column', matchColumn);
    
    try {
        const response = await fetch('/api/upload-images-text', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            uploadedImages = data.images;
            
            // 建立映射
            uploadedImages.forEach(img => {
                imageDataMap[img.filename] = {
                    original_filepath: img.filepath,
                    title: img.title,
                    subtitle: img.subtitle,
                    album_id: img.album_id,
                    csv_data: img.csv_data || {}  // 保存CSV行数据
                };
            });
            
            // 更新当前示例图片的CSV数据
            if (currentSampleImage && imageDataMap[currentSampleImage.filename]) {
                currentSampleImage.csv_data = imageDataMap[currentSampleImage.filename].csv_data;
            }
            
            // 初始化默认文字字段（如果还没有）
            if (textFields.length === 0) {
                // 创建默认的一个文字字段
                addTextField('文字一', '');
            }
            
            // 显示预览区域，使用第一张图片作为示例
            if (uploadedImages.length > 0) {
                currentSampleImage = uploadedImages[0];
                document.getElementById('previewSection').style.display = 'block';
                renderTextFields();  // 渲染文字字段UI
                loadPreviewImage();
            }
        } else {
            alert('上传失败：' + data.error);
        }
    } catch (error) {
        console.error('上传错误：', error);
        alert('上传失败：' + error.message);
    }
}

function setupControlListeners() {
    // 注意：旧的固定主标题和副标题控件已经移除
    // 现在使用动态文字字段管理系统
    // 文字字段的事件监听器在 renderTextFields() 中通过 setupTextFieldListeners() 设置
}

function updateRangeValue(controlId) {
    const control = document.getElementById(controlId);
    const valueDisplay = document.getElementById(controlId + 'Value');
    if (control && valueDisplay) {
        valueDisplay.textContent = control.value;
    }
}

function updateTextOverlay(controlId) {
    if (controlId.startsWith('title')) {
        const overlay = document.querySelector('.text-overlay-title');
        const selectionBox = document.querySelector('.selection-box[data-overlay-id="title"]');
        if (overlay) {
            if (controlId === 'titleSize') {
                // 如果还没有记录固定中心点，或者文字位置被手动修改过，则更新固定中心点
                const rect = overlay.getBoundingClientRect();
                const containerRect = overlay.parentElement.getBoundingClientRect();
                const currentLeft = rect.left - containerRect.left;
                const currentTop = rect.top - containerRect.top;
                const currentWidth = rect.width;
                const currentHeight = rect.height;
                const currentCenterX = currentLeft + currentWidth / 2;
                const currentCenterY = currentTop + currentHeight / 2;
                
                // 如果固定中心点不存在，或者当前位置与固定中心点差距较大（说明被手动移动过），则更新固定中心点
                if (!textElementCenters.title || 
                    Math.abs(textElementCenters.title.x - currentCenterX) > 5 || 
                    Math.abs(textElementCenters.title.y - currentCenterY) > 5) {
                    textElementCenters.title = {x: currentCenterX, y: currentCenterY};
                }
                
                // 使用固定的中心点
                const centerX = textElementCenters.title.x;
                const centerY = textElementCenters.title.y;
                
                // 更新字号
                const size = parseInt(document.getElementById('titleSize').value);
                overlay.style.fontSize = size + 'px';
                
                // 使用 requestAnimationFrame 确保在渲染后计算
                requestAnimationFrame(() => {
                    // 再次获取更新后的尺寸
                    const newRect = overlay.getBoundingClientRect();
                    const newWidth = newRect.width;
                    const newHeight = newRect.height;
                    
                    // 从固定的中心点重新计算位置，保持中心点不变
                    const newLeft = centerX - newWidth / 2;
                    const newTop = centerY - newHeight / 2;
                    
                    overlay.style.left = newLeft + 'px';
                    overlay.style.top = newTop + 'px';
                    
                    // 更新控制面板的位置值
                    document.getElementById('titleX').value = Math.round(newLeft);
                    document.getElementById('titleXValue').textContent = Math.round(newLeft);
                    document.getElementById('titleY').value = Math.round(newTop);
                    document.getElementById('titleYValue').textContent = Math.round(newTop);
                    
                    // 更新选中框
                    if (selectionBox) {
                        updateSelectionBox(overlay, selectionBox);
                    }
                });
            } else if (controlId === 'titleStroke') {
                const stroke = parseInt(document.getElementById('titleStroke').value);
                overlay.style.textShadow = `
                    -${stroke}px -${stroke}px 0 #000,
                    ${stroke}px -${stroke}px 0 #000,
                    -${stroke}px ${stroke}px 0 #000,
                    ${stroke}px ${stroke}px 0 #000
                `;
            } else if (controlId === 'titleX') {
                const x = parseInt(document.getElementById('titleX').value);
                overlay.style.left = x + 'px';
                // 手动修改位置时，更新固定中心点
                const rect = overlay.getBoundingClientRect();
                const containerRect = overlay.parentElement.getBoundingClientRect();
                const currentLeft = rect.left - containerRect.left;
                const currentTop = rect.top - containerRect.top;
                const currentWidth = rect.width;
                const currentHeight = rect.height;
                textElementCenters.title = {
                    x: currentLeft + currentWidth / 2,
                    y: currentTop + currentHeight / 2
                };
            } else if (controlId === 'titleY') {
                const y = parseInt(document.getElementById('titleY').value);
                overlay.style.top = y + 'px';
                // 手动修改位置时，更新固定中心点
                const rect = overlay.getBoundingClientRect();
                const containerRect = overlay.parentElement.getBoundingClientRect();
                const currentLeft = rect.left - containerRect.left;
                const currentTop = rect.top - containerRect.top;
                const currentWidth = rect.width;
                const currentHeight = rect.height;
                textElementCenters.title = {
                    x: currentLeft + currentWidth / 2,
                    y: currentTop + currentHeight / 2
                };
            } else if (controlId === 'titleLineHeight') {
                const lineHeight = parseFloat(document.getElementById('titleLineHeight').value);
                overlay.style.lineHeight = lineHeight;
            }
            if (selectionBox) {
                updateSelectionBox(overlay, selectionBox);
            }
        }
    } else if (controlId.startsWith('subtitle')) {
        const overlay = document.querySelector('.text-overlay-subtitle');
        const selectionBox = document.querySelector('.selection-box[data-overlay-id="subtitle"]');
        if (overlay) {
            if (controlId === 'subtitleSize') {
                // 如果还没有记录固定中心点，或者文字位置被手动修改过，则更新固定中心点
                const rect = overlay.getBoundingClientRect();
                const containerRect = overlay.parentElement.getBoundingClientRect();
                const currentLeft = rect.left - containerRect.left;
                const currentTop = rect.top - containerRect.top;
                const currentWidth = rect.width;
                const currentHeight = rect.height;
                const currentCenterX = currentLeft + currentWidth / 2;
                const currentCenterY = currentTop + currentHeight / 2;
                
                // 如果固定中心点不存在，或者当前位置与固定中心点差距较大（说明被手动移动过），则更新固定中心点
                if (!textElementCenters.subtitle || 
                    Math.abs(textElementCenters.subtitle.x - currentCenterX) > 5 || 
                    Math.abs(textElementCenters.subtitle.y - currentCenterY) > 5) {
                    textElementCenters.subtitle = {x: currentCenterX, y: currentCenterY};
                }
                
                // 使用固定的中心点
                const centerX = textElementCenters.subtitle.x;
                const centerY = textElementCenters.subtitle.y;
                
                // 更新字号
                const size = parseInt(document.getElementById('subtitleSize').value);
                overlay.style.fontSize = size + 'px';
                
                // 使用 requestAnimationFrame 确保在渲染后计算
                requestAnimationFrame(() => {
                    // 再次获取更新后的尺寸
                    const newRect = overlay.getBoundingClientRect();
                    const newWidth = newRect.width;
                    const newHeight = newRect.height;
                    
                    // 从固定的中心点重新计算位置，保持中心点不变
                    const newLeft = centerX - newWidth / 2;
                    const newTop = centerY - newHeight / 2;
                    
                    overlay.style.left = newLeft + 'px';
                    overlay.style.top = newTop + 'px';
                    
                    // 更新控制面板的位置值
                    document.getElementById('subtitleX').value = Math.round(newLeft);
                    document.getElementById('subtitleXValue').textContent = Math.round(newLeft);
                    document.getElementById('subtitleY').value = Math.round(newTop);
                    document.getElementById('subtitleYValue').textContent = Math.round(newTop);
                    
                    // 更新选中框
                    if (selectionBox) {
                        updateSelectionBox(overlay, selectionBox);
                    }
                });
            } else if (controlId === 'subtitleStroke') {
                const stroke = parseInt(document.getElementById('subtitleStroke').value);
                overlay.style.textShadow = `
                    -${stroke}px -${stroke}px 0 #000,
                    ${stroke}px -${stroke}px 0 #000,
                    -${stroke}px ${stroke}px 0 #000,
                    ${stroke}px ${stroke}px 0 #000
                `;
            } else if (controlId === 'subtitleX') {
                const x = parseInt(document.getElementById('subtitleX').value);
                overlay.style.left = x + 'px';
                // 手动修改位置时，更新固定中心点
                const rect = overlay.getBoundingClientRect();
                const containerRect = overlay.parentElement.getBoundingClientRect();
                const currentLeft = rect.left - containerRect.left;
                const currentTop = rect.top - containerRect.top;
                const currentWidth = rect.width;
                const currentHeight = rect.height;
                textElementCenters.subtitle = {
                    x: currentLeft + currentWidth / 2,
                    y: currentTop + currentHeight / 2
                };
            } else if (controlId === 'subtitleY') {
                const y = parseInt(document.getElementById('subtitleY').value);
                overlay.style.top = y + 'px';
                // 手动修改位置时，更新固定中心点
                const rect = overlay.getBoundingClientRect();
                const containerRect = overlay.parentElement.getBoundingClientRect();
                const currentLeft = rect.left - containerRect.left;
                const currentTop = rect.top - containerRect.top;
                const currentWidth = rect.width;
                const currentHeight = rect.height;
                textElementCenters.subtitle = {
                    x: currentLeft + currentWidth / 2,
                    y: currentTop + currentHeight / 2
                };
            } else if (controlId === 'subtitleLineHeight') {
                const lineHeight = parseFloat(document.getElementById('subtitleLineHeight').value);
                overlay.style.lineHeight = lineHeight;
            }
            if (selectionBox) {
                updateSelectionBox(overlay, selectionBox);
            }
        }
    }
}

function loadPreviewImage() {
    if (!currentSampleImage) {
        console.error('当前示例图片不存在');
        return;
    }
    
    const previewImage = document.getElementById('previewImage');
    const container = document.getElementById('textOverlayContainer');
    
    if (!previewImage || !container) {
        console.error('预览图片或容器元素不存在');
        return;
    }
    
    console.log('开始加载图片:', currentSampleImage);
    console.log('当前示例图片信息:', {
        filename: currentSampleImage.filename,
        original_filename: currentSampleImage.original_filename,
        filepath: currentSampleImage.filepath,
        album_id: currentSampleImage.album_id
    });
    
    // 使用保存的 filename（UUID格式），这是实际保存的文件名
    // original_filename 只是原始上传的文件名，不是实际保存的文件名
    const imageFilename = currentSampleImage.filename;
    
    if (!imageFilename) {
        console.error('文件名不存在！currentSampleImage:', currentSampleImage);
        alert('图片文件名不存在，请重新上传');
        return;
    }
    
    // URL编码文件名，处理特殊字符
    const encodedFilename = encodeURIComponent(imageFilename);
    // 添加时间戳防止浏览器缓存
    const timestamp = new Date().getTime();
    const imageUrl = `/api/get-original-image/${encodedFilename}?t=${timestamp}`;
    console.log('图片URL:', imageUrl);
    console.log('使用的文件名（UUID）:', imageFilename);
    console.log('编码后的文件名:', encodedFilename);
    
    // 先确保图片元素可见（参考编辑模态框的逻辑）
    previewImage.style.display = 'block';
    previewImage.style.visibility = 'visible';
    previewImage.style.opacity = '1';
    previewImage.style.width = 'auto';
    previewImage.style.height = 'auto';
    
    // 确保容器也可见
    container.style.display = 'inline-block';
    container.style.visibility = 'visible';
    
    // 设置图片源
    previewImage.src = imageUrl;
    console.log('已设置图片源:', previewImage.src);
    
    previewImage.onload = function() {
        console.log('图片onload事件触发，图片尺寸:', this.naturalWidth, 'x', this.naturalHeight);
        console.log('图片元素状态:', {
            display: previewImage.style.display,
            visibility: previewImage.style.visibility,
            opacity: previewImage.style.opacity,
            src: previewImage.src,
            complete: previewImage.complete,
            naturalWidth: previewImage.naturalWidth,
            naturalHeight: previewImage.naturalHeight,
            offsetWidth: previewImage.offsetWidth,
            offsetHeight: previewImage.offsetHeight
        });
        
        // 图片加载成功后显示（确保可见）
        previewImage.style.display = 'block';
        previewImage.style.visibility = 'visible';
        previewImage.style.opacity = '1';
        // 不要设置 width/height 为 'auto'，让后续逻辑决定尺寸
        
        // 移除容器的灰色背景（图片已加载），但保留最小尺寸
        container.style.background = 'transparent';
        
        // 等待图片实际渲染完成
        setTimeout(() => {
            // 检查实际显示尺寸
            const offsetWidth = previewImage.offsetWidth;
            const offsetHeight = previewImage.offsetHeight;
            const naturalWidth = previewImage.naturalWidth;
            const naturalHeight = previewImage.naturalHeight;
            
            console.log('图片显示尺寸:', {
                offsetWidth,
                offsetHeight,
                naturalWidth,
                naturalHeight,
                computedStyle: window.getComputedStyle(previewImage).display,
                clientWidth: previewImage.clientWidth,
                clientHeight: previewImage.clientHeight
            });
            
            // 如果显示尺寸为0，强制设置图片尺寸
            if (offsetWidth === 0 || offsetHeight === 0) {
                console.warn('图片显示尺寸为0，使用natural尺寸并强制设置');
                
                // 计算合适的显示尺寸（保持比例，最大宽度600px）
                let finalWidth = naturalWidth;
                let finalHeight = naturalHeight;
                if (finalWidth > 600) {
                    const scale = 600 / finalWidth;
                    finalWidth = 600;
                    finalHeight = Math.round(finalHeight * scale);
                }
                
                // 强制设置图片尺寸（参考编辑模态框的逻辑）
                previewImage.style.width = finalWidth + 'px';
                previewImage.style.height = finalHeight + 'px';
                previewImage.style.maxWidth = '100%';
                previewImage.style.maxHeight = '600px';
                previewImage.style.display = 'block';
                previewImage.style.visibility = 'visible';
                previewImage.style.opacity = '1';
                previewImage.style.position = 'relative';
                previewImage.style.zIndex = '1';
                
                // 设置容器尺寸和样式（移除灰色背景，确保可见）
                container.style.width = finalWidth + 'px';
                container.style.height = finalHeight + 'px';
                container.style.position = 'relative';
                container.style.display = 'inline-block';
                container.style.visibility = 'visible';
                container.style.background = 'transparent';
                container.style.minWidth = finalWidth + 'px';
                container.style.minHeight = finalHeight + 'px';
                container.style.overflow = 'hidden';  // 裁剪超出边界的文字
                
                imageSize.width = finalWidth;
                imageSize.height = finalHeight;
                
                // 再次确认图片可见（使用 requestAnimationFrame 确保渲染）
                requestAnimationFrame(() => {
                    // 强制设置样式，确保不被覆盖
                    previewImage.style.setProperty('display', 'block', 'important');
                    previewImage.style.setProperty('visibility', 'visible', 'important');
                    previewImage.style.setProperty('opacity', '1', 'important');
                    previewImage.style.setProperty('width', finalWidth + 'px', 'important');
                    previewImage.style.setProperty('height', finalHeight + 'px', 'important');
                    
                    console.log('requestAnimationFrame后图片状态:', {
                        styleDisplay: previewImage.style.display,
                        styleVisibility: previewImage.style.visibility,
                        styleOpacity: previewImage.style.opacity,
                        styleWidth: previewImage.style.width,
                        styleHeight: previewImage.style.height,
                        computedDisplay: window.getComputedStyle(previewImage).display,
                        computedVisibility: window.getComputedStyle(previewImage).visibility,
                        computedOpacity: window.getComputedStyle(previewImage).opacity,
                        offsetWidth: previewImage.offsetWidth,
                        offsetHeight: previewImage.offsetHeight
                    });
                });
                
                console.log('强制设置图片尺寸:', {
                    naturalWidth,
                    naturalHeight,
                    finalWidth,
                    finalHeight,
                    imageStyle: {
                        width: previewImage.style.width,
                        height: previewImage.style.height,
                        display: previewImage.style.display,
                        visibility: previewImage.style.visibility
                    },
                    containerStyle: {
                        width: container.style.width,
                        height: container.style.height,
                        display: container.style.display,
                        visibility: container.style.visibility,
                        background: container.style.background
                    }
                });
            } else {
                // 使用实际显示尺寸
                container.style.width = offsetWidth + 'px';
                container.style.height = offsetHeight + 'px';
                container.style.position = 'relative';
                container.style.overflow = 'hidden';  // 裁剪超出边界的文字
                imageSize.width = offsetWidth;
                imageSize.height = offsetHeight;
            }
            
            // 确保图片元素完全可见（无论哪种情况都设置）
            // 如果之前强制设置了尺寸，确保样式不被覆盖
            if (offsetWidth === 0 || offsetHeight === 0) {
                // 之前已经强制设置了，这里再次确认
                previewImage.style.setProperty('display', 'block', 'important');
                previewImage.style.setProperty('visibility', 'visible', 'important');
                previewImage.style.setProperty('opacity', '1', 'important');
            } else {
                previewImage.style.display = 'block';
                previewImage.style.visibility = 'visible';
                previewImage.style.opacity = '1';
            }
            
            // 保存图片中心点和尺寸
            imageCenter.x = imageSize.width / 2;
            imageCenter.y = imageSize.height / 2;
            
            console.log('图片加载完成:', {
                width: imageSize.width,
                height: imageSize.height,
                center: imageCenter,
                imageOffsetWidth: previewImage.offsetWidth,
                imageOffsetHeight: previewImage.offsetHeight,
                imageDisplay: previewImage.style.display
            });
            
            // 创建文字层（默认居中）
            createTextOverlays();
            
            // 在创建文字层后再次确认图片可见（防止被其他操作影响）
            setTimeout(() => {
                if (previewImage.offsetWidth === 0 || previewImage.offsetHeight === 0) {
                    console.warn('创建文字层后图片尺寸为0，重新设置');
                    previewImage.style.setProperty('display', 'block', 'important');
                    previewImage.style.setProperty('visibility', 'visible', 'important');
                    previewImage.style.setProperty('opacity', '1', 'important');
                    if (imageSize.width > 0 && imageSize.height > 0) {
                        previewImage.style.setProperty('width', imageSize.width + 'px', 'important');
                        previewImage.style.setProperty('height', imageSize.height + 'px', 'important');
                    }
                }
            }, 50);
        }, 200);
    };
    
    previewImage.onerror = function() {
        console.error('图片加载失败:', {
            imageUrl: imageUrl,
            filename: currentSampleImage.filename,
            original_filename: currentSampleImage.original_filename,
            filepath: currentSampleImage.filepath,
            src: previewImage.src,
            complete: previewImage.complete
        });
        alert('图片加载失败，请检查文件是否存在。\n文件名: ' + imageFilename + '\nURL: ' + imageUrl);
        previewImage.style.display = 'none';
        previewImage.style.visibility = 'hidden';
        // 恢复容器的灰色背景，提示用户图片加载失败
        container.style.background = '#f0f0f0';
    };
    
    // 如果图片已经加载完成（可能从缓存中），立即触发onload
    // 但需要先检查src是否已经设置（避免重复触发）
    // 注意：需要等待src设置完成后再检查
    setTimeout(() => {
        if (previewImage.complete && previewImage.naturalWidth > 0) {
            const currentSrc = previewImage.src.replace(window.location.origin, '');
            if (currentSrc === imageUrl || currentSrc.endsWith(imageUrl)) {
                console.log('图片已缓存，立即触发onload');
                previewImage.onload();
            }
        }
    }, 10);
}

function createTextOverlays() {
    const container = document.getElementById('textOverlayContainer');
    if (!container) {
        console.error('文字容器不存在');
        return;
    }
    
    // 确保容器设置了 overflow: hidden 来裁剪超出边界的文字
    container.style.overflow = 'hidden';
    
    // 保存图片元素，避免被innerHTML清空
    const previewImage = document.getElementById('previewImage');
    
    // 只清除文字层和选中框，保留图片元素
    const textOverlays = container.querySelectorAll('.text-overlay');
    const selectionBoxes = container.querySelectorAll('.selection-box');
    textOverlays.forEach(el => el.remove());
    selectionBoxes.forEach(el => el.remove());
    
    // 获取当前图片的CSV数据
    const csvData = currentSampleImage && imageDataMap[currentSampleImage.filename] 
        ? imageDataMap[currentSampleImage.filename].csv_data 
        : {};
    
    // 创建所有动态文字字段的覆盖层
    textFields.forEach((field, index) => {
        // 解析模板，替换【字段名】为实际值
        const text = parseTextTemplate(field.template, csvData);
        
        if (text) {
            const {overlay, selectionBox} = createTextFieldElement(field.id, text, field);
            container.appendChild(overlay);
            container.appendChild(selectionBox);
            // 添加到DOM后更新选中框位置和初始化中心点
            setTimeout(() => {
                updateSelectionBox(overlay, selectionBox);
                // 初始化中心点（如果还没有）
                if (!fieldElementCenters[field.id]) {
                    const rect = overlay.getBoundingClientRect();
                    const containerRect = overlay.parentElement.getBoundingClientRect();
                    const currentLeft = rect.left - containerRect.left;
                    const currentTop = rect.top - containerRect.top;
                    const currentWidth = rect.width;
                    const currentHeight = rect.height;
                    fieldElementCenters[field.id] = {
                        x: currentLeft + currentWidth / 2,
                        y: currentTop + currentHeight / 2
                    };
                }
            }, 0);
        }
    });
    
    // 确保图片元素仍然存在且可见（防止被意外移除）
    if (previewImage && !container.contains(previewImage)) {
        console.warn('图片元素被意外移除，重新添加');
        container.insertBefore(previewImage, container.firstChild);
        // 重新设置图片样式
        if (imageSize.width > 0 && imageSize.height > 0) {
            previewImage.style.setProperty('display', 'block', 'important');
            previewImage.style.setProperty('visibility', 'visible', 'important');
            previewImage.style.setProperty('opacity', '1', 'important');
            previewImage.style.setProperty('width', imageSize.width + 'px', 'important');
            previewImage.style.setProperty('height', imageSize.height + 'px', 'important');
        }
    }
}

function updateSelectionBox(overlay, selectionBox) {
    if (!overlay || !selectionBox || !overlay.parentElement) {
        return; // 如果元素不存在或未添加到DOM，直接返回
    }
    
    try {
        const rect = overlay.getBoundingClientRect();
        const containerRect = overlay.parentElement.getBoundingClientRect();
        
        selectionBox.style.left = (rect.left - containerRect.left) + 'px';
        selectionBox.style.top = (rect.top - containerRect.top) + 'px';
        selectionBox.style.width = rect.width + 'px';
        selectionBox.style.height = rect.height + 'px';
    } catch (e) {
        console.warn('更新选中框失败:', e);
        // 如果getBoundingClientRect失败，使用offsetWidth/offsetHeight
        selectionBox.style.left = overlay.style.left || '0px';
        selectionBox.style.top = overlay.style.top || '0px';
        selectionBox.style.width = overlay.offsetWidth + 'px';
        selectionBox.style.height = overlay.offsetHeight + 'px';
    }
}

function createTextElement(type, text) {
    const overlay = document.createElement('div');
    overlay.className = `text-overlay text-overlay-${type}`;
    overlay.dataset.type = type;
    
    const fontSize = type === 'title' 
        ? parseInt(document.getElementById('titleSize').value)
        : parseInt(document.getElementById('subtitleSize').value);
    const color = type === 'title'
        ? document.getElementById('titleColor').value
        : document.getElementById('subtitleColor').value;
    const strokeWidth = type === 'title'
        ? parseInt(document.getElementById('titleStroke').value)
        : parseInt(document.getElementById('subtitleStroke').value);
    const lineHeight = type === 'title'
        ? parseFloat(document.getElementById('titleLineHeight')?.value || 1.2)
        : parseFloat(document.getElementById('subtitleLineHeight')?.value || 1.2);
    
    // 计算默认居中位置
    const container = document.getElementById('textOverlayContainer');
    let containerWidth = container ? container.offsetWidth : imageSize.width;
    let containerHeight = container ? container.offsetHeight : imageSize.height;
    
    // 如果容器尺寸为0，使用图片尺寸
    if (containerWidth === 0 || containerHeight === 0) {
        const previewImage = document.getElementById('previewImage');
        if (previewImage && previewImage.complete) {
            containerWidth = previewImage.offsetWidth || previewImage.naturalWidth;
            containerHeight = previewImage.offsetHeight || previewImage.naturalHeight;
        }
    }
    
    // 临时创建元素来测量文字尺寸（使用 nowrap 防止自动换行）
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'absolute';
    tempDiv.style.visibility = 'hidden';
    tempDiv.style.fontSize = fontSize + 'px';
    tempDiv.style.fontWeight = 'bold';
    tempDiv.style.whiteSpace = 'nowrap';  // 不换行，保持一行
    tempDiv.style.lineHeight = lineHeight;
    tempDiv.style.width = 'auto';
    tempDiv.style.height = 'auto';
    tempDiv.textContent = text;
    document.body.appendChild(tempDiv);
    const textWidth = Math.max(tempDiv.offsetWidth, 100); // 最小宽度100px
    const textHeight = Math.max(tempDiv.offsetHeight, 30); // 最小高度30px
    document.body.removeChild(tempDiv);
    
    // 居中位置
    const x = Math.max(0, (containerWidth - textWidth) / 2);
    const y = Math.max(0, (containerHeight - textHeight) / 2);
    
    // 设置样式
    overlay.style.position = 'absolute';
    overlay.style.left = x + 'px';
    overlay.style.top = y + 'px';
    overlay.style.fontSize = fontSize + 'px';
    overlay.style.color = color;
    overlay.style.lineHeight = lineHeight;
    overlay.style.textShadow = `
        -${strokeWidth}px -${strokeWidth}px 0 #000,
        ${strokeWidth}px -${strokeWidth}px 0 #000,
        -${strokeWidth}px ${strokeWidth}px 0 #000,
        ${strokeWidth}px ${strokeWidth}px 0 #000
    `;
    overlay.style.fontWeight = 'bold';
    overlay.style.whiteSpace = 'nowrap';  // 不换行，保持一行，超出部分不显示
    overlay.style.overflow = 'visible';   // 允许超出边界
    overlay.style.zIndex = '10';
    overlay.style.pointerEvents = 'auto';
    overlay.textContent = text;
    
    console.log('创建文字层:', {
        type,
        text,
        x,
        y,
        fontSize,
        color,
        containerWidth,
        containerHeight
    });
    
    // 创建选中框（类似Figma）
    const selectionBox = document.createElement('div');
    selectionBox.className = 'selection-box';
    selectionBox.dataset.type = type;
    selectionBox.dataset.overlayId = overlay.dataset.type;
    
    // 添加调整大小的手柄到选中框
    const handles = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    handles.forEach(pos => {
        const handle = document.createElement('div');
        handle.className = `resize-handle ${pos}`;
        selectionBox.appendChild(handle);
    });
    
    // 绑定拖动事件
    setupDragAndResize(overlay, selectionBox);
    
    // 注意：选中框位置会在元素添加到DOM后更新
    // 这里先设置一个初始位置，等添加到DOM后再更新
    
    return {overlay, selectionBox};
}

function setupDragAndResize(overlay, selectionBox) {
    let isDragging = false;
    let isResizing = false;
    let startX, startY, startLeft, startTop, startWidth, startHeight;
    let resizeHandle = null;
    
    // 点击选中
    overlay.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        console.log('点击文字层');
        selectTextElement(overlay, selectionBox);
    });
    
    // 拖动文字
    overlay.addEventListener('mousedown', (e) => {
        // 如果点击的是调整手柄，不处理
        if (e.target.classList.contains('resize-handle')) {
            e.stopPropagation();
            return;
        }
        
        console.log('开始拖动文字');
        // 拖动位置
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = parseInt(overlay.style.left) || 0;
        startTop = parseInt(overlay.style.top) || 0;
        overlay.classList.add('dragging');
        e.preventDefault();
        e.stopPropagation();
    });
    
    // 选中框的调整大小手柄
    selectionBox.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('resize-handle')) {
            console.log('开始调整大小');
            isResizing = true;
            resizeHandle = e.target;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = parseInt(overlay.style.left) || 0;
            startTop = parseInt(overlay.style.top) || 0;
            startWidth = overlay.offsetWidth || 100;
            startHeight = overlay.offsetHeight || 50;
            
            console.log('调整大小初始值:', {
                startLeft,
                startTop,
                startWidth,
                startHeight,
                centerX: startLeft + startWidth / 2,
                centerY: startTop + startHeight / 2
            });
            
            e.preventDefault();
            e.stopPropagation();
        }
    });
    
    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            let deltaX = e.clientX - startX;
            let deltaY = e.clientY - startY;
            
            // Shift键：只允许水平或垂直移动
            if (isShiftPressed) {
                if (Math.abs(deltaX) > Math.abs(deltaY)) {
                    deltaY = 0;
                } else {
                    deltaX = 0;
                }
            }
            
            let newX = startLeft + deltaX;
            let newY = startTop + deltaY;
            
            // 居中吸附
            const snapped = snapToCenter(newX, newY, overlay);
            newX = snapped.x;
            newY = snapped.y;
            
            overlay.style.left = newX + 'px';
            overlay.style.top = newY + 'px';
            updateSelectionBox(overlay, selectionBox);
            updateControlValues(overlay);
        } else if (isResizing) {
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            const pos = resizeHandle.classList[1];
            
            // 计算当前文字的中心点（用于从中心缩放）
            const currentCenterX = startLeft + startWidth / 2;
            const currentCenterY = startTop + startHeight / 2;
            
            // 计算缩放比例（使用对角线距离）
            const startDistance = Math.sqrt(Math.pow(startWidth, 2) + Math.pow(startHeight, 2));
            const currentDistance = Math.sqrt(Math.pow(startWidth + deltaX, 2) + Math.pow(startHeight + deltaY, 2));
            const scale = currentDistance / startDistance;
            
            // 根据拖动的角确定缩放方向
            let widthScale = 1;
            let heightScale = 1;
            
            if (pos.includes('right') || pos.includes('left')) {
                widthScale = scale;
            }
            if (pos.includes('bottom') || pos.includes('top')) {
                heightScale = scale;
            }
            
            // 如果同时拖动水平和垂直方向，使用统一缩放
            if ((pos.includes('right') || pos.includes('left')) && (pos.includes('bottom') || pos.includes('top'))) {
                widthScale = scale;
                heightScale = scale;
            }
            
            let newWidth = Math.max(50, startWidth * widthScale);
            let newHeight = Math.max(30, startHeight * heightScale);
            
            // 从中心点计算新的位置（保持中心点不变）
            const newLeft = currentCenterX - newWidth / 2;
            const newTop = currentCenterY - newHeight / 2;
            
            // 先更新位置和尺寸
            overlay.style.left = newLeft + 'px';
            overlay.style.top = newTop + 'px';
            overlay.style.width = newWidth + 'px';
            overlay.style.height = newHeight + 'px';
            
            // 根据宽度调整字号（保持比例）
            const type = overlay.dataset.type;
            const currentFontSize = parseInt(overlay.style.fontSize) || (type === 'title' ? 60 : 40);
            const fontSizeScale = newWidth / startWidth;
            const newFontSize = Math.max(15, Math.min(200, currentFontSize * fontSizeScale));
            overlay.style.fontSize = newFontSize + 'px';
            
            // 更新选中框
            updateSelectionBox(overlay, selectionBox);
            
            // 更新控制面板
            if (type === 'title') {
                document.getElementById('titleSize').value = Math.round(newFontSize);
                document.getElementById('titleSizeValue').textContent = Math.round(newFontSize);
            } else {
                document.getElementById('subtitleSize').value = Math.round(newFontSize);
                document.getElementById('subtitleSizeValue').textContent = Math.round(newFontSize);
            }
        }
    });
    
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            overlay.classList.remove('dragging');
            isDragging = false;
            clearSnapIndicators();
            
            // 拖动结束时，更新固定中心点
            const type = overlay.dataset.type;
            const fieldId = overlay.dataset.fieldId;
            const rect = overlay.getBoundingClientRect();
            const containerRect = overlay.parentElement.getBoundingClientRect();
            const currentLeft = rect.left - containerRect.left;
            const currentTop = rect.top - containerRect.top;
            const currentWidth = rect.width;
            const currentHeight = rect.height;
            const centerX = currentLeft + currentWidth / 2;
            const centerY = currentTop + currentHeight / 2;
            
            if (fieldId) {
                // 动态字段
                fieldElementCenters[fieldId] = {x: centerX, y: centerY};
                // 更新字段配置
                const field = textFields.find(f => f.id === fieldId);
                if (field) {
                    field.x = currentLeft;
                    field.y = currentTop;
                    // 更新UI控件
                    updateControlValues(overlay);
                }
            } else if (type === 'title') {
                textElementCenters.title = {x: centerX, y: centerY};
            } else if (type === 'subtitle') {
                textElementCenters.subtitle = {x: centerX, y: centerY};
            }
        }
        if (isResizing) {
            isResizing = false;
            resizeHandle = null;
            
            // 调整大小结束时，更新固定中心点
            const type = overlay.dataset.type;
            const fieldId = overlay.dataset.fieldId;
            const rect = overlay.getBoundingClientRect();
            const containerRect = overlay.parentElement.getBoundingClientRect();
            const currentLeft = rect.left - containerRect.left;
            const currentTop = rect.top - containerRect.top;
            const currentWidth = rect.width;
            const currentHeight = rect.height;
            const centerX = currentLeft + currentWidth / 2;
            const centerY = currentTop + currentHeight / 2;
            
            if (fieldId) {
                // 动态字段
                fieldElementCenters[fieldId] = {x: centerX, y: centerY};
                // 更新字段配置
                const field = textFields.find(f => f.id === fieldId);
                if (field) {
                    field.x = currentLeft;
                    field.y = currentTop;
                    // 更新UI控件
                    updateControlValues(overlay);
                }
            } else if (type === 'title') {
                textElementCenters.title = {x: centerX, y: centerY};
            } else if (type === 'subtitle') {
                textElementCenters.subtitle = {x: centerX, y: centerY};
            }
        }
    });
    
    // 点击外部取消选中
    document.addEventListener('click', (e) => {
        if (!overlay.contains(e.target) && !selectionBox.contains(e.target)) {
            overlay.classList.remove('selected');
            selectionBox.classList.remove('active');
        }
    });
}

function selectTextElement(overlay, selectionBox) {
    // 取消其他选中
    document.querySelectorAll('.text-overlay').forEach(el => {
        el.classList.remove('selected');
    });
    document.querySelectorAll('.selection-box').forEach(box => {
        box.classList.remove('active');
    });
    
    overlay.classList.add('selected');
    selectionBox.classList.add('active');
    selectedTextElement = overlay;
    updateSelectionBox(overlay, selectionBox);
    updateControlsFromElement(overlay);
}

function updateControlsFromElement(overlay) {
    const fieldId = overlay.dataset.fieldId;
    if (!fieldId) {
        // 如果是旧的 title/subtitle 类型，忽略（已废弃）
        return;
    }
    
    const field = textFields.find(f => f.id === fieldId);
    if (!field) return;
    
    const left = parseInt(overlay.style.left) || 0;
    const top = parseInt(overlay.style.top) || 0;
    const fontSize = parseInt(overlay.style.fontSize) || field.fontSize;
    const color = overlay.style.color || field.color;
    
    // 更新字段配置
    field.x = left;
    field.y = top;
    field.fontSize = fontSize;
    field.color = rgbToHex(color);
    
    // 更新UI控件
    const xInput = document.getElementById(`x_${fieldId}`);
    const xValue = document.getElementById(`xValue_${fieldId}`);
    const yInput = document.getElementById(`y_${fieldId}`);
    const yValue = document.getElementById(`yValue_${fieldId}`);
    const fontSizeInput = document.getElementById(`fontSize_${fieldId}`);
    const fontSizeValue = document.getElementById(`fontSizeValue_${fieldId}`);
    const colorInput = document.getElementById(`color_${fieldId}`);
    
    if (xInput) xInput.value = left;
    if (xValue) xValue.textContent = left;
    if (yInput) yInput.value = top;
    if (yValue) yValue.textContent = top;
    if (fontSizeInput) fontSizeInput.value = fontSize;
    if (fontSizeValue) fontSizeValue.textContent = fontSize;
    if (colorInput) colorInput.value = rgbToHex(color);
}

function updateControlValues(overlay) {
    const fieldId = overlay.dataset.fieldId;
    if (!fieldId) {
        // 如果是旧的 title/subtitle 类型，忽略（已废弃）
        return;
    }
    
    const field = textFields.find(f => f.id === fieldId);
    if (!field) return;
    
    const left = parseInt(overlay.style.left) || 0;
    const top = parseInt(overlay.style.top) || 0;
    
    // 更新字段配置
    field.x = left;
    field.y = top;
    
    // 更新UI控件
    const xInput = document.getElementById(`x_${fieldId}`);
    const xValue = document.getElementById(`xValue_${fieldId}`);
    const yInput = document.getElementById(`y_${fieldId}`);
    const yValue = document.getElementById(`yValue_${fieldId}`);
    
    if (xInput) xInput.value = left;
    if (xValue) xValue.textContent = left;
    if (yInput) yInput.value = top;
    if (yValue) yValue.textContent = top;
}

function snapToCenter(x, y, element) {
    const elementWidth = element.offsetWidth;
    const elementHeight = element.offsetHeight;
    const centerX = x + elementWidth / 2;
    const centerY = y + elementHeight / 2;
    
    let snappedX = x;
    let snappedY = y;
    let showSnap = false;
    
    // 检查是否接近水平中心
    if (Math.abs(centerX - imageCenter.x) < snapThreshold) {
        snappedX = imageCenter.x - elementWidth / 2;
        showSnap = true;
        showSnapIndicator('vertical', imageCenter.x);
    }
    
    // 检查是否接近垂直中心
    if (Math.abs(centerY - imageCenter.y) < snapThreshold) {
        snappedY = imageCenter.y - elementHeight / 2;
        showSnap = true;
        showSnapIndicator('horizontal', imageCenter.y);
    }
    
    if (!showSnap) {
        clearSnapIndicators();
    }
    
    return {x: snappedX, y: snappedY};
}

function showSnapIndicator(direction, position) {
    clearSnapIndicators();
    const container = document.getElementById('textOverlayContainer');
    if (!container) return;
    
    const indicator = document.createElement('div');
    indicator.className = `snap-indicator ${direction}`;
    
    if (direction === 'vertical') {
        indicator.style.left = position + 'px';
        indicator.style.top = '0px';
        indicator.style.height = container.offsetHeight + 'px';
    } else {
        indicator.style.top = position + 'px';
        indicator.style.left = '0px';
        indicator.style.width = container.offsetWidth + 'px';
    }
    
    const snapContainer = document.getElementById('snapIndicators');
    if (snapContainer) {
        snapContainer.appendChild(indicator);
    }
}

function clearSnapIndicators() {
    const snapContainer = document.getElementById('snapIndicators');
    if (snapContainer) {
        snapContainer.innerHTML = '';
    }
}

function rgbToHex(rgb) {
    if (rgb.startsWith('#')) return rgb;
    const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (!match) return '#000000';
    return '#' + [1, 2, 3].map(i => {
        const hex = parseInt(match[i]).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('');
}

// 显示加载提示
function showLoadingMessage(message) {
    // 移除可能已存在的加载提示
    const existingLoading = document.getElementById('loadingMessage');
    if (existingLoading) {
        existingLoading.remove();
    }
    
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'loadingMessage';
    loadingDiv.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0, 0, 0, 0.8); color: white; padding: 20px 40px; border-radius: 8px; z-index: 10000; font-size: 16px; text-align: center;';
    loadingDiv.innerHTML = `
        <div style="margin-bottom: 10px;">${message}</div>
        <div style="border: 3px solid #f3f3f3; border-top: 3px solid #4CAF50; border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; margin: 0 auto;"></div>
        <style>
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        </style>
    `;
    document.body.appendChild(loadingDiv);
}

// 隐藏加载提示
function hideLoadingMessage() {
    const loadingDiv = document.getElementById('loadingMessage');
    if (loadingDiv) {
        loadingDiv.remove();
    }
}

// 显示成功提示
function showSuccessMessage(message) {
    // 移除可能已存在的提示
    const existingMessage = document.getElementById('successMessage');
    if (existingMessage) {
        existingMessage.remove();
    }
    
    const successDiv = document.createElement('div');
    successDiv.id = 'successMessage';
    successDiv.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #4CAF50; color: white; padding: 20px 40px; border-radius: 8px; z-index: 10000; font-size: 16px; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';
    successDiv.textContent = message;
    document.body.appendChild(successDiv);
    
    // 3秒后自动消失
    setTimeout(() => {
        successDiv.remove();
    }, 3000);
}

async function applyToAllImages() {
    if (uploadedImages.length === 0) {
        alert('没有图片需要处理');
        return;
    }
    
    if (textFields.length === 0) {
        alert('请至少添加一个文字字段');
        return;
    }
    
    // 显示加载提示
    showLoadingMessage('正在处理图片，请稍候...');
    
    // 收集所有动态文字字段的配置（只收集有模板或已配置的字段）
    const textFieldConfigs = [];
    
    textFields.forEach(field => {
        // 只处理有模板的字段（过滤掉空模板的字段）
        if (!field.template || field.template.trim() === '') {
            return;  // 跳过空模板的字段
        }
        
        // 从DOM中查找对应的文字层
        const overlay = document.querySelector(`[data-field-id="${field.id}"]`);
        
        let fieldConfig = {
            field_id: field.id,
            field_name: field.name,
            template: field.template,
            font_size: field.fontSize,
            colors: field.colors || (field.color ? [field.color] : ['#FFFF00']),  // 传递颜色数组
            stroke_width: field.strokeWidth,
            stroke_color: field.strokeColor || '#000000',
            line_height: field.lineHeight,
            x: field.x,
            y: field.y
        };
        
        // 如果文字层存在，使用实际位置、大小、颜色和描边
        if (overlay) {
            // 优先使用字段配置中的中心坐标（如果存在）
            if (field.center_x !== null && field.center_x !== undefined && 
                field.center_y !== null && field.center_y !== undefined) {
                // 使用字段配置中的中心坐标
                fieldConfig.center_x = field.center_x;
                fieldConfig.center_y = field.center_y;
                fieldConfig.width = field.width || overlay.offsetWidth;
                fieldConfig.height = field.height || overlay.offsetHeight;
                
                // 计算左上角坐标（从中心坐标计算）
                fieldConfig.x = fieldConfig.center_x - fieldConfig.width / 2;
                fieldConfig.y = fieldConfig.center_y - fieldConfig.height / 2;
            } else {
                // 如果没有中心坐标，从DOM计算
                const left = parseInt(overlay.style.left) || fieldConfig.x;
                const top = parseInt(overlay.style.top) || fieldConfig.y;
                
                // 获取文字的实际尺寸
                const rect = overlay.getBoundingClientRect();
                const textWidth = rect.width;
                const textHeight = rect.height;
                
                // 计算中心坐标
                const centerX = left + textWidth / 2;
                const centerY = top + textHeight / 2;
                
                // 传递中心坐标和尺寸
                fieldConfig.center_x = centerX;
                fieldConfig.center_y = centerY;
                fieldConfig.width = textWidth;
                fieldConfig.height = textHeight;
                fieldConfig.x = left;  // 保留左上角坐标作为备用
                fieldConfig.y = top;
            }
            fieldConfig.font_size = parseInt(overlay.style.fontSize) || fieldConfig.font_size;
            
            // 从 overlay 获取颜色
            const overlayColor = overlay.style.color;
            if (overlayColor) {
                fieldConfig.color = rgbToHex(overlayColor);
            }
            // 从 textShadow 解析描边宽度
            const textShadow = overlay.style.textShadow;
            if (textShadow) {
                const strokeMatch = textShadow.match(/-(\d+)px/);
                if (strokeMatch) {
                    fieldConfig.stroke_width = parseInt(strokeMatch[1]);
                }
            }
        }
        
        textFieldConfigs.push(fieldConfig);
    });
    
    // 获取预览图片的实际尺寸和显示尺寸，用于位置缩放
    const previewImage = document.getElementById('previewImage');
    let previewNaturalWidth = 0;
    let previewNaturalHeight = 0;
    let previewDisplayWidth = 0;
    let previewDisplayHeight = 0;
    
    if (previewImage && previewImage.complete) {
        previewNaturalWidth = previewImage.naturalWidth || imageSize.width;
        previewNaturalHeight = previewImage.naturalHeight || imageSize.height;
        previewDisplayWidth = previewImage.offsetWidth || imageSize.width;
        previewDisplayHeight = previewImage.offsetHeight || imageSize.height;
    } else {
        // 如果没有预览图片，使用 imageSize
        previewNaturalWidth = imageSize.width;
        previewNaturalHeight = imageSize.height;
        previewDisplayWidth = imageSize.width;
        previewDisplayHeight = imageSize.height;
    }
    
    // 为每张图片准备数据（包含CSV数据用于模板解析）
    const imagesWithText = uploadedImages.map(img => {
        const csvData = imageDataMap[img.filename]?.csv_data || {};
        return {
            ...img,
            csv_data: csvData
        };
    });
    
    try {
        const response = await fetch('/api/apply-text-all', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                images: imagesWithText,
                text_fields: textFieldConfigs,  // 使用动态文字字段配置
                preview_size: {
                    natural_width: previewNaturalWidth,
                    natural_height: previewNaturalHeight,
                    display_width: previewDisplayWidth,
                    display_height: previewDisplayHeight
                }
            })
        });
        
        const data = await response.json();
        
        // 隐藏加载提示
        hideLoadingMessage();
        
        if (data.success) {
            processedImages = data.images;
            // 更新映射，确保保存文字内容和配置信息（包括中心坐标、预览尺寸和随机颜色）
            processedImages.forEach(img => {
                // 从原始上传的图片数据中查找对应的数据
                const originalImg = uploadedImages.find(u => u.album_id === img.album_id || u.filename === img.original_filename);
                
                // 创建文字字段配置，包含每张图片实际使用的随机颜色
                const textFieldsWithColors = textFieldConfigs.map((fieldConfig, index) => {
                    const fieldId = fieldConfig.field_id || `field_${index}`;
                    // 如果后端返回了该字段的随机颜色，使用它；否则使用第一个颜色
                    const appliedColor = img.applied_colors && img.applied_colors[fieldId] 
                        ? img.applied_colors[fieldId] 
                        : (fieldConfig.colors && fieldConfig.colors[0] ? fieldConfig.colors[0] : '#FFFF00');
                    
                    return {
                        ...fieldConfig,
                        color: appliedColor,  // 保存该图片实际使用的颜色
                        colors: fieldConfig.colors  // 保留颜色数组（用于后续编辑）
                    };
                });
                
                if (originalImg) {
                    imageDataMap[img.filename] = {
                        original_filepath: originalImg.filepath || imageDataMap[img.filename]?.original_filepath,
                        csv_data: originalImg.csv_data || imageDataMap[img.filename]?.csv_data || {},
                        album_id: img.album_id,
                        processed_filename: img.filename,
                        // 保存文字字段配置信息（包括中心坐标、预览尺寸和随机颜色），用于单张编辑时恢复位置和颜色
                        text_fields: textFieldsWithColors,
                        preview_size: {
                            natural_width: previewNaturalWidth,
                            natural_height: previewNaturalHeight,
                            display_width: previewDisplayWidth,
                            display_height: previewDisplayHeight
                        }
                    };
                } else if (imageDataMap[img.filename]) {
                    imageDataMap[img.filename].processed_filename = img.filename;
                    // 保存配置信息（包括随机颜色）
                    imageDataMap[img.filename].text_fields = textFieldsWithColors;
                    imageDataMap[img.filename].preview_size = {
                        natural_width: previewNaturalWidth,
                        natural_height: previewNaturalHeight,
                        display_width: previewDisplayWidth,
                        display_height: previewDisplayHeight
                    };
                } else {
                    // 如果找不到，使用返回的数据
                    imageDataMap[img.filename] = {
                        original_filepath: img.original_filepath || '',
                        csv_data: img.csv_data || {},
                        album_id: img.album_id,
                        processed_filename: img.filename,
                        // 保存配置信息（包括随机颜色）
                        text_fields: textFieldsWithColors,
                        preview_size: {
                            natural_width: previewNaturalWidth,
                            natural_height: previewNaturalHeight,
                            display_width: previewDisplayWidth,
                            display_height: previewDisplayHeight
                        }
                    };
                }
            });
            
            // 显示结果区域
            document.getElementById('gallerySection').style.display = 'block';
            loadGallery();
            
            // 显示成功提示
            showSuccessMessage(`成功处理 ${data.processed || processedImages.length} 张图片！`);
        } else {
            alert('批量处理失败：' + data.error);
        }
    } catch (error) {
        console.error('批量处理错误：', error);
        // 隐藏加载提示
        hideLoadingMessage();
        alert('批量处理失败：' + error.message);
    }
}

function resetControls() {
    document.getElementById('titleSize').value = 60;
    document.getElementById('titleColor').value = '#FFFF00';
    document.getElementById('titleStroke').value = 3;
    document.getElementById('titleX').value = 50;
    document.getElementById('titleY').value = 50;
    
    document.getElementById('subtitleSize').value = 40;
    document.getElementById('subtitleColor').value = '#FFFFFF';
    document.getElementById('subtitleStroke').value = 3;
    document.getElementById('subtitleX').value = 50;
    document.getElementById('subtitleY').value = 150;
    
    // 更新显示值
    ['titleSize', 'titleStroke', 'titleX', 'titleY', 'subtitleSize', 'subtitleStroke', 'subtitleX', 'subtitleY'].forEach(id => {
        updateRangeValue(id);
    });
    
    if (currentSampleImage) {
        createTextOverlays();
    }
}

async function loadGallery() {
    try {
        const response = await fetch('/api/list-text-images');
        const data = await response.json();
        
        if (data.success) {
            processedImages = data.images;
            
            // 从批量处理的结果中获取文字内容（如果存在）
            // 因为 list-text-images 不返回文字内容，我们需要从之前保存的 imageDataMap 中获取
            // 或者从 processedImages 中获取（如果之前保存了）
            processedImages.forEach(img => {
                // 如果 imageDataMap 中没有，尝试从 processedImages 中查找
                if (!imageDataMap[img.filename]) {
                    const existingData = processedImages.find(p => p.filename === img.filename);
                    if (existingData && (existingData.title || existingData.subtitle)) {
                        imageDataMap[img.filename] = {
                            original_filepath: existingData.original_filepath || '',
                            title: existingData.title || '',
                            subtitle: existingData.subtitle || '',
                            album_id: img.album_id,
                            processed_filename: img.filename
                        };
                    } else {
                        // 如果还是没有，至少保存基本信息
                        imageDataMap[img.filename] = {
                            original_filepath: '',
                            title: '',
                            subtitle: '',
                            album_id: img.album_id,
                            processed_filename: img.filename
                        };
                    }
                }
            });
            
            displayGallery(processedImages);
        }
    } catch (error) {
        console.error('加载图片列表错误：', error);
    }
}

function displayGallery(images) {
    const galleryGrid = document.getElementById('galleryGrid');
    galleryGrid.innerHTML = '';
    
    images.forEach(img => {
        const item = document.createElement('div');
        item.className = 'gallery-item';
        item.onclick = () => openEditModal(img);
        
        const imgElement = document.createElement('img');
        // 添加时间戳防止浏览器缓存
        const timestamp = new Date().getTime();
        imgElement.src = `/api/download-text-image/${img.filename}?t=${timestamp}`;
        imgElement.alt = img.album_id;
        
        const badge = document.createElement('div');
        badge.className = 'edit-badge';
        badge.textContent = '点击编辑';
        
        item.appendChild(imgElement);
        item.appendChild(badge);
        galleryGrid.appendChild(item);
    });
}

// 渲染编辑模态框的动态字段控件
function renderEditFields(fieldsToUse, csvData) {
    const container = document.getElementById('editFieldsContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    // 解析每个字段的文字内容
    fieldsToUse.forEach((field, index) => {
        let fieldText = '';
        
        // 优先使用保存的文字内容
        if (currentEditImageData && currentEditImageData.fieldTexts && currentEditImageData.fieldTexts[field.field_id]) {
            fieldText = currentEditImageData.fieldTexts[field.field_id];
        } else if (field.template) {
            // 使用模板解析
            fieldText = parseTextTemplate(field.template, csvData);
        } else {
            // 使用旧格式的title/subtitle
            if (index === 0 && currentEditImageData && currentEditImageData.title) {
                fieldText = currentEditImageData.title;
            } else if (index === 1 && currentEditImageData && currentEditImageData.subtitle) {
                fieldText = currentEditImageData.subtitle;
            }
        }
        
        const fieldDiv = document.createElement('div');
        fieldDiv.className = 'text-field-item';
        fieldDiv.dataset.fieldId = field.field_id;
        fieldDiv.style.marginBottom = index < fieldsToUse.length - 1 ? '30px' : '20px';
        
        const colorToUse = field.color || (field.colors && field.colors.length > 0 ? field.colors[0] : '#FFFF00');
        
        fieldDiv.innerHTML = `
            <h3>${field.field_name || `字段${index + 1}`}</h3>
            <div class="control-group">
                <label>文字内容：</label>
                <textarea class="textarea-control edit-field-text" data-field-id="${field.field_id}" placeholder="文字内容（支持换行）">${fieldText}</textarea>
            </div>
            <div class="control-row">
                <div class="control-item">
                    <label>字号：<span class="range-value edit-field-size-value" data-field-id="${field.field_id}">${field.font_size || 60}</span>px</label>
                    <input type="range" class="edit-field-size" data-field-id="${field.field_id}" min="20" max="200" value="${field.font_size || 60}">
                </div>
                <div class="control-item">
                    <label>行间距：<span class="range-value edit-field-line-height-value" data-field-id="${field.field_id}">${field.line_height || 1.2}</span></label>
                    <input type="range" class="edit-field-line-height" data-field-id="${field.field_id}" min="0.8" max="3" step="0.1" value="${field.line_height || 1.2}">
                </div>
                <div class="control-item">
                    <label>颜色：</label>
                    <input type="color" class="edit-field-color" data-field-id="${field.field_id}" value="${colorToUse}" style="width: 100%; height: 40px; cursor: pointer;">
                </div>
                <div class="control-item">
                    <label>描边粗细：<span class="range-value edit-field-stroke-value" data-field-id="${field.field_id}">${field.stroke_width || 3}</span>px</label>
                    <input type="range" class="edit-field-stroke" data-field-id="${field.field_id}" min="0" max="10" value="${field.stroke_width || 3}">
                </div>
                <div class="control-item">
                    <label>X位置：<span class="range-value edit-field-x-value" data-field-id="${field.field_id}">${field.x || 50}</span>px</label>
                    <input type="range" class="edit-field-x" data-field-id="${field.field_id}" min="0" max="1000" value="${field.x || 50}">
                </div>
                <div class="control-item">
                    <label>Y位置：<span class="range-value edit-field-y-value" data-field-id="${field.field_id}">${field.y || 50}</span>px</label>
                    <input type="range" class="edit-field-y" data-field-id="${field.field_id}" min="0" max="1000" value="${field.y || 50}">
                </div>
            </div>
        `;
        
        container.appendChild(fieldDiv);
    });
    
    // 添加保存按钮
    const btnGroup = document.createElement('div');
    btnGroup.className = 'btn-group';
    btnGroup.style.marginTop = '20px';
    btnGroup.innerHTML = `
        <button class="btn btn-primary" onclick="saveSingleEdit()">保存修改</button>
        <button class="btn btn-secondary" onclick="closeEditModal()">取消</button>
    `;
    container.appendChild(btnGroup);
    
    // 绑定事件监听器
    setupEditFieldListeners();
}

// 设置编辑字段的事件监听器
function setupEditFieldListeners() {
    // 文字内容变化
    document.querySelectorAll('.edit-field-text').forEach(textarea => {
        textarea.addEventListener('input', () => {
            createEditTextOverlays();
        });
    });
    
    // 控件变化
    document.querySelectorAll('.edit-field-size, .edit-field-color, .edit-field-stroke, .edit-field-x, .edit-field-y, .edit-field-line-height').forEach(control => {
        control.addEventListener('input', () => {
            const fieldId = control.dataset.fieldId;
            updateEditFieldValue(control, fieldId);
            createEditTextOverlays();
        });
    });
}

// 更新编辑字段的显示值
function updateEditFieldValue(control, fieldId) {
    const value = control.value;
    const type = control.className.split(' ').find(c => c.startsWith('edit-field-')).replace('edit-field-', '');
    const valueDisplay = document.querySelector(`.edit-field-${type}-value[data-field-id="${fieldId}"]`);
    if (valueDisplay) {
        valueDisplay.textContent = value;
    }
}

function openEditModal(imageData) {
    const modal = document.getElementById('editModal');
    
    // 获取原始数据
    const originalData = imageDataMap[imageData.filename] || {};
    
    // 获取当前图片的CSV数据
    const csvData = originalData.csv_data || {};
    
    // 保存当前编辑的图片数据
    currentEditImageData = {
        filename: imageData.filename,
        original_filename: originalData.original_filepath ? originalData.original_filepath.split(/[/\\]/).pop() : null,
        album_id: imageData.album_id || originalData.album_id,
        csv_data: csvData,
        title: originalData.title,
        subtitle: originalData.subtitle,
        fieldTexts: {}  // 存储每个字段的文字内容
    };
    
    // 检查是否有保存的文字字段配置（如果图片之前被编辑过）
    const savedTextFields = originalData.text_fields;
    
    // 确定使用哪个配置：优先使用保存的配置，否则使用统一的模板配置
    let fieldsToUse = [];
    if (savedTextFields && savedTextFields.length > 0) {
        // 如果图片之前被编辑过，使用保存的配置（包含随机颜色）
        fieldsToUse = savedTextFields;
        // 从保存的配置中提取文字内容
        savedTextFields.forEach((field, index) => {
            if (index === 0 && originalData.title) {
                currentEditImageData.fieldTexts[field.field_id] = originalData.title;
            } else if (index === 1 && originalData.subtitle) {
                currentEditImageData.fieldTexts[field.field_id] = originalData.subtitle;
            }
        });
    } else if (textFields.length > 0) {
        // 如果图片没有被编辑过，使用统一的模板配置
        fieldsToUse = textFields.map(field => ({
            field_id: field.id,
            field_name: field.name,
            template: field.template,
            font_size: field.fontSize,
            color: field.colors && field.colors.length > 0 ? field.colors[0] : (field.color || '#FFFF00'),
            stroke_width: field.strokeWidth,
            stroke_color: field.strokeColor || '#000000',
            line_height: field.lineHeight,
            x: field.x,
            y: field.y,
            center_x: field.center_x,
            center_y: field.center_y,
            width: field.width,
            height: field.height
        }));
    }
    
    // 渲染动态字段控件
    renderEditFields(fieldsToUse, csvData);
    
    // 设置保存按钮的onclick（传递filename）
    const saveBtn = document.querySelector('#editModal .btn-primary');
    if (saveBtn) {
        saveBtn.onclick = () => saveSingleEdit(imageData.filename);
    }
    
    // 清除之前的文字层和选中框（如果存在），但保留图片元素
    const container = document.getElementById('editTextOverlayContainer');
    if (container) {
        // 只清除文字层和选中框，不删除图片元素
        container.querySelectorAll('.text-overlay, .selection-box').forEach(el => el.remove());
    }
    
    // 重置编辑相关的变量（使用对象存储所有字段的中心点）
    editTextElementCenters = {};
    
    // 显示模态框
    modal.style.display = 'block';
    
    // 显示模态框
    modal.style.display = 'block';
    
    // 加载预览图片和文字层（在模态框显示后加载，确保元素可见）
    // 使用原始文件名加载原始图片作为底图
    const originalFilename = currentEditImageData.original_filename || 
                            (originalData.original_filepath ? originalData.original_filepath.split(/[/\\]/).pop() : null) ||
                            imageData.original_filename || 
                            (imageData.filename.startsWith('text_') ? imageData.filename.replace('text_', '') : imageData.filename);
    
    // 延迟一下确保模态框完全显示，然后加载图片
    setTimeout(() => {
        // 检查元素是否存在
        const previewImage = document.getElementById('editPreviewImage');
        const container = document.getElementById('editTextOverlayContainer');
        if (!previewImage || !container) {
            console.error('编辑预览图片或容器元素不存在', {
                previewImage: !!previewImage,
                container: !!container
            });
            return;
        }
        // 加载原始图片作为底图（不带文字）
        loadEditPreviewImage(originalFilename);
    }, 100);
}

// 重置编辑控件为主预览区域的当前值（统一设定的值）
function resetEditControls() {
    // 从主预览区域的控件读取当前值
    const titleSize = parseInt(document.getElementById('titleSize')?.value || 60);
    const titleColor = document.getElementById('titleColor')?.value || '#FFFF00';
    const titleStroke = parseInt(document.getElementById('titleStroke')?.value || 3);
    const titleX = parseInt(document.getElementById('titleX')?.value || 50);
    const titleY = parseInt(document.getElementById('titleY')?.value || 50);
    const titleLineHeight = parseFloat(document.getElementById('titleLineHeight')?.value || 1.2);
    
    const subtitleSize = parseInt(document.getElementById('subtitleSize')?.value || 40);
    const subtitleColor = document.getElementById('subtitleColor')?.value || '#FFFFFF';
    const subtitleStroke = parseInt(document.getElementById('subtitleStroke')?.value || 3);
    const subtitleX = parseInt(document.getElementById('subtitleX')?.value || 50);
    const subtitleY = parseInt(document.getElementById('subtitleY')?.value || 150);
    const subtitleLineHeight = parseFloat(document.getElementById('subtitleLineHeight')?.value || 1.2);
    
    // 设置编辑控件的值
    const editTitleSize = document.getElementById('editTitleSize');
    const editTitleSizeValue = document.getElementById('editTitleSizeValue');
    if (editTitleSize) editTitleSize.value = titleSize;
    if (editTitleSizeValue) editTitleSizeValue.textContent = titleSize;
    
    const editTitleColor = document.getElementById('editTitleColor');
    if (editTitleColor) editTitleColor.value = titleColor;
    
    const editTitleStroke = document.getElementById('editTitleStroke');
    const editTitleStrokeValue = document.getElementById('editTitleStrokeValue');
    if (editTitleStroke) editTitleStroke.value = titleStroke;
    if (editTitleStrokeValue) editTitleStrokeValue.textContent = titleStroke;
    
    const editTitleX = document.getElementById('editTitleX');
    const editTitleXValue = document.getElementById('editTitleXValue');
    if (editTitleX) editTitleX.value = titleX;
    if (editTitleXValue) editTitleXValue.textContent = titleX;
    
    const editTitleY = document.getElementById('editTitleY');
    const editTitleYValue = document.getElementById('editTitleYValue');
    if (editTitleY) editTitleY.value = titleY;
    if (editTitleYValue) editTitleYValue.textContent = titleY;
    
    const editTitleLineHeight = document.getElementById('editTitleLineHeight');
    const editTitleLineHeightValue = document.getElementById('editTitleLineHeightValue');
    if (editTitleLineHeight) editTitleLineHeight.value = titleLineHeight;
    if (editTitleLineHeightValue) editTitleLineHeightValue.textContent = titleLineHeight;
    
    const editSubtitleSize = document.getElementById('editSubtitleSize');
    const editSubtitleSizeValue = document.getElementById('editSubtitleSizeValue');
    if (editSubtitleSize) editSubtitleSize.value = subtitleSize;
    if (editSubtitleSizeValue) editSubtitleSizeValue.textContent = subtitleSize;
    
    const editSubtitleColor = document.getElementById('editSubtitleColor');
    if (editSubtitleColor) editSubtitleColor.value = subtitleColor;
    
    const editSubtitleStroke = document.getElementById('editSubtitleStroke');
    const editSubtitleStrokeValue = document.getElementById('editSubtitleStrokeValue');
    if (editSubtitleStroke) editSubtitleStroke.value = subtitleStroke;
    if (editSubtitleStrokeValue) editSubtitleStrokeValue.textContent = subtitleStroke;
    
    const editSubtitleX = document.getElementById('editSubtitleX');
    const editSubtitleXValue = document.getElementById('editSubtitleXValue');
    if (editSubtitleX) editSubtitleX.value = subtitleX;
    if (editSubtitleXValue) editSubtitleXValue.textContent = subtitleX;
    
    const editSubtitleY = document.getElementById('editSubtitleY');
    const editSubtitleYValue = document.getElementById('editSubtitleYValue');
    if (editSubtitleY) editSubtitleY.value = subtitleY;
    if (editSubtitleYValue) editSubtitleYValue.textContent = subtitleY;
    
    const editSubtitleLineHeight = document.getElementById('editSubtitleLineHeight');
    const editSubtitleLineHeightValue = document.getElementById('editSubtitleLineHeightValue');
    if (editSubtitleLineHeight) editSubtitleLineHeight.value = subtitleLineHeight;
    if (editSubtitleLineHeightValue) editSubtitleLineHeightValue.textContent = subtitleLineHeight;
}

// 设置编辑模态框的控制监听器（完全复制主预览区域的逻辑）
function setupEditControlListeners() {
    // 主标题控制
    const titleControls = ['editTitleSize', 'editTitleColor', 'editTitleStroke', 'editTitleX', 'editTitleY', 'editTitleLineHeight'];
    titleControls.forEach(controlId => {
        const control = document.getElementById(controlId);
        if (control) {
            control.addEventListener('input', () => {
                updateEditRangeValue(controlId);
                updateEditTextOverlay(controlId);
            });
        }
    });
    
    // 副标题控制
    const subtitleControls = ['editSubtitleSize', 'editSubtitleColor', 'editSubtitleStroke', 'editSubtitleX', 'editSubtitleY', 'editSubtitleLineHeight'];
    subtitleControls.forEach(controlId => {
        const control = document.getElementById(controlId);
        if (control) {
            control.addEventListener('input', () => {
                updateEditRangeValue(controlId);
                updateEditTextOverlay(controlId);
            });
        }
    });
    
    // 文字内容
    const editTitleTextEl = document.getElementById('editTitleText');
    if (editTitleTextEl) {
        editTitleTextEl.addEventListener('input', () => {
            createEditTextOverlays();
        });
    }
    
    const editSubtitleTextEl = document.getElementById('editSubtitleText');
    if (editSubtitleTextEl) {
        editSubtitleTextEl.addEventListener('input', () => {
            createEditTextOverlays();
        });
    }
    
    // 颜色变化时更新文字颜色
    const editTitleColorEl = document.getElementById('editTitleColor');
    if (editTitleColorEl) {
        editTitleColorEl.addEventListener('input', (e) => {
            const titleOverlay = document.querySelector('#editTextOverlayContainer .text-overlay-title');
            if (titleOverlay) {
                titleOverlay.style.color = e.target.value;
            }
        });
    }
    
    const editSubtitleColorEl = document.getElementById('editSubtitleColor');
    if (editSubtitleColorEl) {
        editSubtitleColorEl.addEventListener('input', (e) => {
            const subtitleOverlay = document.querySelector('#editTextOverlayContainer .text-overlay-subtitle');
            if (subtitleOverlay) {
                subtitleOverlay.style.color = e.target.value;
            }
        });
    }
}

function updateEditRangeValue(controlId) {
    const control = document.getElementById(controlId);
    const valueDisplay = document.getElementById(controlId + 'Value');
    if (control && valueDisplay) {
        valueDisplay.textContent = control.value;
    }
}

function loadEditPreviewImage(filename) {
    if (!filename) {
        console.error('编辑预览图片文件名不存在');
        return;
    }
    
    const previewImage = document.getElementById('editPreviewImage');
    const container = document.getElementById('editTextOverlayContainer');
    
    if (!previewImage) {
        console.error('编辑预览图片元素不存在 (editPreviewImage)');
        console.log('当前DOM状态:', {
            modal: document.getElementById('editModal')?.style.display,
            container: !!container
        });
        return;
    }
    
    if (!container) {
        console.error('编辑文字容器元素不存在 (editTextOverlayContainer)');
        console.log('当前DOM状态:', {
            modal: document.getElementById('editModal')?.style.display,
            previewImage: !!previewImage
        });
        return;
    }
    
    console.log('开始加载编辑预览图片:', filename);
    // 加载原始图片作为底图（不带文字），文字层会单独叠加显示
    // 添加时间戳防止浏览器缓存
    const timestamp = new Date().getTime();
    const imageUrl = `/api/get-original-image/${filename}?t=${timestamp}`;
    console.log('编辑图片URL（原始图片）:', imageUrl);
    
    // 先确保图片元素可见（参考主预览区域的逻辑）
    previewImage.style.display = 'block';
    previewImage.style.visibility = 'visible';
    previewImage.style.opacity = '1';
    
    // 确保容器也可见
    container.style.display = 'inline-block';
    container.style.visibility = 'visible';
    
    // 设置图片源为原始图片
    previewImage.src = imageUrl;
    
    previewImage.onload = function() {
        console.log('编辑图片onload事件触发，图片尺寸:', this.naturalWidth, 'x', this.naturalHeight);
        // 图片加载成功后显示（确保可见）
        previewImage.style.display = 'block';
        previewImage.style.visibility = 'visible';
        previewImage.style.opacity = '1';
        
        // 等待图片实际渲染完成
        setTimeout(() => {
            // 使用实际显示尺寸
            const displayWidth = previewImage.offsetWidth || previewImage.naturalWidth;
            const displayHeight = previewImage.offsetHeight || previewImage.naturalHeight;
            
            console.log('编辑图片显示尺寸:', {
                offsetWidth: previewImage.offsetWidth,
                offsetHeight: previewImage.offsetHeight,
                naturalWidth: previewImage.naturalWidth,
                naturalHeight: previewImage.naturalHeight,
                displayWidth,
                displayHeight
            });
            
            if (displayWidth === 0 || displayHeight === 0) {
                console.warn('编辑图片显示尺寸为0，使用natural尺寸');
                container.style.width = previewImage.naturalWidth + 'px';
                container.style.height = previewImage.naturalHeight + 'px';
                editImageSize.width = previewImage.naturalWidth;
                editImageSize.height = previewImage.naturalHeight;
            } else {
                container.style.width = displayWidth + 'px';
                container.style.height = displayHeight + 'px';
                editImageSize.width = displayWidth;
                editImageSize.height = displayHeight;
            }
            
            container.style.position = 'relative';
            container.style.overflow = 'hidden';  // 裁剪超出边界的文字
            
            // 保存图片中心点和尺寸
            editImageCenter.x = editImageSize.width / 2;
            editImageCenter.y = editImageSize.height / 2;
            
            console.log('编辑图片加载完成:', {
                width: editImageSize.width,
                height: editImageSize.height,
                center: editImageCenter
            });
            
            // 创建文字层（默认居中）- 确保在图片加载完成后创建
            createEditTextOverlays();
            
            // 注意：固定中心点的初始化已经在 createEditTextOverlays 中完成
            // 如果使用保存的中心坐标，会在 createEditTextElement 中直接设置
            // 如果没有保存的中心坐标，会在 createEditTextOverlays 的 setTimeout 中初始化
        }, 100);
    };
    
    previewImage.onerror = function() {
        console.error('编辑预览图片加载失败:', imageUrl);
        alert('图片加载失败，请检查文件是否存在。文件名: ' + filename);
        previewImage.style.visibility = 'hidden';
    };
    
    // 如果图片已经加载完成（从缓存），延迟触发onload，避免重复触发
    if (previewImage.complete && previewImage.naturalWidth > 0) {
        // 使用 setTimeout 避免立即触发，确保不会重复触发
        setTimeout(() => {
            if (previewImage.complete && previewImage.naturalWidth > 0 && previewImage.src === imageUrl) {
                previewImage.onload();
            }
        }, 50);
    }
}

function createEditTextOverlays() {
    const container = document.getElementById('editTextOverlayContainer');
    if (!container) {
        console.error('编辑文字容器不存在');
        return;
    }
    
    // 确保容器设置了 overflow: hidden 来裁剪超出边界的文字
    container.style.overflow = 'hidden';
    
    // 清除文字层和选中框，但保留图片元素
    const previewImage = document.getElementById('editPreviewImage');
    container.querySelectorAll('.text-overlay, .selection-box').forEach(el => el.remove());
    
    // 确保图片元素在容器中
    if (previewImage && !container.contains(previewImage)) {
        container.appendChild(previewImage);
    }
    
    // 重置固定中心点（使用对象存储所有字段的中心点）
    editTextElementCenters = {};
    
    // 获取所有编辑字段
    const fieldTextareas = document.querySelectorAll('.edit-field-text');
    
    fieldTextareas.forEach(textarea => {
        const fieldId = textarea.dataset.fieldId;
        const fieldText = textarea.value || '';
        
        if (fieldText) {
            const {overlay, selectionBox} = createEditTextElementByFieldId(fieldId, fieldText);
            container.appendChild(overlay);
            container.appendChild(selectionBox);
            
            // 添加到DOM后更新选中框位置，并初始化固定中心点
            setTimeout(() => {
                updateSelectionBox(overlay, selectionBox);
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        if (!overlay || !overlay.parentElement || !document.body.contains(overlay)) {
                            return;
                        }
                        if (!editTextElementCenters[fieldId]) {
                            const rect = overlay.getBoundingClientRect();
                            const containerRect = overlay.parentElement.getBoundingClientRect();
                            const currentLeft = rect.left - containerRect.left;
                            const currentTop = rect.top - containerRect.top;
                            const currentWidth = rect.width;
                            const currentHeight = rect.height;
                            editTextElementCenters[fieldId] = {
                                x: currentLeft + currentWidth / 2,
                                y: currentTop + currentHeight / 2
                            };
                        }
                    });
                });
            }, 100);
        }
    });
}

// 根据fieldId创建编辑文字元素（支持动态字段）
function createEditTextElementByFieldId(fieldId, text) {
    const overlay = document.createElement('div');
    overlay.className = `text-overlay text-overlay-field`;
    overlay.dataset.type = 'field';
    overlay.dataset.fieldId = fieldId;
    
    // 从动态字段控件中读取值
    const fontSizeInput = document.querySelector(`.edit-field-size[data-field-id="${fieldId}"]`);
    const colorInput = document.querySelector(`.edit-field-color[data-field-id="${fieldId}"]`);
    const strokeInput = document.querySelector(`.edit-field-stroke[data-field-id="${fieldId}"]`);
    const lineHeightInput = document.querySelector(`.edit-field-line-height[data-field-id="${fieldId}"]`);
    const xInput = document.querySelector(`.edit-field-x[data-field-id="${fieldId}"]`);
    const yInput = document.querySelector(`.edit-field-y[data-field-id="${fieldId}"]`);
    
    const fontSize = fontSizeInput ? parseInt(fontSizeInput.value) : 60;
    const color = colorInput ? colorInput.value : '#FFFF00';
    const strokeWidth = strokeInput ? parseInt(strokeInput.value) : 3;
    const lineHeight = lineHeightInput ? parseFloat(lineHeightInput.value) : 1.2;
    
    // 向后兼容：如果没有找到动态字段控件，尝试使用旧的title/subtitle控件
    let x, y;
    if (!xInput || !yInput) {
        // 尝试使用旧的控件（向后兼容）
        const oldXInput = document.getElementById('editTitleX') || document.getElementById('editSubtitleX');
        const oldYInput = document.getElementById('editTitleY') || document.getElementById('editSubtitleY');
        x = oldXInput ? parseInt(oldXInput.value) : 50;
        y = oldYInput ? parseInt(oldYInput.value) : 50;
    } else {
        x = parseInt(xInput.value) || 50;
        y = parseInt(yInput.value) || 50;
    }
    
    // 计算默认居中位置
    const container = document.getElementById('editTextOverlayContainer');
    let containerWidth = container ? container.offsetWidth : editImageSize.width;
    let containerHeight = container ? container.offsetHeight : editImageSize.height;
    
    // 如果容器尺寸为0，使用图片尺寸
    if (containerWidth === 0 || containerHeight === 0) {
        const previewImage = document.getElementById('editPreviewImage');
        if (previewImage && previewImage.complete) {
            containerWidth = previewImage.offsetWidth || previewImage.naturalWidth;
            containerHeight = previewImage.offsetHeight || previewImage.naturalHeight;
        }
    }
    
    // 检查文字是否包含换行符
    const hasLineBreaks = text.includes('\n');
    
    // 临时创建元素来测量文字尺寸
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'absolute';
    tempDiv.style.visibility = 'hidden';
    tempDiv.style.fontSize = fontSize + 'px';
    tempDiv.style.fontWeight = 'bold';
    // 如果有换行符，使用 pre-wrap 允许换行；否则使用 nowrap 保持一行
    tempDiv.style.whiteSpace = hasLineBreaks ? 'pre-wrap' : 'nowrap';
    tempDiv.style.lineHeight = lineHeight;
    tempDiv.style.width = hasLineBreaks ? containerWidth + 'px' : 'auto';
    tempDiv.style.height = 'auto';
    tempDiv.textContent = text;
    document.body.appendChild(tempDiv);
    const textWidth = Math.max(tempDiv.offsetWidth, 100); // 最小宽度100px
    const textHeight = Math.max(tempDiv.offsetHeight, 30); // 最小高度30px
    document.body.removeChild(tempDiv);
    
    // 从保存的配置中读取中心坐标（优先使用中心坐标，确保位置一致）
    const originalData = imageDataMap[currentEditImageData?.filename] || {};
    
    // 优先使用新的 text_fields 格式
    const savedTextFields = originalData.text_fields;
    let savedConfig = null;
    let savedPreviewSize = null;
    
    if (savedTextFields && savedTextFields.length > 0) {
        // 根据fieldId查找对应的配置
        savedConfig = savedTextFields.find(f => f.field_id === fieldId);
        if (savedConfig) {
            savedPreviewSize = originalData.preview_size || {};
        }
    }
    
    // 优先使用中心坐标（如果有保存的中心坐标）
    if (savedConfig && savedConfig.center_x !== undefined && savedConfig.center_x !== null && 
        savedConfig.center_y !== undefined && savedConfig.center_y !== null) {
        // 使用保存的中心坐标，根据当前预览尺寸进行缩放
        const savedPreviewWidth = savedPreviewSize?.display_width || savedPreviewSize?.natural_width || containerWidth;
        const savedPreviewHeight = savedPreviewSize?.display_height || savedPreviewSize?.natural_height || containerHeight;
        
        // 计算缩放比例
        const scaleX = containerWidth / savedPreviewWidth;
        const scaleY = containerHeight / savedPreviewHeight;
        
        // 缩放中心坐标
        const centerX = savedConfig.center_x * scaleX;
        const centerY = savedConfig.center_y * scaleY;
        
        // 直接使用缩放后的中心坐标作为固定中心点（确保一致性）
        editTextElementCenters[fieldId] = {x: centerX, y: centerY};
        
        // 从中心坐标计算左上角坐标
        x = centerX - textWidth / 2;
        y = centerY - textHeight / 2;
    } else {
        // 如果没有中心坐标，使用控件中的左上角坐标
        if (xInput && yInput) {
            x = parseInt(xInput.value) || 0;
            y = parseInt(yInput.value) || 0;
        } else {
            // 如果没有保存的位置，使用居中位置
            x = Math.max(0, (containerWidth - textWidth) / 2);
            y = Math.max(0, (containerHeight - textHeight) / 2);
        }
    }
    
    // 设置样式
    overlay.style.position = 'absolute';
    overlay.style.left = x + 'px';
    overlay.style.top = y + 'px';
    overlay.style.fontSize = fontSize + 'px';
    overlay.style.color = color;
    overlay.style.lineHeight = lineHeight;
    overlay.style.textShadow = `
        -${strokeWidth}px -${strokeWidth}px 0 #000,
        ${strokeWidth}px -${strokeWidth}px 0 #000,
        -${strokeWidth}px ${strokeWidth}px 0 #000,
        ${strokeWidth}px ${strokeWidth}px 0 #000
    `;
    overlay.style.fontWeight = 'bold';
    // 如果有换行符，使用 pre-wrap 允许换行；否则使用 nowrap 保持一行
    overlay.style.whiteSpace = hasLineBreaks ? 'pre-wrap' : 'nowrap';
    overlay.style.overflow = 'visible';   // 允许超出边界
    // 换行后居中对齐
    overlay.style.textAlign = 'center';
    if (hasLineBreaks) {
        overlay.style.width = containerWidth + 'px';
    }
    overlay.style.zIndex = '10';
    overlay.style.pointerEvents = 'auto';
    overlay.textContent = text;
    
    console.log('创建编辑文字层:', {
        fieldId,
        text,
        x,
        y,
        fontSize,
        color,
        containerWidth,
        containerHeight
    });
    
    // 创建选中框（类似Figma）
    const selectionBox = document.createElement('div');
    selectionBox.className = 'selection-box';
    selectionBox.dataset.fieldId = fieldId;
    selectionBox.dataset.overlayId = fieldId;
    
    // 添加调整大小的手柄到选中框
    const handles = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    handles.forEach(pos => {
        const handle = document.createElement('div');
        handle.className = `resize-handle ${pos}`;
        selectionBox.appendChild(handle);
    });
    
    // 绑定拖动事件（使用编辑版本的setupDragAndResize）
    setupEditDragAndResize(overlay, selectionBox);
    
    // 注意：选中框位置会在元素添加到DOM后更新
    // 这里先设置一个初始位置，等添加到DOM后再更新
    
    return {overlay, selectionBox};
}

function setupEditDragAndResize(overlay, selectionBox) {
    let isDragging = false;
    let isResizing = false;
    let startX, startY, startLeft, startTop, startWidth, startHeight;
    let resizeHandle = null;
    
    // 点击选中
    overlay.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        console.log('点击编辑文字层');
        selectEditTextElement(overlay, selectionBox);
    });
    
    // 拖动文字
    overlay.addEventListener('mousedown', (e) => {
        // 如果点击的是调整手柄，不处理
        if (e.target.classList.contains('resize-handle')) {
            e.stopPropagation();
            return;
        }
        
        console.log('开始拖动编辑文字');
        // 拖动位置
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = parseInt(overlay.style.left) || 0;
        startTop = parseInt(overlay.style.top) || 0;
        overlay.classList.add('dragging');
        e.preventDefault();
        e.stopPropagation();
    });
    
    // 选中框的调整大小手柄
    selectionBox.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('resize-handle')) {
            console.log('开始调整编辑大小');
            isResizing = true;
            resizeHandle = e.target;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = parseInt(overlay.style.left) || 0;
            startTop = parseInt(overlay.style.top) || 0;
            startWidth = overlay.offsetWidth || 100;
            startHeight = overlay.offsetHeight || 50;
            
            console.log('调整编辑大小初始值:', {
                startLeft,
                startTop,
                startWidth,
                startHeight,
                centerX: startLeft + startWidth / 2,
                centerY: startTop + startHeight / 2
            });
            
            e.preventDefault();
            e.stopPropagation();
        }
    });
    
    document.addEventListener('mousemove', (e) => {
        // 检查overlay是否还在DOM中（可能在编辑模态框关闭后被移除）
        if (!overlay.parentElement) return;
        
        if (isDragging) {
            let deltaX = e.clientX - startX;
            let deltaY = e.clientY - startY;
            
            // Shift键：只允许水平或垂直移动
            if (isShiftPressed) {
                if (Math.abs(deltaX) > Math.abs(deltaY)) {
                    deltaY = 0;
                } else {
                    deltaX = 0;
                }
            }
            
            let newX = startLeft + deltaX;
            let newY = startTop + deltaY;
            
            // 居中吸附（使用编辑版本的snapToCenter）
            const snapped = editSnapToCenter(newX, newY, overlay);
            newX = snapped.x;
            newY = snapped.y;
            
            overlay.style.left = newX + 'px';
            overlay.style.top = newY + 'px';
            updateSelectionBox(overlay, selectionBox);
            updateEditControlValues(overlay);
        } else if (isResizing) {
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            const pos = resizeHandle.classList[1];
            
            // 计算当前文字的中心点（用于从中心缩放）
            const currentCenterX = startLeft + startWidth / 2;
            const currentCenterY = startTop + startHeight / 2;
            
            // 计算缩放比例（使用对角线距离）
            const startDistance = Math.sqrt(Math.pow(startWidth, 2) + Math.pow(startHeight, 2));
            const currentDistance = Math.sqrt(Math.pow(startWidth + deltaX, 2) + Math.pow(startHeight + deltaY, 2));
            const scale = currentDistance / startDistance;
            
            // 根据拖动的角确定缩放方向
            let widthScale = 1;
            let heightScale = 1;
            
            if (pos.includes('right') || pos.includes('left')) {
                widthScale = scale;
            }
            if (pos.includes('bottom') || pos.includes('top')) {
                heightScale = scale;
            }
            
            // 如果同时拖动水平和垂直方向，使用统一缩放
            if ((pos.includes('right') || pos.includes('left')) && (pos.includes('bottom') || pos.includes('top'))) {
                widthScale = scale;
                heightScale = scale;
            }
            
            let newWidth = Math.max(50, startWidth * widthScale);
            let newHeight = Math.max(30, startHeight * heightScale);
            
            // 从中心点计算新的位置（保持中心点不变）
            const newLeft = currentCenterX - newWidth / 2;
            const newTop = currentCenterY - newHeight / 2;
            
            // 先更新位置和尺寸
            overlay.style.left = newLeft + 'px';
            overlay.style.top = newTop + 'px';
            overlay.style.width = newWidth + 'px';
            overlay.style.height = newHeight + 'px';
            
            // 根据宽度调整字号（保持比例）
            const type = overlay.dataset.type;
            const currentFontSize = parseInt(overlay.style.fontSize) || (type === 'title' ? 60 : 40);
            const fontSizeScale = newWidth / startWidth;
            const newFontSize = Math.max(15, Math.min(200, currentFontSize * fontSizeScale));
            overlay.style.fontSize = newFontSize + 'px';
            
            // 更新选中框
            updateSelectionBox(overlay, selectionBox);
            
            // 更新控制面板（使用编辑版本的控件ID）
            if (type === 'title') {
                document.getElementById('editTitleSize').value = Math.round(newFontSize);
                document.getElementById('editTitleSizeValue').textContent = Math.round(newFontSize);
            } else {
                document.getElementById('editSubtitleSize').value = Math.round(newFontSize);
                document.getElementById('editSubtitleSizeValue').textContent = Math.round(newFontSize);
            }
        }
    });
    
    document.addEventListener('mouseup', () => {
        if (isDragging) {
            overlay.classList.remove('dragging');
            isDragging = false;
            editClearSnapIndicators();
            
            // 拖动结束时，更新固定中心点
            const type = overlay.dataset.type;
            const rect = overlay.getBoundingClientRect();
            const containerRect = overlay.parentElement.getBoundingClientRect();
            const currentLeft = rect.left - containerRect.left;
            const currentTop = rect.top - containerRect.top;
            const currentWidth = rect.width;
            const currentHeight = rect.height;
            if (type === 'title') {
                editTextElementCenters.title = {
                    x: currentLeft + currentWidth / 2,
                    y: currentTop + currentHeight / 2
                };
            } else if (type === 'subtitle') {
                editTextElementCenters.subtitle = {
                    x: currentLeft + currentWidth / 2,
                    y: currentTop + currentHeight / 2
                };
            }
        }
        if (isResizing) {
            isResizing = false;
            resizeHandle = null;
            
            // 调整大小结束时，更新固定中心点
            const type = overlay.dataset.type;
            const rect = overlay.getBoundingClientRect();
            const containerRect = overlay.parentElement.getBoundingClientRect();
            const currentLeft = rect.left - containerRect.left;
            const currentTop = rect.top - containerRect.top;
            const currentWidth = rect.width;
            const currentHeight = rect.height;
            if (type === 'title') {
                editTextElementCenters.title = {
                    x: currentLeft + currentWidth / 2,
                    y: currentTop + currentHeight / 2
                };
            } else if (type === 'subtitle') {
                editTextElementCenters.subtitle = {
                    x: currentLeft + currentWidth / 2,
                    y: currentTop + currentHeight / 2
                };
            }
        }
    });
    
    // 点击外部取消选中
    document.addEventListener('click', (e) => {
        if (overlay.parentElement && !overlay.contains(e.target) && !selectionBox.contains(e.target)) {
            overlay.classList.remove('selected');
            selectionBox.classList.remove('active');
        }
    });
}

function selectEditTextElement(overlay, selectionBox) {
    // 取消其他选中（只在编辑模态框内）
    const container = document.getElementById('editTextOverlayContainer');
    if (container) {
        container.querySelectorAll('.text-overlay').forEach(el => {
            el.classList.remove('selected');
        });
        container.querySelectorAll('.selection-box').forEach(box => {
            box.classList.remove('active');
        });
    }
    
    overlay.classList.add('selected');
    selectionBox.classList.add('active');
    updateSelectionBox(overlay, selectionBox);
    updateEditControlsFromElement(overlay);
}

function updateEditControlsFromElement(overlay) {
    const type = overlay.dataset.type;
    const left = parseInt(overlay.style.left) || 0;
    const top = parseInt(overlay.style.top) || 0;
    const fontSize = parseInt(overlay.style.fontSize) || (type === 'title' ? 60 : 40);
    const color = overlay.style.color || (type === 'title' ? '#FFFF00' : '#FFFFFF');
    
    if (type === 'title') {
        document.getElementById('editTitleX').value = left;
        document.getElementById('editTitleXValue').textContent = left;
        document.getElementById('editTitleY').value = top;
        document.getElementById('editTitleYValue').textContent = top;
        document.getElementById('editTitleSize').value = fontSize;
        document.getElementById('editTitleSizeValue').textContent = fontSize;
        document.getElementById('editTitleColor').value = rgbToHex(color);
    } else {
        document.getElementById('editSubtitleX').value = left;
        document.getElementById('editSubtitleXValue').textContent = left;
        document.getElementById('editSubtitleY').value = top;
        document.getElementById('editSubtitleYValue').textContent = top;
        document.getElementById('editSubtitleSize').value = fontSize;
        document.getElementById('editSubtitleSizeValue').textContent = fontSize;
        document.getElementById('editSubtitleColor').value = rgbToHex(color);
    }
}

function updateEditControlValues(overlay) {
    const type = overlay.dataset.type;
    const left = parseInt(overlay.style.left) || 0;
    const top = parseInt(overlay.style.top) || 0;
    
    if (type === 'title') {
        document.getElementById('editTitleX').value = left;
        document.getElementById('editTitleXValue').textContent = left;
        document.getElementById('editTitleY').value = top;
        document.getElementById('editTitleYValue').textContent = top;
    } else {
        document.getElementById('editSubtitleX').value = left;
        document.getElementById('editSubtitleXValue').textContent = left;
        document.getElementById('editSubtitleY').value = top;
        document.getElementById('editSubtitleYValue').textContent = top;
    }
}

function editSnapToCenter(x, y, element) {
    const elementWidth = element.offsetWidth;
    const elementHeight = element.offsetHeight;
    const centerX = x + elementWidth / 2;
    const centerY = y + elementHeight / 2;
    
    let snappedX = x;
    let snappedY = y;
    let showSnap = false;
    
    // 检查是否接近水平中心
    if (Math.abs(centerX - editImageCenter.x) < snapThreshold) {
        snappedX = editImageCenter.x - elementWidth / 2;
        showSnap = true;
        editShowSnapIndicator('vertical', editImageCenter.x);
    }
    
    // 检查是否接近垂直中心
    if (Math.abs(centerY - editImageCenter.y) < snapThreshold) {
        snappedY = editImageCenter.y - elementHeight / 2;
        showSnap = true;
        editShowSnapIndicator('horizontal', editImageCenter.y);
    }
    
    if (!showSnap) {
        editClearSnapIndicators();
    }
    
    return {x: snappedX, y: snappedY};
}

function editShowSnapIndicator(direction, position) {
    editClearSnapIndicators();
    const container = document.getElementById('editTextOverlayContainer');
    if (!container) return;
    
    const indicator = document.createElement('div');
    indicator.className = `snap-indicator ${direction}`;
    
    if (direction === 'vertical') {
        indicator.style.left = position + 'px';
        indicator.style.top = '0px';
        indicator.style.height = container.offsetHeight + 'px';
    } else {
        indicator.style.top = position + 'px';
        indicator.style.left = '0px';
        indicator.style.width = container.offsetWidth + 'px';
    }
    
    const snapContainer = document.getElementById('editSnapIndicators');
    if (snapContainer) {
        snapContainer.appendChild(indicator);
    }
}

function editClearSnapIndicators() {
    const snapContainer = document.getElementById('editSnapIndicators');
    if (snapContainer) {
        snapContainer.innerHTML = '';
    }
}

function updateEditTextOverlay(controlId) {
    // 完全照抄主预览区域的 updateTextOverlay 逻辑，只替换选择器和控件ID
    if (controlId.startsWith('editTitle')) {
        const overlay = document.querySelector('#editTextOverlayContainer .text-overlay-title');
        const selectionBox = document.querySelector('#editTextOverlayContainer .selection-box[data-overlay-id="title"]');
        if (overlay) {
            if (controlId === 'editTitleSize') {
                // 如果固定中心点还没有初始化，先初始化它（只在第一次调整字号时）
                if (!editTextElementCenters.title) {
                    const rect = overlay.getBoundingClientRect();
                    const containerRect = overlay.parentElement.getBoundingClientRect();
                    const currentLeft = rect.left - containerRect.left;
                    const currentTop = rect.top - containerRect.top;
                    const currentWidth = rect.width;
                    const currentHeight = rect.height;
                    const currentCenterX = currentLeft + currentWidth / 2;
                    const currentCenterY = currentTop + currentHeight / 2;
                    editTextElementCenters.title = {x: currentCenterX, y: currentCenterY};
                    console.log('字号调整时初始化编辑标题固定中心点:', editTextElementCenters.title);
                }
                
                // 始终使用固定的中心点（不再检查并更新，避免抖动）
                const centerX = editTextElementCenters.title.x;
                const centerY = editTextElementCenters.title.y;
                
                // 更新字号
                const size = parseInt(document.getElementById('editTitleSize').value);
                overlay.style.fontSize = size + 'px';
                
                // 使用 requestAnimationFrame 确保在渲染后计算
                requestAnimationFrame(() => {
                    // 再次获取更新后的尺寸
                    const newRect = overlay.getBoundingClientRect();
                    const newWidth = newRect.width;
                    const newHeight = newRect.height;
                    
                    // 从固定的中心点重新计算位置，保持中心点不变
                    const newLeft = centerX - newWidth / 2;
                    const newTop = centerY - newHeight / 2;
                    
                    overlay.style.left = newLeft + 'px';
                    overlay.style.top = newTop + 'px';
                    
                    // 更新控制面板的位置值
                    document.getElementById('editTitleX').value = Math.round(newLeft);
                    document.getElementById('editTitleXValue').textContent = Math.round(newLeft);
                    document.getElementById('editTitleY').value = Math.round(newTop);
                    document.getElementById('editTitleYValue').textContent = Math.round(newTop);
                    
                    // 更新选中框
                    if (selectionBox) {
                        updateSelectionBox(overlay, selectionBox);
                    }
                });
            } else if (controlId === 'editTitleStroke') {
                const stroke = parseInt(document.getElementById('editTitleStroke').value);
                overlay.style.textShadow = `
                    -${stroke}px -${stroke}px 0 #000,
                    ${stroke}px -${stroke}px 0 #000,
                    -${stroke}px ${stroke}px 0 #000,
                    ${stroke}px ${stroke}px 0 #000
                `;
            } else if (controlId === 'editTitleX') {
                const x = parseInt(document.getElementById('editTitleX').value);
                overlay.style.left = x + 'px';
                // 手动修改位置时，更新固定中心点
                const rect = overlay.getBoundingClientRect();
                const containerRect = overlay.parentElement.getBoundingClientRect();
                const currentLeft = rect.left - containerRect.left;
                const currentTop = rect.top - containerRect.top;
                const currentWidth = rect.width;
                const currentHeight = rect.height;
                editTextElementCenters.title = {
                    x: currentLeft + currentWidth / 2,
                    y: currentTop + currentHeight / 2
                };
            } else if (controlId === 'editTitleY') {
                const y = parseInt(document.getElementById('editTitleY').value);
                overlay.style.top = y + 'px';
                // 手动修改位置时，更新固定中心点
                const rect = overlay.getBoundingClientRect();
                const containerRect = overlay.parentElement.getBoundingClientRect();
                const currentLeft = rect.left - containerRect.left;
                const currentTop = rect.top - containerRect.top;
                const currentWidth = rect.width;
                const currentHeight = rect.height;
                editTextElementCenters.title = {
                    x: currentLeft + currentWidth / 2,
                    y: currentTop + currentHeight / 2
                };
            } else if (controlId === 'editTitleLineHeight') {
                const lineHeight = parseFloat(document.getElementById('editTitleLineHeight').value);
                overlay.style.lineHeight = lineHeight;
            }
            if (selectionBox) {
                updateSelectionBox(overlay, selectionBox);
            }
        }
    } else if (controlId.startsWith('editSubtitle')) {
        const overlay = document.querySelector('#editTextOverlayContainer .text-overlay-subtitle');
        const selectionBox = document.querySelector('#editTextOverlayContainer .selection-box[data-overlay-id="subtitle"]');
        if (overlay) {
            if (controlId === 'editSubtitleSize') {
                // 如果固定中心点还没有初始化，先初始化它（只在第一次调整字号时）
                if (!editTextElementCenters.subtitle) {
                    const rect = overlay.getBoundingClientRect();
                    const containerRect = overlay.parentElement.getBoundingClientRect();
                    const currentLeft = rect.left - containerRect.left;
                    const currentTop = rect.top - containerRect.top;
                    const currentWidth = rect.width;
                    const currentHeight = rect.height;
                    const currentCenterX = currentLeft + currentWidth / 2;
                    const currentCenterY = currentTop + currentHeight / 2;
                    editTextElementCenters.subtitle = {x: currentCenterX, y: currentCenterY};
                    console.log('字号调整时初始化编辑副标题固定中心点:', editTextElementCenters.subtitle);
                }
                
                // 始终使用固定的中心点（不再检查并更新，避免抖动）
                const centerX = editTextElementCenters.subtitle.x;
                const centerY = editTextElementCenters.subtitle.y;
                
                // 更新字号
                const size = parseInt(document.getElementById('editSubtitleSize').value);
                overlay.style.fontSize = size + 'px';
                
                // 使用 requestAnimationFrame 确保在渲染后计算
                requestAnimationFrame(() => {
                    // 再次获取更新后的尺寸
                    const newRect = overlay.getBoundingClientRect();
                    const newWidth = newRect.width;
                    const newHeight = newRect.height;
                    
                    // 从固定的中心点重新计算位置，保持中心点不变
                    const newLeft = centerX - newWidth / 2;
                    const newTop = centerY - newHeight / 2;
                    
                    overlay.style.left = newLeft + 'px';
                    overlay.style.top = newTop + 'px';
                    
                    // 更新控制面板的位置值
                    document.getElementById('editSubtitleX').value = Math.round(newLeft);
                    document.getElementById('editSubtitleXValue').textContent = Math.round(newLeft);
                    document.getElementById('editSubtitleY').value = Math.round(newTop);
                    document.getElementById('editSubtitleYValue').textContent = Math.round(newTop);
                    
                    // 更新选中框
                    if (selectionBox) {
                        updateSelectionBox(overlay, selectionBox);
                    }
                });
            } else if (controlId === 'editSubtitleStroke') {
                const stroke = parseInt(document.getElementById('editSubtitleStroke').value);
                overlay.style.textShadow = `
                    -${stroke}px -${stroke}px 0 #000,
                    ${stroke}px -${stroke}px 0 #000,
                    -${stroke}px ${stroke}px 0 #000,
                    ${stroke}px ${stroke}px 0 #000
                `;
            } else if (controlId === 'editSubtitleX') {
                const x = parseInt(document.getElementById('editSubtitleX').value);
                overlay.style.left = x + 'px';
                // 手动修改位置时，更新固定中心点
                const rect = overlay.getBoundingClientRect();
                const containerRect = overlay.parentElement.getBoundingClientRect();
                const currentLeft = rect.left - containerRect.left;
                const currentTop = rect.top - containerRect.top;
                const currentWidth = rect.width;
                const currentHeight = rect.height;
                editTextElementCenters.subtitle = {
                    x: currentLeft + currentWidth / 2,
                    y: currentTop + currentHeight / 2
                };
            } else if (controlId === 'editSubtitleY') {
                const y = parseInt(document.getElementById('editSubtitleY').value);
                overlay.style.top = y + 'px';
                // 手动修改位置时，更新固定中心点
                const rect = overlay.getBoundingClientRect();
                const containerRect = overlay.parentElement.getBoundingClientRect();
                const currentLeft = rect.left - containerRect.left;
                const currentTop = rect.top - containerRect.top;
                const currentWidth = rect.width;
                const currentHeight = rect.height;
                editTextElementCenters.subtitle = {
                    x: currentLeft + currentWidth / 2,
                    y: currentTop + currentHeight / 2
                };
            } else if (controlId === 'editSubtitleLineHeight') {
                const lineHeight = parseFloat(document.getElementById('editSubtitleLineHeight').value);
                overlay.style.lineHeight = lineHeight;
            }
            if (selectionBox) {
                updateSelectionBox(overlay, selectionBox);
            }
        }
    }
}

function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
    // 注意：不清除文字层，保留以便下次打开时能看到
    // 重置编辑相关的变量
    editTextElementCenters.title = null;
    editTextElementCenters.subtitle = null;
}

async function saveSingleEdit(filename) {
    if (!filename) {
        filename = currentEditImageData?.filename;
        if (!filename) {
            alert('缺少文件名');
            return;
        }
    }
    
    // 获取所有动态字段的配置
    const textFieldConfigs = [];
    const fieldTextareas = document.querySelectorAll('.edit-field-text');
    
    fieldTextareas.forEach(textarea => {
        const fieldId = textarea.dataset.fieldId;
        const fieldText = textarea.value || '';
        
        // 从控件中读取配置
        const fontSizeInput = document.querySelector(`.edit-field-size[data-field-id="${fieldId}"]`);
        const colorInput = document.querySelector(`.edit-field-color[data-field-id="${fieldId}"]`);
        const strokeInput = document.querySelector(`.edit-field-stroke[data-field-id="${fieldId}"]`);
        const lineHeightInput = document.querySelector(`.edit-field-line-height[data-field-id="${fieldId}"]`);
        const xInput = document.querySelector(`.edit-field-x[data-field-id="${fieldId}"]`);
        const yInput = document.querySelector(`.edit-field-y[data-field-id="${fieldId}"]`);
        
        // 从文字层获取实际位置和大小
        const overlay = document.querySelector(`#editTextOverlayContainer .text-overlay[data-field-id="${fieldId}"]`);
        
        let fieldConfig = {
            field_id: fieldId,
            field_name: document.querySelector(`.text-field-item[data-field-id="${fieldId}"] h3`)?.textContent || `字段${fieldId}`,
            template: '',  // 编辑模态框没有模板，使用直接文字
            font_size: fontSizeInput ? parseInt(fontSizeInput.value) : 60,
            color: colorInput ? colorInput.value : '#FFFF00',
            stroke_width: strokeInput ? parseInt(strokeInput.value) : 3,
            stroke_color: '#000000',
            line_height: lineHeightInput ? parseFloat(lineHeightInput.value) : 1.2,
            x: xInput ? parseInt(xInput.value) : 50,
            y: yInput ? parseInt(yInput.value) : 50
        };
        
        // 如果文字层存在，使用实际位置、大小、颜色和描边
        if (overlay) {
            // 获取左上角坐标
            const left = parseInt(overlay.style.left) || fieldConfig.x;
            const top = parseInt(overlay.style.top) || fieldConfig.y;
            
            // 获取文字的实际尺寸
            const rect = overlay.getBoundingClientRect();
            const textWidth = rect.width;
            const textHeight = rect.height;
            
            // 计算中心坐标
            const centerX = left + textWidth / 2;
            const centerY = top + textHeight / 2;
            
            // 传递中心坐标和尺寸
            fieldConfig.center_x = centerX;
            fieldConfig.center_y = centerY;
            fieldConfig.width = textWidth;
            fieldConfig.height = textHeight;
            fieldConfig.x = left;  // 保留左上角坐标作为备用
            fieldConfig.y = top;
            fieldConfig.font_size = parseInt(overlay.style.fontSize) || fieldConfig.font_size;
            
            // 从 overlay 获取颜色
            const overlayColor = overlay.style.color;
            if (overlayColor) {
                fieldConfig.color = rgbToHex(overlayColor);
            }
            // 从 textShadow 解析描边宽度
            const textShadow = overlay.style.textShadow;
            if (textShadow) {
                const strokeMatch = textShadow.match(/-(\d+)px/);
                if (strokeMatch) {
                    fieldConfig.stroke_width = parseInt(strokeMatch[1]);
                }
            }
        }
        
        // 保存字段文字内容（用于向后兼容）
        if (textFieldConfigs.length === 0) {
            currentEditImageData.title = fieldText;
        } else if (textFieldConfigs.length === 1) {
            currentEditImageData.subtitle = fieldText;
        }
        
        textFieldConfigs.push(fieldConfig);
    });
    
    // 向后兼容：保存title和subtitle（用于旧格式）
    const titleText = textFieldConfigs.length > 0 ? (currentEditImageData.title || '') : '';
    const subtitleText = textFieldConfigs.length > 1 ? (currentEditImageData.subtitle || '') : '';
    
    // 获取编辑模态框中的预览图片尺寸（用于缩放计算）
    const editPreviewImage = document.getElementById('editPreviewImage');
    let previewNaturalWidth = 0;
    let previewNaturalHeight = 0;
    let previewDisplayWidth = 0;
    let previewDisplayHeight = 0;
    
    if (editPreviewImage && editPreviewImage.complete) {
        previewNaturalWidth = editPreviewImage.naturalWidth || editImageSize.width;
        previewNaturalHeight = editPreviewImage.naturalHeight || editImageSize.height;
        previewDisplayWidth = editPreviewImage.offsetWidth || editImageSize.width;
        previewDisplayHeight = editPreviewImage.offsetHeight || editImageSize.height;
    } else {
        // 如果没有预览图片尺寸，使用编辑图片尺寸
        previewNaturalWidth = editImageSize.width;
        previewNaturalHeight = editImageSize.height;
        previewDisplayWidth = editImageSize.width;
        previewDisplayHeight = editImageSize.height;
    }
    
    // 保存预览尺寸到配置中，用于后续缩放计算
    textFieldConfigs.forEach(fieldConfig => {
        if (fieldConfig.center_x !== undefined) {
            fieldConfig.preview_size = {
                display_width: previewDisplayWidth,
                display_height: previewDisplayHeight,
                natural_width: previewNaturalWidth,
                natural_height: previewNaturalHeight
            };
        }
    });
    
    // 向后兼容：创建titleConfig和subtitleConfig
    const titleConfig = textFieldConfigs.length > 0 ? {
        font_size: textFieldConfigs[0].font_size,
        color: textFieldConfigs[0].color,
        stroke_width: textFieldConfigs[0].stroke_width,
        stroke_color: textFieldConfigs[0].stroke_color,
        x: textFieldConfigs[0].x,
        y: textFieldConfigs[0].y,
        center_x: textFieldConfigs[0].center_x,
        center_y: textFieldConfigs[0].center_y,
        width: textFieldConfigs[0].width,
        height: textFieldConfigs[0].height
    } : {};
    
    const subtitleConfig = textFieldConfigs.length > 1 ? {
        font_size: textFieldConfigs[1].font_size,
        color: textFieldConfigs[1].color,
        stroke_width: textFieldConfigs[1].stroke_width,
        stroke_color: textFieldConfigs[1].stroke_color,
        x: textFieldConfigs[1].x,
        y: textFieldConfigs[1].y,
        center_x: textFieldConfigs[1].center_x,
        center_y: textFieldConfigs[1].center_y,
        width: textFieldConfigs[1].width,
        height: textFieldConfigs[1].height
    } : {};
    
    const originalData = imageDataMap[filename] || {};
    
    // 尝试获取原始文件路径
    let original_filepath = originalData.original_filepath;
    
    // 如果 imageDataMap 中没有，尝试从 uploadedImages 中查找
    if (!original_filepath) {
        const albumId = originalData.album_id || currentEditImageData?.album_id;
        if (albumId) {
            const originalImg = uploadedImages.find(u => u.album_id === albumId);
            if (originalImg && originalImg.filepath) {
                original_filepath = originalImg.filepath;
            }
        }
    }
    
    // 如果还是没有，尝试从 currentEditImageData 获取
    if (!original_filepath && currentEditImageData) {
        const originalFilename = currentEditImageData.original_filename;
        if (originalFilename) {
            // 假设原始文件在 UPLOAD_FOLDER 中
            original_filepath = originalFilename; // 后端会处理路径查找
        }
    }
    
    console.log('保存单张编辑:', {
        filename,
        original_filepath,
        titleText,
        subtitleText,
        titleConfig,
        subtitleConfig
    });
    
    try {
        const response = await fetch('/api/edit-text-single', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filename: filename,
                original_filepath: original_filepath,
                title_text: titleText,
                subtitle_text: subtitleText,
                title_config: titleConfig,
                subtitle_config: subtitleConfig,
                preview_size: {
                    natural_width: previewNaturalWidth,
                    natural_height: previewNaturalHeight,
                    display_width: previewDisplayWidth,
                    display_height: previewDisplayHeight
                }
            })
        });
        
        const data = await response.json();
        
        console.log('保存响应:', data);
        
        if (data.success) {
            // 更新 imageDataMap 中的文字内容
            if (imageDataMap[filename]) {
                imageDataMap[filename].title = titleText;
                imageDataMap[filename].subtitle = subtitleText;
                // 保存位置和样式配置，以便下次打开时恢复（使用新的 text_fields 格式）
                imageDataMap[filename].text_fields = textFieldConfigs;
                imageDataMap[filename].preview_size = {
                    natural_width: previewNaturalWidth,
                    natural_height: previewNaturalHeight,
                    display_width: previewDisplayWidth,
                    display_height: previewDisplayHeight
                };
                // 向后兼容：也保存旧的格式
                if (textFieldConfigs.length > 0) {
                    imageDataMap[filename].title_config = titleConfig;
                }
                if (textFieldConfigs.length > 1) {
                    imageDataMap[filename].subtitle_config = subtitleConfig;
                }
            } else {
                imageDataMap[filename] = {
                    title: titleText,
                    subtitle: subtitleText,
                    text_fields: textFieldConfigs,  // 使用新的 text_fields 格式
                    preview_size: {
                        natural_width: previewNaturalWidth,
                        natural_height: previewNaturalHeight,
                        display_width: previewDisplayWidth,
                        display_height: previewDisplayHeight
                    },
                    title_config: textFieldConfigs.length > 0 ? titleConfig : {},  // 向后兼容
                    subtitle_config: textFieldConfigs.length > 1 ? subtitleConfig : {},  // 向后兼容
                    original_filepath: original_filepath,
                    album_id: originalData.album_id || currentEditImageData?.album_id,
                    processed_filename: filename,
                    csv_data: originalData.csv_data || currentEditImageData?.csv_data || {}
                };
            }
            
            alert('修改成功！');
            closeEditModal();
            // 延迟刷新列表，确保文件已保存，并清除图片缓存
            setTimeout(() => {
                loadGallery();  // 刷新列表（会自动添加时间戳）
            }, 100);
        } else {
            console.error('保存失败:', data.error);
            alert('保存失败：' + data.error);
        }
    } catch (error) {
        console.error('保存错误：', error);
        alert('保存失败：' + error.message);
    }
}

function refreshGallery() {
    loadGallery();
}

async function batchSaveAll() {
    try {
        const response = await fetch('/api/download-all-text');
        const blob = await response.blob();
        
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'text_overlay_images.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        alert('批量下载成功！');
    } catch (error) {
        console.error('下载错误：', error);
        alert('下载失败：' + error.message);
    }
}

// ==================== 动态文字字段管理 ====================

// 添加文字字段
function addTextField(name, template) {
    const fieldId = `field_${textFieldCounter++}`;
    const field = {
        id: fieldId,
        name: name,
        template: template,
        fontSize: 60,
        colors: ['#FFFF00'],  // 改为数组，支持多个颜色
        strokeWidth: 3,
        strokeColor: '#000000',
        lineHeight: 1.2,
        x: 50,
        y: 50,
        center_x: null,
        center_y: null,
        width: null,
        height: null
    };
    textFields.push(field);
    return field;
}

// 删除文字字段
function removeTextField(fieldId) {
    const index = textFields.findIndex(f => f.id === fieldId);
    if (index !== -1) {
        textFields.splice(index, 1);
        renderTextFields();
        // 重新创建文字层
        if (currentSampleImage) {
            createTextOverlays();
        }
    }
}

// 渲染文字字段UI
function renderTextFields() {
    const container = document.getElementById('textFieldsContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    textFields.forEach((field, index) => {
        const fieldDiv = document.createElement('div');
        fieldDiv.className = 'text-field-item';
        fieldDiv.dataset.fieldId = field.id;
        
        fieldDiv.innerHTML = `
            <div class="text-field-header">
                <h4>${field.name}</h4>
                <button class="text-field-remove" onclick="removeTextField('${field.id}')">删除</button>
            </div>
            <div class="control-group">
                <label>文字模板：</label>
                <div class="text-template-editor">
                    <textarea class="text-template-input" id="template_${field.id}" placeholder="输入文字模板，点击下方按钮插入CSV字段">${field.template}</textarea>
                    <button class="insert-field-btn" onclick="showCSVFieldSelector('${field.id}', this)">插入CSV字段</button>
                </div>
            </div>
            <div class="control-row">
                <div class="control-item">
                    <label>字号：<span class="range-value" id="fontSizeValue_${field.id}">${field.fontSize}</span>px</label>
                    <input type="range" id="fontSize_${field.id}" min="20" max="200" value="${field.fontSize}">
                </div>
                <div class="control-item">
                    <label>行间距：<span class="range-value" id="lineHeightValue_${field.id}">${field.lineHeight}</span></label>
                    <input type="range" id="lineHeight_${field.id}" min="0.8" max="3" step="0.1" value="${field.lineHeight}">
                </div>
                <div class="control-item" style="flex: 1 1 100%;">
                    <label>颜色（可添加多个，批量应用时随机分配）：</label>
                    <div id="colorsContainer_${field.id}" style="display: flex; flex-wrap: wrap; gap: 10px; margin-top: 5px;">
                        ${(field.colors || (field.color ? [field.color] : ['#FFFF00'])).map((color, colorIndex) => `
                            <div style="display: flex; align-items: center; gap: 5px;">
                                <input type="color" id="color_${field.id}_${colorIndex}" value="${color}" style="width: 50px; height: 40px; cursor: pointer;" data-color-index="${colorIndex}">
                                ${colorIndex > 0 && (field.colors || (field.color ? [field.color] : ['#FFFF00'])).length > 1 ? `<button type="button" onclick="removeColorFromField('${field.id}', ${colorIndex})" style="padding: 5px 10px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">×</button>` : ''}
                                ${colorIndex === (field.colors || (field.color ? [field.color] : ['#FFFF00'])).length - 1 ? `<button type="button" onclick="addColorToField('${field.id}')" style="padding: 5px 10px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;">+</button>` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="control-item">
                    <label>描边粗细：<span class="range-value" id="strokeValue_${field.id}">${field.strokeWidth}</span>px</label>
                    <input type="range" id="stroke_${field.id}" min="0" max="10" value="${field.strokeWidth}">
                </div>
                <div class="control-item">
                    <label>X位置：<span class="range-value" id="xValue_${field.id}">${field.x}</span>px</label>
                    <input type="range" id="x_${field.id}" min="0" max="1000" value="${field.x}">
                </div>
                <div class="control-item">
                    <label>Y位置：<span class="range-value" id="yValue_${field.id}">${field.y}</span>px</label>
                    <input type="range" id="y_${field.id}" min="0" max="1000" value="${field.y}">
                </div>
            </div>
        `;
        
        container.appendChild(fieldDiv);
        
        // 绑定事件监听器
        setupTextFieldListeners(field.id);
    });
}

// 添加颜色到字段
function addColorToField(fieldId) {
    const field = textFields.find(f => f.id === fieldId);
    if (field) {
        field.colors.push('#FFFF00');  // 默认添加黄色
        renderTextFields();
        if (currentSampleImage) {
            createTextOverlays();
        }
    }
}

// 从字段移除颜色
function removeColorFromField(fieldId, colorIndex) {
    const field = textFields.find(f => f.id === fieldId);
    // 禁止删除第一个颜色（colorIndex === 0）
    if (field && field.colors.length > 1 && colorIndex > 0) {
        field.colors.splice(colorIndex, 1);
        renderTextFields();
        if (currentSampleImage) {
            createTextOverlays();
        }
    }
}

// 设置文字字段的事件监听器
function setupTextFieldListeners(fieldId) {
    const field = textFields.find(f => f.id === fieldId);
    if (!field) return;
    
    // 模板输入
    const templateInput = document.getElementById(`template_${fieldId}`);
    if (templateInput) {
        templateInput.addEventListener('input', (e) => {
            field.template = e.target.value;
            if (currentSampleImage) {
                createTextOverlays();
            }
        });
    }
    
    // 字号
    const fontSizeInput = document.getElementById(`fontSize_${fieldId}`);
    const fontSizeValue = document.getElementById(`fontSizeValue_${fieldId}`);
    if (fontSizeInput && fontSizeValue) {
        fontSizeInput.addEventListener('input', (e) => {
            field.fontSize = parseInt(e.target.value);
            fontSizeValue.textContent = field.fontSize;
            updateTextFieldOverlay(fieldId);
        });
    }
    
    // 行间距
    const lineHeightInput = document.getElementById(`lineHeight_${fieldId}`);
    const lineHeightValue = document.getElementById(`lineHeightValue_${fieldId}`);
    if (lineHeightInput && lineHeightValue) {
        lineHeightInput.addEventListener('input', (e) => {
            field.lineHeight = parseFloat(e.target.value);
            lineHeightValue.textContent = field.lineHeight;
            updateTextFieldOverlay(fieldId);
        });
    }
    
    // 颜色（支持多个）
    const colors = field.colors || (field.color ? [field.color] : ['#FFFF00']);
    // 确保field.colors存在
    if (!field.colors) {
        field.colors = colors;
    }
    colors.forEach((color, colorIndex) => {
        const colorInput = document.getElementById(`color_${fieldId}_${colorIndex}`);
        if (colorInput) {
            colorInput.addEventListener('input', (e) => {
                field.colors[colorIndex] = e.target.value;
                // 如果是第一个颜色，立即更新预览并同步到field.color（向后兼容）
                if (colorIndex === 0) {
                    field.color = e.target.value;  // 向后兼容
                    updateTextFieldOverlay(fieldId);
                }
            });
        }
    });
    
    // 描边
    const strokeInput = document.getElementById(`stroke_${fieldId}`);
    const strokeValue = document.getElementById(`strokeValue_${fieldId}`);
    if (strokeInput && strokeValue) {
        strokeInput.addEventListener('input', (e) => {
            field.strokeWidth = parseInt(e.target.value);
            strokeValue.textContent = field.strokeWidth;
            updateTextFieldOverlay(fieldId);
        });
    }
    
    // X位置
    const xInput = document.getElementById(`x_${fieldId}`);
    const xValue = document.getElementById(`xValue_${fieldId}`);
    if (xInput && xValue) {
        xInput.addEventListener('input', (e) => {
            field.x = parseInt(e.target.value);
            xValue.textContent = field.x;
            updateTextFieldOverlay(fieldId);
        });
    }
    
    // Y位置
    const yInput = document.getElementById(`y_${fieldId}`);
    const yValue = document.getElementById(`yValue_${fieldId}`);
    if (yInput && yValue) {
        yInput.addEventListener('input', (e) => {
            field.y = parseInt(e.target.value);
            yValue.textContent = field.y;
            updateTextFieldOverlay(fieldId);
        });
    }
}

// 存储当前弹窗的按钮引用和更新函数
let currentSelectorButton = null;
let selectorUpdateInterval = null;

// 更新弹窗位置的函数
function updateSelectorPosition(selector, buttonElement) {
    if (!selector || !buttonElement || !document.body.contains(selector)) {
        return;
    }
    
    const buttonRect = buttonElement.getBoundingClientRect();
    
    // 更新弹窗位置
    selector.style.left = buttonRect.left + 'px';
    selector.style.top = (buttonRect.bottom + 5) + 'px';
    
    // 检查是否会超出视口边界并调整位置
    const selectorRect = selector.getBoundingClientRect();
    
    // 如果超出右边界，调整到按钮左侧
    if (selectorRect.right > window.innerWidth) {
        selector.style.left = (buttonRect.left - selector.offsetWidth) + 'px';
    }
    // 如果超出下边界，显示在按钮上方
    if (selectorRect.bottom > window.innerHeight) {
        selector.style.top = (buttonRect.top - selector.offsetHeight - 5) + 'px';
    }
    // 如果超出左边界，确保至少显示一部分
    if (selectorRect.left < 0) {
        selector.style.left = '10px';
    }
    // 如果超出上边界，确保至少显示一部分
    if (selectorRect.top < 0) {
        selector.style.top = '10px';
    }
}

// 显示CSV字段选择器
function showCSVFieldSelector(fieldId, buttonElement) {
    // 先关闭可能已存在的弹窗
    const existingSelector = document.getElementById('csvFieldSelector');
    if (existingSelector) {
        existingSelector.remove();
        // 清除之前的更新定时器
        if (selectorUpdateInterval) {
            clearInterval(selectorUpdateInterval);
            selectorUpdateInterval = null;
        }
        currentSelectorButton = null;
    }
    
    // 创建新的弹窗元素
    const selector = document.createElement('div');
    selector.id = 'csvFieldSelector';
    selector.style.cssText = 'position: fixed; background: white; border: 1px solid #ddd; border-radius: 4px; padding: 10px; z-index: 10000; max-height: 200px; overflow-y: auto; box-shadow: 0 2px 8px rgba(0,0,0,0.1); min-width: 200px; max-width: 300px;';
    
    const fieldsList = document.createElement('div');
    fieldsList.id = 'csvFieldsList';
    selector.appendChild(fieldsList);
    
    // 添加标题
    const title = document.createElement('div');
    title.style.cssText = 'font-weight: bold; margin-bottom: 10px;';
    title.textContent = '选择CSV字段：';
    selector.insertBefore(title, fieldsList);
    
    fieldsList.innerHTML = '';
    
    if (csvColumns.length === 0) {
        fieldsList.innerHTML = '<div style="padding: 10px; color: #999;">暂无CSV字段，请先上传CSV文件</div>';
    } else {
        csvColumns.forEach(column => {
            const item = document.createElement('div');
            item.className = 'csv-field-item';
            item.textContent = column;
            item.onclick = () => {
                insertCSVField(fieldId, column);
                selector.remove();
                // 清除更新定时器
                if (selectorUpdateInterval) {
                    clearInterval(selectorUpdateInterval);
                    selectorUpdateInterval = null;
                }
                currentSelectorButton = null;
            };
            fieldsList.appendChild(item);
        });
    }
    
    // 定位选择器到按钮旁边（使用fixed定位，避免被父容器裁剪）
    if (buttonElement) {
        // 将弹窗添加到body，使用fixed定位
        document.body.appendChild(selector);
        
        // 保存按钮引用
        currentSelectorButton = buttonElement;
        
        // 初始定位
        updateSelectorPosition(selector, buttonElement);
        selector.style.display = 'block';
        
        // 添加滚动监听，更新弹窗位置
        const scrollHandler = () => {
            updateSelectorPosition(selector, buttonElement);
        };
        
        // 监听窗口滚动
        window.addEventListener('scroll', scrollHandler, true);
        
        // 监听容器滚动（control-panel-wrapper）
        const controlPanelWrapper = buttonElement.closest('.control-panel-wrapper');
        if (controlPanelWrapper) {
            controlPanelWrapper.addEventListener('scroll', scrollHandler, true);
        }
        
        // 使用定时器定期更新位置（作为备用方案，处理动态变化）
        selectorUpdateInterval = setInterval(() => {
            if (document.body.contains(selector) && document.body.contains(buttonElement)) {
                updateSelectorPosition(selector, buttonElement);
            } else {
                // 如果元素已不存在，清除定时器
                clearInterval(selectorUpdateInterval);
                selectorUpdateInterval = null;
                currentSelectorButton = null;
            }
        }, 100);
        
        // 保存清理函数到selector元素上
        selector._cleanup = () => {
            window.removeEventListener('scroll', scrollHandler, true);
            if (controlPanelWrapper) {
                controlPanelWrapper.removeEventListener('scroll', scrollHandler, true);
            }
            if (selectorUpdateInterval) {
                clearInterval(selectorUpdateInterval);
                selectorUpdateInterval = null;
            }
            currentSelectorButton = null;
        };
    } else {
        // 如果没有按钮元素，使用原来的逻辑（基于文本输入框）
        const templateInput = document.getElementById(`template_${fieldId}`);
        if (templateInput) {
            document.body.appendChild(selector);
            const inputRect = templateInput.getBoundingClientRect();
            selector.style.position = 'fixed';
            selector.style.left = inputRect.left + 'px';
            selector.style.top = (inputRect.bottom + 5) + 'px';
            selector.style.display = 'block';
        }
    }
    
    // 点击外部关闭弹窗
    setTimeout(() => {
        const closeHandler = (e) => {
            if (!selector.contains(e.target) && e.target !== buttonElement && !buttonElement.contains(e.target)) {
                selector.remove();
                // 执行清理
                if (selector._cleanup) {
                    selector._cleanup();
                }
                document.removeEventListener('click', closeHandler);
            }
        };
        // 延迟添加事件监听，避免立即触发
        setTimeout(() => {
            document.addEventListener('click', closeHandler);
        }, 100);
    }, 0);
}

// 插入CSV字段到模板
function insertCSVField(fieldId, columnName) {
    const templateInput = document.getElementById(`template_${fieldId}`);
    if (!templateInput) return;
    
    const field = textFields.find(f => f.id === fieldId);
    if (!field) return;
    
    const placeholder = `【${columnName}】`;
    const cursorPos = templateInput.selectionStart;
    const textBefore = field.template.substring(0, cursorPos);
    const textAfter = field.template.substring(cursorPos);
    
    field.template = textBefore + placeholder + textAfter;
    templateInput.value = field.template;
    
    // 设置光标位置
    setTimeout(() => {
        templateInput.focus();
        templateInput.setSelectionRange(cursorPos + placeholder.length, cursorPos + placeholder.length);
    }, 0);
    
    // 更新文字层
    if (currentSampleImage) {
        createTextOverlays();
    }
}

// 更新文字字段的覆盖层（支持中心缩放逻辑）
function updateTextFieldOverlay(fieldId) {
    const field = textFields.find(f => f.id === fieldId);
    if (!field) return;
    
    const overlay = document.querySelector(`[data-field-id="${fieldId}"]`);
    if (!overlay) return;
    
    // 获取当前中心点
    const rect = overlay.getBoundingClientRect();
    const containerRect = overlay.parentElement.getBoundingClientRect();
    const currentLeft = rect.left - containerRect.left;
    const currentTop = rect.top - containerRect.top;
    const currentWidth = rect.width;
    const currentHeight = rect.height;
    const currentCenterX = currentLeft + currentWidth / 2;
    const currentCenterY = currentTop + currentHeight / 2;
    
    // 保存当前字号（用于判断是否变化）
    const oldFontSize = parseInt(overlay.style.fontSize) || field.fontSize;
    const newFontSize = field.fontSize;
    const isFontSizeChanged = oldFontSize !== newFontSize;
    
    // 如果固定中心点不存在，或者当前位置与固定中心点差距较大（说明被手动移动过），则更新固定中心点
    // 但如果只是字号变化，不应该更新中心点（要保持中心缩放）
    if (!fieldElementCenters[fieldId]) {
        // 第一次初始化中心点
        fieldElementCenters[fieldId] = {x: currentCenterX, y: currentCenterY};
    } else if (!isFontSizeChanged && 
               (Math.abs(fieldElementCenters[fieldId].x - currentCenterX) > 5 || 
                Math.abs(fieldElementCenters[fieldId].y - currentCenterY) > 5)) {
        // 如果不是字号变化，且位置变化较大，说明被手动移动过，更新中心点
        fieldElementCenters[fieldId] = {x: currentCenterX, y: currentCenterY};
    }
    
    // 使用固定的中心点
    const centerX = fieldElementCenters[fieldId].x;
    const centerY = fieldElementCenters[fieldId].y;
    
    // 更新样式
    overlay.style.fontSize = field.fontSize + 'px';
    // 使用第一个颜色作为预览颜色
    const previewColor = (field.colors && field.colors.length > 0) ? field.colors[0] : (field.color || '#FFFF00');
    overlay.style.color = previewColor;
    overlay.style.lineHeight = field.lineHeight;
    overlay.style.textShadow = `
        -${field.strokeWidth}px -${field.strokeWidth}px 0 #000,
        ${field.strokeWidth}px -${field.strokeWidth}px 0 #000,
        -${field.strokeWidth}px ${field.strokeWidth}px 0 #000,
        ${field.strokeWidth}px ${field.strokeWidth}px 0 #000
    `;
    
    // 如果是字号变化，使用中心缩放逻辑
    if (isFontSizeChanged) {
        // 先设置字号，然后等待渲染后计算新尺寸
        requestAnimationFrame(() => {
            const newRect = overlay.getBoundingClientRect();
            const newWidth = newRect.width;
            const newHeight = newRect.height;
            
            // 从固定的中心点重新计算位置，保持中心点不变
            const newLeft = centerX - newWidth / 2;
            const newTop = centerY - newHeight / 2;
            
            overlay.style.left = newLeft + 'px';
            overlay.style.top = newTop + 'px';
            
            // 更新字段配置和控制面板
            field.x = newLeft;
            field.y = newTop;
            field.center_x = centerX;
            field.center_y = centerY;
            field.width = newWidth;
            field.height = newHeight;
            
            const xInput = document.getElementById(`x_${fieldId}`);
            const xValue = document.getElementById(`xValue_${fieldId}`);
            const yInput = document.getElementById(`y_${fieldId}`);
            const yValue = document.getElementById(`yValue_${fieldId}`);
            if (xInput) xInput.value = Math.round(newLeft);
            if (xValue) xValue.textContent = Math.round(newLeft);
            if (yInput) yInput.value = Math.round(newTop);
            if (yValue) yValue.textContent = Math.round(newTop);
            
            // 更新选中框
            const selectionBox = document.querySelector(`.selection-box[data-field-id="${fieldId}"]`);
            if (selectionBox) {
                updateSelectionBox(overlay, selectionBox);
            }
        });
    } else {
        // 其他属性变化，直接更新位置
        overlay.style.left = field.x + 'px';
        overlay.style.top = field.y + 'px';
        
        // 更新选中框
        const selectionBox = document.querySelector(`.selection-box[data-field-id="${fieldId}"]`);
        if (selectionBox) {
            updateSelectionBox(overlay, selectionBox);
        }
    }
}

// 解析文字模板，替换【字段名】为实际值
function parseTextTemplate(template, csvData) {
    if (!template || !csvData) return template || '';
    
    let result = template;
    // 匹配【字段名】格式
    const regex = /【([^】]+)】/g;
    result = result.replace(regex, (match, fieldName) => {
        const value = csvData[fieldName];
        return value !== undefined && value !== null ? String(value) : match;
    });
    
    return result;
}

// 创建文字字段元素（支持动态字段配置）
function createTextFieldElement(fieldId, text, fieldConfig) {
    const overlay = document.createElement('div');
    overlay.className = `text-overlay text-overlay-field`;
    overlay.dataset.type = 'field';
    overlay.dataset.fieldId = fieldId;
    
    const fontSize = fieldConfig.fontSize || 60;
    // 使用第一个颜色作为默认显示颜色
    const colors = fieldConfig.colors || (fieldConfig.color ? [fieldConfig.color] : ['#FFFF00']);
    const color = colors[0];  // 默认使用第一个颜色
    const strokeWidth = fieldConfig.strokeWidth || 3;
    const lineHeight = fieldConfig.lineHeight || 1.2;
    const x = fieldConfig.x || 50;
    const y = fieldConfig.y || 50;
    
    // 检查文字是否包含换行符
    const hasLineBreaks = text.includes('\n');
    
    // 计算默认居中位置（如果x或y为默认值，则居中）
    const container = document.getElementById('textOverlayContainer');
    let containerWidth = container ? container.offsetWidth : imageSize.width;
    let containerHeight = container ? container.offsetHeight : imageSize.height;
    
    // 如果容器尺寸为0，使用图片尺寸
    if (containerWidth === 0 || containerHeight === 0) {
        const previewImage = document.getElementById('previewImage');
        if (previewImage && previewImage.complete) {
            containerWidth = previewImage.offsetWidth || previewImage.naturalWidth;
            containerHeight = previewImage.offsetHeight || previewImage.naturalHeight;
        }
    }
    
    // 临时创建元素来测量文字尺寸
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'absolute';
    tempDiv.style.visibility = 'hidden';
    tempDiv.style.fontSize = fontSize + 'px';
    tempDiv.style.fontWeight = 'bold';
    tempDiv.style.whiteSpace = hasLineBreaks ? 'pre-wrap' : 'nowrap';
    tempDiv.style.lineHeight = lineHeight;
    tempDiv.style.width = 'auto';
    tempDiv.style.height = 'auto';
    tempDiv.textContent = text;
    document.body.appendChild(tempDiv);
    const textWidth = Math.max(tempDiv.offsetWidth, 100);
    const textHeight = Math.max(tempDiv.offsetHeight, 30);
    document.body.removeChild(tempDiv);
    
    // 计算位置（如果使用默认值，则居中）
    let finalX = x;
    let finalY = y;
    if (x === 50 && y === 50) {
        // 使用默认值，居中显示
        finalX = Math.max(0, (containerWidth - textWidth) / 2);
        finalY = Math.max(0, (containerHeight - textHeight) / 2);
    }
    
    // 设置样式
    overlay.style.position = 'absolute';
    overlay.style.left = finalX + 'px';
    overlay.style.top = finalY + 'px';
    overlay.style.fontSize = fontSize + 'px';
    overlay.style.color = color;
    overlay.style.lineHeight = lineHeight;
    overlay.style.textShadow = `
        -${strokeWidth}px -${strokeWidth}px 0 #000,
        ${strokeWidth}px -${strokeWidth}px 0 #000,
        -${strokeWidth}px ${strokeWidth}px 0 #000,
        ${strokeWidth}px ${strokeWidth}px 0 #000
    `;
    overlay.style.fontWeight = 'bold';
    overlay.style.whiteSpace = hasLineBreaks ? 'pre-wrap' : 'nowrap';
    overlay.style.overflow = 'visible';
    overlay.style.zIndex = '10';
    overlay.style.pointerEvents = 'auto';
    if (hasLineBreaks) {
        overlay.style.textAlign = 'center';
    }
    overlay.textContent = text;
    
    // 创建选中框
    const selectionBox = document.createElement('div');
    selectionBox.className = 'selection-box';
    selectionBox.dataset.type = 'field';
    selectionBox.dataset.fieldId = fieldId;
    selectionBox.dataset.overlayId = fieldId;
    
    // 添加调整大小的手柄
    const handles = ['nw', 'ne', 'sw', 'se'];
    handles.forEach(handle => {
        const handleEl = document.createElement('div');
        handleEl.className = `resize-handle resize-handle-${handle}`;
        handleEl.dataset.handle = handle;
        selectionBox.appendChild(handleEl);
    });
    
    // 添加拖动和调整大小事件
    setupTextFieldInteraction(overlay, selectionBox, fieldId);
    
    return {overlay, selectionBox};
}

// 设置文字字段的交互（拖动、调整大小等）
function setupTextFieldInteraction(overlay, selectionBox, fieldId) {
    // 使用原有的拖动和调整大小逻辑
    setupDragAndResize(overlay, selectionBox);
}
