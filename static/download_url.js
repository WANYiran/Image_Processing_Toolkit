const API_BASE = '/api';
let currentImages = [];
let selectedImages = new Set();
let csvColumns = [];
let csvData = [];  // 保存完整的CSV数据

// 初始化
document.getElementById('csvFile').addEventListener('change', handleFileSelect);

// 处理文件选择
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    uploadCSV(file);
}

// 上传 CSV
async function uploadCSV(file) {
    const formData = new FormData();
    formData.append('file', file);
    
    showToast('上传 CSV 文件中...', 'info');
    
    try {
        const response = await fetch(`${API_BASE}/upload-csv`, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            csvColumns = data.columns || [];
            csvData = data.csv_data || [];  // 保存完整的CSV数据
            selectedImages.clear();
            
            document.getElementById('fileName').textContent = file.name;
            document.getElementById('fileInfo').style.display = 'block';
            document.getElementById('controlPanel').style.display = 'block';
            document.getElementById('urlListSection').style.display = 'block';
            
            // 更新列选择器
            updateColumnSelectors();
            
            // 根据选择的列更新图片列表
            updateImagesFromColumns();
            
            updateStats();
            loadUrlList();
            showToast(`成功加载 ${data.total} 条数据`, 'success');
        } else {
            showToast(data.error || '上传失败', 'error');
        }
    } catch (error) {
        showToast('上传失败: ' + error.message, 'error');
    }
}

