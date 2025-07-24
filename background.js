// 消息类型枚举
const MSG_TYPE = {
  TASK_STATUS: 0,      // 任务状态
  NEW_CATEGORY: 1,     // 新增类目
  REDUCE_CATEGORY: 2,  // 减少类目
  RANK_CHANGE: 3,      // 排名变化
  NEW_PRODUCT: 4,      // 新增产品
}

// 监控分组ID和分组标题
let groupId = 0;
let groupTitle = '亚马逊产品监控(请勿手动操作 GROUP中的页面)';

// 初始化分组信息
(async function () {
  console.log('group信息初始化');
  let groups = await chrome.tabGroups.query({ title: groupTitle });
  if (groups.length > 0) {
    groupId = groups[0].id;
    console.log('group信息初始化完成,存在历史 GROUP 可复用', groupId);
  } else {
    groupId = 0;
    console.log('group信息初始化完成,不存在历史 GROUP');
  }
})();

// 执行监控任务，确保每个ASIN页面都在分组中
async function doTask() {
  console.log('任务开始执行');
  let asins = await chrome.storage.local.get('amazonMonitors');
  asins.amazonMonitors.forEach(async ({ asin }) => {
    let tabs = await chrome.tabs.query({});
    let exists = false;
    let asinTab = null;
    for (let i = 0; i < tabs.length; i++) {
      let tab = tabs[i];
      if (tab.url.includes(`https://www.amazon.com/dp/${asin}`) && tab.groupId === groupId) {
        asinTab = tab;
        exists = true;
        break;
      }
    }
    if (!exists) {
      // 页面不存在则新建并加入分组
      console.log(`${asin} 页面不存在，创建页面`);
      asinTab = await chrome.tabs.create({ url: `https://www.amazon.com/dp/${asin}`, active: false });
      groupId = await chrome.tabs.group({ groupId: groupId === 0 ? undefined : groupId, tabIds: [asinTab.id] });
      await chrome.tabGroups.update(groupId, { title: groupTitle });
    } else {
      // 已存在则刷新
      console.log(`${asin} 页面已存在,刷新页面`);
      await chrome.tabs.reload(asinTab.id);
    }
  });
}

// 安装时初始化定时任务
chrome.runtime.onInstalled.addListener(() => {
  console.log('Amazon 产品监控扩展已安装');
  chrome.storage.local.get('amazonMonitorRunning', (result) => {
    if (result.amazonMonitorRunning) {
      // 安装时设置任务状态为停止
      chrome.storage.local.set({ amazonMonitorRunning: false });
      // 发送通知，服务已注册但未启动
      sendRobotNotify(MSG_TYPE.TASK_STATUS, '', 'Amazon 产品监控扩展已安装', '服务已注册但未启动');
    }
  });
});

// 定时任务触发时执行监控
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkAmazonProducts') {
    // 打印任务触发时间以及预估下一次触发时间
    console.log('任务触发时间:', new Date().toLocaleString());
    console.log('预估下一次触发时间:', new Date(new Date().getTime() + alarm.periodInMinutes * 60 * 1000).toLocaleString());
    doTask();
  }
});

// 监听消息，处理监控任务的启动/停止
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'startMonitor') {
    sendRobotNotify(MSG_TYPE.TASK_STATUS, '', 'Amazon 产品监控扩展状态变更', '任务开始');
    chrome.alarms.clear('checkAmazonProducts', () => {
      chrome.alarms.create('checkAmazonProducts', {
        periodInMinutes: msg.periodInMinutes
      });
      chrome.storage.local.set({ amazonMonitorRunning: true }, () => {
        sendResponse({ status: 'started' });
      });
    });
    doTask();
    return true; // 异步响应
  }
  if (msg.action === 'stopMonitor') {
    sendRobotNotify(MSG_TYPE.TASK_STATUS, '', 'Amazon 产品监控扩展状态变更', '任务结束');
    chrome.alarms.clear('checkAmazonProducts', () => {
      chrome.storage.local.set({ amazonMonitorRunning: false }, () => {
        sendResponse({ status: 'stopped' });
      });
    });
    return true;
  }
});

