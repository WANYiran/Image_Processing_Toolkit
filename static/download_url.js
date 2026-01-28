const API_BASE = '/api';
let currentImages = [];
let selectedImages = new Set();

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
            currentImages = data.images;
            selectedImages.clear();
            
            document.getElementById('fileName').textContent = file.name;
            document.getElementById('fileInfo').style.display = 'block';
            document.getElementById('controlPanel').style.display = 'block';
            document.getElementById('urlListSection').style.display = 'block';
            
            updateStats();
            loadUrlList();
            showToast(`成功加载 ${data.total} 条链接`, 'success');
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
            body: JSON.stringify({ images: imagesToDownload })
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

// 清除文件
function clearFile() {
    document.getElementById('csvFile').value = '';
    document.getElementById('fileInfo').style.display = 'none';
    document.getElementById('controlPanel').style.display = 'none';
    document.getElementById('urlListSection').style.display = 'none';
    document.getElementById('urlListBody').innerHTML = '';
    currentImages = [];
    selectedImages.clear();
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
