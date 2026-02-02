let selectedFiles = [];
let selectedImages = [];  // CSV上传的图片列表
let uploadType = 'local';  // 'local' 或 'csv'
let csvColumns = [];  // CSV列名
let csvData = [];  // 完整的CSV数据

// 切换上传类型
function switchUploadType(type) {
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
        selectedFiles = [];
    }
    
    updateFileList();
    updateProcessButton();
}

// 选择文件按钮
document.getElementById('selectBtn').addEventListener('click', () => {
    document.getElementById('fileInput').click();
});

// CSV文件选择按钮
document.getElementById('selectCsvBtn').addEventListener('click', () => {
    document.getElementById('csvFileInput').click();
});

// CSV文件选择
document.getElementById('csvFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    const selectCsvBtn = document.getElementById('selectCsvBtn');
    selectCsvBtn.disabled = true;
    selectCsvBtn.textContent = '上传中...';
    
    try {
        const response = await fetch('/api/upload-csv-resize', {
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
            
            updateCsvImageList();
            updateProcessButton();
            alert(`成功加载 ${data.total} 条数据！请选择URL列和命名列`);
        } else {
            alert('上传失败：' + (data.error || '未知错误'));
        }
    } catch (error) {
        console.error('上传错误：', error);
        alert('上传时出错：' + error.message);
    } finally {
        selectCsvBtn.disabled = false;
        selectCsvBtn.textContent = '选择CSV文件';
        e.target.value = '';
    }
});

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
        updateProcessButton();
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
    updateProcessButton();
}

// 更新CSV图片列表显示
function updateCsvImageList() {
    const csvImageList = document.getElementById('csvImageList');
    if (selectedImages.length === 0) {
        csvImageList.innerHTML = '<div class="empty-state">未选择图片</div>';
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

// 文件选择
document.getElementById('fileInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    // 检查总文件大小（限制为900MB，留一些余量）
    const maxSize = 900 * 1024 * 1024; // 900MB
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    
    if (totalSize > maxSize) {
        const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
        const maxMB = (maxSize / (1024 * 1024)).toFixed(0);
        alert(`文件总大小 ${sizeMB}MB 超过限制 ${maxMB}MB。\n\n建议：\n1. 减少图片数量\n2. 压缩图片后再上传\n3. 分批上传`);
        e.target.value = '';
        return;
    }
    
    const selectBtn = document.getElementById('selectBtn');
    selectBtn.disabled = true;
    selectBtn.textContent = `上传中... (${files.length} 张)`;
    
    try {
        // 如果文件数量很多（>50张），分批上传
        const batchSize = 50;
        if (files.length > batchSize) {
            let uploadedCount = 0;
            for (let i = 0; i < files.length; i += batchSize) {
                const batch = files.slice(i, i + batchSize);
                const formData = new FormData();
                batch.forEach(file => {
                    formData.append('files', file);
                });
                
                selectBtn.textContent = `上传中... (${uploadedCount + batch.length}/${files.length})`;
                
                const response = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });
                
                if (!response.ok) {
                    // 尝试解析错误信息
                    let errorMsg = '上传失败';
                    try {
                        const errorData = await response.json();
                        errorMsg = errorData.error || errorMsg;
                    } catch {
                        if (response.status === 413) {
                            errorMsg = `文件太大！当前批次总大小超过限制。\n建议减少每批上传的图片数量。`;
                        } else {
                            errorMsg = `上传失败 (状态码: ${response.status})`;
                        }
                    }
                    throw new Error(errorMsg);
                }
                
                const data = await response.json();
                if (data.files) {
                    selectedFiles = selectedFiles.concat(data.files);
                    uploadedCount += batch.length;
                }
            }
        } else {
            // 文件数量不多，一次性上传
            const formData = new FormData();
            files.forEach(file => {
                formData.append('files', file);
            });
            
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                let errorMsg = '上传失败';
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.error || errorMsg;
                } catch {
                    if (response.status === 413) {
                        errorMsg = `文件太大！总大小超过限制。\n建议减少图片数量或压缩图片。`;
                    } else {
                        errorMsg = `上传失败 (状态码: ${response.status})`;
                    }
                }
                throw new Error(errorMsg);
            }
            
            const data = await response.json();
            if (data.files) {
                selectedFiles = selectedFiles.concat(data.files);
            }
        }
        
        updateFileList();
        updateProcessButton();
        alert(`成功上传 ${files.length} 张图片！`);
    } catch (error) {
        console.error('上传错误：', error);
        alert('上传时出错：' + error.message);
    } finally {
        selectBtn.disabled = false;
        selectBtn.textContent = '选择图片（可多选）';
        e.target.value = '';
    }
});