// 监听 content.js 的消息，判断当前 tab 是否在监控分组中，或提交采集数据
chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  switch (msg.action) {
    case 'getTabMonitorStatus':
      // 判断当前 tab 是否属于监控分组
      if (sender.tab.groupId === groupId) {
        sendResponse({ monitored: true });
      } else {
        sendResponse({ monitored: false });
      }
      break;
    case 'submitData':
      // 只处理已监控的 ASIN
      const asinMonitorData = await chrome.storage.local.get('amazonMonitors');
      const asinMonitorDataList = asinMonitorData.amazonMonitors;
      if (!asinMonitorDataList.some(item => item.asin === msg.data.productAsin)) {
        console.log('不是监控的产品', msg.data.productAsin);
        return;
      }
      // 获取本地缓存的该 ASIN 数据
      const asinCacheDataRsp = await chrome.storage.local.get(`amazonMonitor_${msg.data.productAsin}`);
      const asinCacheData = asinCacheDataRsp[`amazonMonitor_${msg.data.productAsin}`];
      if (asinCacheData) {
        // 检查新增类目
        const newCategory = msg.data.rankList.filter(item => {
          return !asinCacheData.rankList.some(cacheItem => cacheItem.category === item.category);
        });
        if (newCategory.length > 0) {
          sendRobotNotify(MSG_TYPE.NEW_CATEGORY, msg.data, newCategory, msg.data.datetime);
        }
        // 检查减少类目
        const reduceCategory = asinCacheData.rankList.filter(item => {
          return !msg.data.rankList.some(cacheItem => cacheItem.category === item.category);
        });
        if (reduceCategory.length > 0) {
          sendRobotNotify(MSG_TYPE.REDUCE_CATEGORY, msg.data, reduceCategory, msg.data.datetime);
        }
        // 检查排名变化
        const rankChange = msg.data.rankList.map(item => {
          const cacheItem = asinCacheData.rankList.find(cacheItem => cacheItem.category === item.category && cacheItem.rank !== item.rank);
          if (cacheItem) {
            item = {
              ...item,
              rankChangeUp: cacheItem.rank > item.rank, // true为上升，false为下降
              diff: Math.abs(cacheItem.rank - item.rank)
            }
            return item;
          }
          return undefined;
        }).filter(item => item !== undefined);
        if (rankChange.length > 0) {
          sendRobotNotify(MSG_TYPE.RANK_CHANGE, msg.data, rankChange, msg.data.datetime);
        }
      } else {
        // 新增的asin 数据
        console.log('新增的asin 数据', msg.data);
        sendNewAsinNotify(msg.data);
      }
      // 更新本地缓存
      chrome.storage.local.set({ [`amazonMonitor_${msg.data.productAsin}`]: msg.data });
      console.log("数据上报完成", msg.data);
      break;
  }
  return true; // 异步响应
});


// 统一发送通知，组装消息内容
async function sendRobotNotify(msgType, productData, data, datetime) {
  // 通过asin获取产品类型和备注信息
  const asinMonitorData = await chrome.storage.local.get('amazonMonitors');
  const asinMonitorDataList = asinMonitorData.amazonMonitors;
  const asinMonitorDataItem = asinMonitorDataList.find(item => item.asin === productData.productAsin);
  const category = asinMonitorDataItem?.category;
  const remark = asinMonitorDataItem?.remark;
  if (msgType === MSG_TYPE.TASK_STATUS) {
    // 任务状态类通知单独处理
    const msg = `\n###  ${data}\n###  <font color="${datetime === '任务开始' ? 'green' : 'red'}">${datetime}</font>\n      `;
    const title = '任务状态同步';
    sendNotify(msg, title);
  } else {
    // 其余产品相关通知统一走组装方法
    const { msg, title } = buildProductNotifyMessage(msgType, productData, data, datetime, category, remark);
    sendNotify(msg, title);
  }
}

