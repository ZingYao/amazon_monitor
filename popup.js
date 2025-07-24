// popup.js
const monitorCount = document.getElementById('monitor-count');
const addBtn = document.getElementById('addBtn');
const monitorListDiv = document.getElementById('monitor-list');
const saveAllBtn = document.getElementById('saveAllBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const freqTypeSelect = document.getElementById('freqType');
const freqValueInput = document.getElementById('freqValue');
const notifyInput = document.getElementById('notify');
const statusBar = document.getElementById('status-bar');

const MAX_MONITOR = 10;
let lastSaved = { asins: [], freqValue: 1, freqType: 'hour', notify: '' };
let isDirty = false;

function createEmptyMonitor() {
  return { asin: '', category: '自售', remark: '' };
}

function getMonitorData(cb) {
  chrome.storage.local.get(['amazonMonitors', 'amazonMonitorFreqValue', 'amazonMonitorFreqType', 'amazonMonitorNotify'], (result) => {
    cb({
      asins: result.amazonMonitors || [],
      freqValue: result.amazonMonitorFreqValue || 1,
      freqType: result.amazonMonitorFreqType || 'hour',
      notify: result.amazonMonitorNotify || ''
    });
  });
}

function setMonitorData(data, cb) {
  chrome.storage.local.set({
    amazonMonitors: data.asins,
    amazonMonitorFreqValue: data.freqValue,
    amazonMonitorFreqType: data.freqType,
    amazonMonitorNotify: data.notify
  }, cb);
}

function renderMonitorList(asins) {
  monitorListDiv.innerHTML = '';
  asins.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = 'asin-item';
    div.innerHTML = `
      <select class="category-select">
        <option value="竞品" ${item.category === '竞品' ? '' : ''}>竞品</option>
        <option value="自售" ${item.category === '自售' ? 'selected' : ''}>自售</option>
        <option value="其他" ${item.category === '其他' ? 'selected' : ''}>其他</option>
      </select>
      <input type="text" class="remark-input" placeholder="备注" value="${item.remark || ''}" style="width:100px;margin-right:8px;">
      <input type="text" class="asin-input" placeholder="ASIN" value="${item.asin || ''}" style="width:110px;">
      <button class="btn del-btn" data-idx="${idx}">删除</button>
    `;
    monitorListDiv.appendChild(div);
  });
  // 删除按钮事件
  document.querySelectorAll('.del-btn').forEach(btn => {
    btn.onclick = function() {
      const idx = Number(this.getAttribute('data-idx'));
      lastSaved.asins.splice(idx, 1);
      setDirty(true);
      renderMonitorList(lastSaved.asins);
      showToast('已删除', 500);
      // 立即保存
      setMonitorData(lastSaved, () => {
        setDirty(false);
        renderAll();
      });
    };
  });
  // select 和 input 变更后立即保存
  document.querySelectorAll('.asin-item').forEach((row, idx) => {
    const asinInput = row.querySelector('.asin-input');
    const categorySelect = row.querySelector('.category-select');
    const remarkInput = row.querySelector('.remark-input');
    // select 变更后立即保存
    categorySelect.onchange = function() {
      lastSaved.asins[idx] = {
        asin: asinInput.value.trim(),
        category: categorySelect.value,
        remark: remarkInput.value.trim()
      };
      setDirty(true);
      setMonitorData(lastSaved, () => {
        setDirty(false);
        renderAll();
      });
    };
    // input 失焦后立即保存
    [asinInput, remarkInput].forEach(input => {
      input.onblur = function() {
        lastSaved.asins[idx] = {
          asin: asinInput.value.trim(),
          category: categorySelect.value,
          remark: remarkInput.value.trim()
        };
        setDirty(true);
        setMonitorData(lastSaved, () => {
          setDirty(false);
          renderAll();
        });
      };
    });
  });
}