function updateFileList() {
    const fileList = document.getElementById('fileList');
    if (uploadType === 'csv') {
        return;  // CSV上传时，使用updateCsvImageList
    }
    
    if (selectedFiles.length === 0) {
        fileList.innerHTML = '<div class="empty-state">未选择图片</div>';
        return;
    }
    
    fileList.innerHTML = `<div style="margin-bottom: 10px; color: #666; font-weight: bold;">已选择 ${selectedFiles.length} 张图片：</div>`;
    
    selectedFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `
            <span>${index + 1}. ${file.original_name}</span>
            <button class="remove-btn" onclick="removeFile(${index})">删除</button>
        `;
        fileList.appendChild(item);
    });
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    updateFileList();
    updateProcessButton();
}

function updateProcessButton() {
    const processBtn = document.getElementById('processBtn');
    if (uploadType === 'local') {
        processBtn.disabled = selectedFiles.length === 0;
    } else {
        processBtn.disabled = selectedImages.length === 0;
    }
}

document.getElementById('processBtn').addEventListener('click', async () => {
    const width = parseInt(document.getElementById('widthInput').value);
    const height = parseInt(document.getElementById('heightInput').value);
    
    if (!width || !height || width <= 0 || height <= 0) {
        alert('请输入有效的宽度和高度值');
        return;
    }
    
    if (uploadType === 'local' && selectedFiles.length === 0) {
        alert('请先选择图片文件');
        return;
    }
    if (uploadType === 'csv' && selectedImages.length === 0) {
        alert('请先上传CSV文件');
        return;
    }
    
    const progressContainer = document.getElementById('progress');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    progressContainer.style.display = 'block';
    
    const resultsContainer = document.getElementById('results');
    resultsContainer.innerHTML = '';
    
    const processBtn = document.getElementById('processBtn');
    processBtn.disabled = true;
    
    try {
        progressFill.style.width = '0%';
        progressText.textContent = '开始处理...';
        
        const requestBody = {
            width: width,
            height: height
        };
        
        if (uploadType === 'local') {
            requestBody.files = selectedFiles;
        } else {
            requestBody.images = selectedImages;
            // 传递命名列（如果使用CSV上传）
            const nameColumn = document.getElementById('csvNameColumnSelect')?.value;
            if (nameColumn) {
                requestBody.name_column = nameColumn;
            }
        }
        
        const response = await fetch('/api/resize', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            progressFill.style.width = '100%';
            progressText.textContent = `处理完成！成功：${data.success_count}，失败：${data.fail_count}`;
            
            displayResults(data.results);
        } else {
            alert('处理失败：' + (data.error || '未知错误'));
            progressText.textContent = '处理失败';
        }
        
    } catch (error) {
        console.error('处理错误：', error);
        alert('处理图片时出错：' + error.message);
        progressText.textContent = '处理失败：' + error.message;
    } finally {
        processBtn.disabled = false;
    }
});

let processedResults = [];

function displayResults(results) {
    processedResults = results;
    const container = document.getElementById('results');
    const downloadAllContainer = document.getElementById('downloadAllContainer');
    
    if (results.length === 0) {
        container.innerHTML = '<div class="empty-state">没有处理结果</div>';
        downloadAllContainer.style.display = 'none';
        return;
    }
    
    const hasSuccess = results.some(r => r.success);
    if (hasSuccess) {
        downloadAllContainer.style.display = 'block';
    } else {
        downloadAllContainer.style.display = 'none';
    }
    
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    container.innerHTML = '';
    
    if (successCount > 0) {
        const successMsg = document.createElement('div');
        successMsg.className = 'result-item success';
        successMsg.innerHTML = `<strong>✓ 成功处理 ${successCount} 张图片</strong>`;
        container.appendChild(successMsg);
    }
    
    if (failCount > 0) {
        const failMsg = document.createElement('div');
        failMsg.className = 'result-item error';
        failMsg.innerHTML = `<strong>✗ 处理失败 ${failCount} 张图片</strong>`;
        container.appendChild(failMsg);
        
        results.forEach((result) => {
            if (!result.success) {
                const item = document.createElement('div');
                item.className = 'result-item error';
                item.style.marginTop = '5px';
                item.innerHTML = `
                    <small>${result.filename}: ${result.error}</small>
                `;
                container.appendChild(item);
            }
        });
    }
}

document.getElementById('downloadAllBtn').addEventListener('click', async () => {
    const btn = document.getElementById('downloadAllBtn');
    btn.disabled = true;
    btn.textContent = '正在打包...';
    
    try {
        const response = await fetch('/api/download-all-resize', {
            method: 'POST'
        });
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'resized_images.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            btn.textContent = '全部下载';
        } else {
            const data = await response.json();
            alert('下载失败：' + (data.error || '未知错误'));
            btn.textContent = '全部下载';
        }
    } catch (error) {
        console.error('下载错误：', error);
        alert('下载时出错：' + error.message);
        btn.textContent = '全部下载';
    } finally {
        btn.disabled = false;
    }
});

updateFileList();
updateProcessButton();