// 加载 URL 列表
function loadUrlList() {
    const tbody = document.getElementById('urlListBody');
    tbody.innerHTML = '';
    
    currentImages.forEach((img, index) => {
        const row = document.createElement('tr');
        row.className = selectedImages.has(index) ? 'selected' : '';
        row.innerHTML = `
            <td>
                <input type="checkbox" 
                       data-index="${index}" 
                       ${selectedImages.has(index) ? 'checked' : ''}
                       onchange="toggleSelect(${index})">
            </td>
            <td>${img.album_id}</td>
            <td>
                <a href="${img.url}" target="_blank" class="url-link">${img.url}</a>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// 切换选择
function toggleSelect(index) {
    const checkbox = document.querySelector(`input[data-index="${index}"]`);
    if (checkbox.checked) {
        selectedImages.add(index);
    } else {
        selectedImages.delete(index);
    }
    
    updateRowSelection(index);
    updateStats();
    updateSelectAllCheckbox();
}

// 更新行选择状态
function updateRowSelection(index) {
    const row = document.querySelector(`tr:has(input[data-index="${index}"])`);
    if (row) {
        if (selectedImages.has(index)) {
            row.classList.add('selected');
        } else {
            row.classList.remove('selected');
        }
    }
}

// 全选/取消全选
function selectAll() {
    currentImages.forEach((_, index) => {
        selectedImages.add(index);
        const checkbox = document.querySelector(`input[data-index="${index}"]`);
        if (checkbox) checkbox.checked = true;
        updateRowSelection(index);
    });
    updateStats();
    updateSelectAllCheckbox();
}

function deselectAll() {
    selectedImages.clear();
    currentImages.forEach((_, index) => {
        const checkbox = document.querySelector(`input[data-index="${index}"]`);
        if (checkbox) checkbox.checked = false;
        updateRowSelection(index);
    });
    updateStats();
    updateSelectAllCheckbox();
}

// 切换全选复选框
function toggleSelectAll(checkbox) {
    if (checkbox.checked) {
        selectAll();
    } else {
        deselectAll();
    }
}

// 更新全选复选框状态
function updateSelectAllCheckbox() {
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = selectedImages.size === currentImages.length && currentImages.length > 0;
    }
}

// 更新统计
function updateStats() {
    document.getElementById('totalCount').textContent = currentImages.length;
    document.getElementById('selectedCount').textContent = selectedImages.size;
    
    const downloadBtn = document.getElementById('downloadBtn');
    downloadBtn.disabled = selectedImages.size === 0;
}

// 下载选中图片
async function downloadSelected() {
    if (selectedImages.size === 0) {
        showToast('请先选择要下载的链接', 'error');
        return;
    }
    
    let directoryHandle = null;
    try {
        if ('showDirectoryPicker' in window) {
            directoryHandle = await window.showDirectoryPicker();
        } else {
            showToast('您的浏览器不支持文件夹选择，将使用下载方式', 'info');
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            showToast('已取消文件夹选择，将使用下载方式', 'info');
        } else {
            showToast('选择文件夹失败: ' + error.message + '，将使用下载方式', 'info');
        }
    }
    
    const imagesToDownload = Array.from(selectedImages).map(index => currentImages[index]);
    
    // 获取选中的命名列
    const nameColumnSelect = document.getElementById('nameColumnSelect');
    const nameColumn = nameColumnSelect ? nameColumnSelect.value : '';
    
    const downloadBtn = document.getElementById('downloadBtn');
    const downloadLoading = document.getElementById('downloadLoading');
    
    downloadBtn.disabled = true;
    downloadLoading.style.display = 'inline';
    
    showToast(`开始下载 ${imagesToDownload.length} 张图片...`, 'info');
    
    const startTime = Date.now();
    
    try {
        const response = await fetch(`${API_BASE}/download-images`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                images: imagesToDownload,
                name_column: nameColumn  // 传递命名列
            })
        });
        
        const data = await response.json();
        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
        
        if (data.success) {
            if (directoryHandle) {
                let savedCount = 0;
                const savePromises = [];
                
                for (const result of data.results) {
                    if (result.status === 'success') {
                        const savePromise = (async () => {
                            try {
                                const imgResponse = await fetch(`${API_BASE}/download/${result.filename}`);
                                if (!imgResponse.ok) throw new Error('下载失败');
                                const blob = await imgResponse.blob();
                                
                                const fileHandle = await directoryHandle.getFileHandle(result.filename, { create: true });
                                const writable = await fileHandle.createWritable();
                                await writable.write(blob);
                                await writable.close();
                                savedCount++;
                            } catch (error) {
                                console.error(`保存 ${result.filename} 失败:`, error);
                            }
                        })();
                        savePromises.push(savePromise);
                    }
                }
                
                await Promise.all(savePromises);
                
                showToast(
                    `下载完成！用时 ${elapsedTime} 秒，成功: ${savedCount}/${data.success_count} 张图片已保存到您选择的文件夹`,
                    data.failed_count === 0 ? 'success' : 'info'
                );
            } else {
                showToast(
                    `下载完成！用时 ${elapsedTime} 秒，成功: ${data.success_count}, 失败: ${data.failed_count}`,
                    data.failed_count === 0 ? 'success' : 'info'
                );
                
                let downloadIndex = 0;
                const downloadNext = () => {
                    const successResults = data.results.filter(r => r.status === 'success');
                    if (downloadIndex < successResults.length) {
                        const result = successResults[downloadIndex];
                        const link = document.createElement('a');
                        link.href = `${API_BASE}/download/${result.filename}`;
                        link.download = result.filename;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        downloadIndex++;
                        setTimeout(downloadNext, 200);
                    }
                };
                setTimeout(downloadNext, 500);
            }
            
            if (data.failed_count > 0) {
                const failed = data.results.filter(r => r.status === 'failed');
                console.error('下载失败的图片:', failed);
            }
        } else {
            showToast(data.error || '下载失败', 'error');
        }
    } catch (error) {
        showToast('下载失败: ' + error.message, 'error');
    } finally {
        downloadBtn.disabled = false;
        downloadLoading.style.display = 'none';
    }
}

// 更新列选择器
function updateColumnSelectors() {
    const urlSelector = document.getElementById('urlColumnSelect');
    const nameSelector = document.getElementById('nameColumnSelect');
    const container = document.getElementById('columnSelectors');
    
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
}

// 根据选择的列更新图片列表
function updateImagesFromColumns() {
    const urlColumn = document.getElementById('urlColumnSelect')?.value;
    const nameColumn = document.getElementById('nameColumnSelect')?.value;
    
    if (!urlColumn || !nameColumn || csvData.length === 0) {
        return;
    }
    
    currentImages = [];
    
    csvData.forEach((row, index) => {
        const url = row[urlColumn] ? String(row[urlColumn]).trim() : '';
        if (!url || url === 'nan' || url === '') {
            return;
        }
        
        const name = row[nameColumn] ? String(row[nameColumn]).trim() : String(index);
        const albumId = name || String(index);
        
        const imageData = {
            'id': index,
            'album_id': albumId,
            'url': url,
            'csv_data': row  // 保存完整的CSV行数据
        };
        currentImages.push(imageData);
    });
    
    selectedImages.clear();
    updateStats();
    loadUrlList();
}

// 清除文件
function clearFile() {
    document.getElementById('csvFile').value = '';
    document.getElementById('fileInfo').style.display = 'none';
    document.getElementById('controlPanel').style.display = 'none';
    document.getElementById('urlListSection').style.display = 'none';
    document.getElementById('columnSelectors').style.display = 'none';
    document.getElementById('urlListBody').innerHTML = '';
    currentImages = [];
    selectedImages.clear();
    csvColumns = [];
    csvData = [];
}

// 显示 Toast
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// 拖拽上传
const uploadBox = document.getElementById('uploadBox');
uploadBox.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadBox.style.borderColor = '#764ba2';
});

uploadBox.addEventListener('dragleave', () => {
    uploadBox.style.borderColor = '#667eea';
});

uploadBox.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadBox.style.borderColor = '#667eea';
    
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) {
        uploadCSV(file);
    } else {
        showToast('请上传 CSV 文件', 'error');
    }
});