function renderAll() {
  getMonitorData((data) => {
    // 兼容老数据
    data.asins = (data.asins || []).map(item => ({
      asin: item.asin || '',
      category: item.category || '竞品',
      remark: item.remark || ''
    }));
    lastSaved = JSON.parse(JSON.stringify(data));
    freqTypeSelect.value = data.freqType;
    freqValueInput.value = data.freqValue;
    notifyInput.value = data.notify;
    renderMonitorList(data.asins);
    monitorCount.textContent = `当前监控产品数量：${data.asins.length} 个`;
    setDirty(false);
  });
}

function setDirty(flag) {
  isDirty = flag;
  saveAllBtn.disabled = !isDirty;
}

function setStatusBar(status) {
  if (status === 'running') {
    statusBar.textContent = '运行中';
    statusBar.style.color = '#4caf50';
  } else if (status === 'stopped') {
    statusBar.textContent = '已停止';
    statusBar.style.color = '#f44336';
  } else {
    statusBar.textContent = '';
  }
}

function getMonitorStatus(cb) {
  chrome.storage.local.get('amazonMonitorRunning', data => {
    cb(!!data.amazonMonitorRunning);
  });
}

function showToast(msg, duration = 1800) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.style.display = 'none';
  }, duration);
}

document.addEventListener('mousedown', function() {
  const toast = document.getElementById('toast');
  toast.style.display = 'none';
  clearTimeout(showToast._timer);
});

addBtn.onclick = function() {
  lastSaved.asins.push(createEmptyMonitor());
  setDirty(true);
  renderMonitorList(lastSaved.asins);
};

saveAllBtn.onclick = function() {
  // 只保存基础配置
  const freqType = freqTypeSelect.value;
  let freqValueRaw = freqValueInput.value.trim();
  if (!/^\d+$/.test(freqValueRaw)) {
    showToast('采集频率必须为整数');
    freqValueInput.focus();
    return;
  }
  let freqValue = parseInt(freqValueRaw, 10);
  if (freqType === 'second' && freqValue < 30) {
    showToast('秒级采集频率不能小于30秒');
    freqValueInput.focus();
    return;
  }
  const notify = notifyInput.value.trim();
  chrome.storage.local.set({
    amazonMonitorFreqType: freqType,
    amazonMonitorFreqValue: freqValue,
    amazonMonitorNotify: notify
  }, () => {
    setDirty(false);
    showToast('基础配置已保存');
  });
};

freqTypeSelect.onchange = freqValueInput.oninput = notifyInput.oninput = function() {
  setDirty(true);
};

startBtn.onclick = function() {
  const freqType = freqTypeSelect.value;
  const freqValue = Number(freqValueInput.value) || 1;
  let periodInMinutes;
  if (freqType === 'hour') {
    periodInMinutes = freqValue * 60;
  } else if (freqType === 'minute') {
    periodInMinutes = freqValue;
  } else if (freqType === 'second') {
    periodInMinutes = Math.max(freqValue / 60, 0.5); // Chrome alarms 最小 0.5 分钟
  } else {
    periodInMinutes = 1;
  }
  chrome.runtime.sendMessage({ action: 'startMonitor', periodInMinutes }, resp => {
    setStatusBar('running');
    showToast('监控已启动');
  });
};
stopBtn.onclick = function() {
  chrome.runtime.sendMessage({ action: 'stopMonitor' }, resp => {
    setStatusBar('stopped');
    showToast('监控已停止');
  });
};

document.getElementById('clearHistoryBtn').onclick = async function() {
  // 获取所有监控的 ASIN
  chrome.storage.local.get('amazonMonitors', (result) => {
    const asins = (result.amazonMonitors || []).map(item => item.asin);
    if (asins.length === 0) {
      showToast('没有可清空的历史数据');
      return;
    }
    // 构造所有历史 key
    const keys = asins.map(asin => `amazonMonitor_${asin}`);
    chrome.storage.local.remove(keys, () => {
      showToast('产品历史数据已清空');
    });
  });
};

// 初始化时检测状态
getMonitorStatus(isRunning => {
  setStatusBar(isRunning ? 'running' : 'stopped');
});

renderAll(); 