// 统一组装产品相关通知内容
function buildProductNotifyMessage(msgType, productData, data, datetime, category, remark) {
  let msg = `${category ? `### 产品类型: <font color="${category === '竞品' ? 'red' : category === '自售' ? 'green' : 'blue'}">${category}</font>\n` : ''}`
    + `${remark ? `### 产品备注: <font color="${category === '竞品' ? 'red' : category === '自售' ? 'green' : 'blue'}">${remark}</font>\n` : ''}`
    + `### 产品 ASIN: [${productData.productAsin}](https://www.amazon.com/dp/${productData.productAsin})\n`
    + `${productData.price ? `### 价格: ${productData.price}\n` : ''}`
    + `${productData.coupon ? `### Coupon: ${productData.coupon}\n` : ''}`
    + `${productData.code ? `### Code Discount: ${productData.code}\n` : ''}`
    + `${productData.sales ? `### 销售量: ${productData.sales}\n` : ''}`
    +  `### 数据采集时间: ${datetime}`;
  let title = '';
  switch (msgType) {
    case MSG_TYPE.NEW_CATEGORY:
      msg = `${msg}
### 新增类目:
${data.map(item => `> [排名:${item.rank}]: <font color="green">**${item.category}**</font>([${item.categoryType == 1 ? '大类' : '小类'}](${item.categoryLink})) `).join('\n')}`;
      title = '新增类目';
      break;
    case MSG_TYPE.REDUCE_CATEGORY:
      msg = `${msg}
### 减少类目:
${data.map(item => `> [排名:${item.rank}]: <font color="red">**${item.category}**</font>([${item.categoryType == 1 ? '大类' : '小类'}](${item.categoryLink})) `).join('\n')}`;
      title = '减少类目';
      break;
    case MSG_TYPE.RANK_CHANGE:
      msg = `${msg}
### 排名变化:
${data.map(item => `> [排名:<font color="${item.rankChangeUp ? 'green' : 'red'}">${item.rankChangeUp ? '↑' : '↓'} ${item.rank}(${item.rankChangeUp ? '+' : '-'}${item.diff})</font>]: <font color="${item.rankChangeUp ? 'green' : 'red'}">**${item.category}**</font>([${item.categoryType == 1 ? '大类' : '小类'}](${item.categoryLink})) `).join('\n')}`;
      title = '排名变化';
      break;
  }
  return { msg, title };
}
// 新增ASIN通知方法
function sendNewAsinNotify(data) {
  console.log('data', data);
  // 获取产品类型和备注
  chrome.storage.local.get('amazonMonitors', (asinMonitorData) => {
    const asinMonitorDataList = asinMonitorData.amazonMonitors;
    const asinMonitorDataItem = asinMonitorDataList.find(item => item.asin === data.productAsin);
    const category = asinMonitorDataItem?.category;
    const remark = asinMonitorDataItem?.remark;
    // 组装通知内容
    const msg = `${category ? `### 产品类型: <font color="${category === '竞品' ? 'red' : category === '自售' ? 'green' : 'blue'}">${category}</font>` : ''}
${remark ? `### 产品备注: <font color="${category === '竞品' ? 'red' : category === '自售' ? 'green' : 'blue'}">${remark}</font>` : ''}
### 新增产品 ASIN: [${data.productAsin}](https://www.amazon.com/dp/${data.productAsin})`
      + `${data.price ? `### 价格: ${data.price}\n` : ''}`
      + `${data.coupon ? `### Coupon: ${data.coupon}\n` : ''}`
      + `${data.code ? `### Code Discount: ${data.code}\n` : ''}`
      + `${data.sales ? `### 销售量: ${data.sales}\n` : ''}`
      + `### 数据采集时间: ${data.datetime}
### 类目概览:
${data.rankList.map(item => `> [排名:${item.rank}]: <font color="blue">${item.category}</font> `).join('\n')}`;
    const title = '新增产品';
    sendNotify(msg, title);
  });
}

// 发送通知到 webhook（支持钉钉和企业微信）
async function sendNotify(msg, title) {
  const webhookUrl = await chrome.storage.local.get('amazonMonitorNotify');
  if (!webhookUrl) {
    console.error('webhookUrl 不存在');
    return;
  }
  if (webhookUrl.amazonMonitorNotify.includes('https://oapi.dingtalk.com/robot/send?access_token=')) {
    sendDingTalkNotify(msg, webhookUrl.amazonMonitorNotify, title);
  } else if (webhookUrl.amazonMonitorNotify.includes('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=')) {
    sendWechatNotify(msg, webhookUrl.amazonMonitorNotify, title);
  }
}

// 发送钉钉通知，走本地代理
function sendDingTalkNotify(msg, webhookUrl, title) {
  const urlObj = new URL(webhookUrl);
  const forwardDomain = urlObj.origin;
  const newWebhookUrl = webhookUrl.replace(urlObj.origin, 'http://localhost:18888');
  const url = `${newWebhookUrl}`;
  const content = `\n# 亚马逊产品监控通知\n## ${title}\n${msg}`;
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Forward-Domain': forwardDomain
    },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: {
        title: title,
        text: content
      }
    })
  });
}

// 发送企业微信通知，走本地代理
function sendWechatNotify(msg, webhookUrl, title) {
  const urlObj = new URL(webhookUrl);
  const forwardDomain = urlObj.origin;
  const newWebhookUrl = webhookUrl.replace(urlObj.origin, 'http://localhost:18888');
  const url = `${newWebhookUrl}`;
  const content = `\n# 亚马逊产品监控通知\n## ${title}\n${msg}`;
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Forward-Domain': forwardDomain
    },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: {
        content: content
      }
    })
  });
}