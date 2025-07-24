// 类目类型枚举 1 大类 2 小类
const CATEGORY_TYPE = {
  BIG_CATEGORY: 1, // 大类
  SMALL_CATEGORY: 2, // 小类
}

// 获取当前亚马逊商品的排名详情
function getAmazonGoodsRankDetail() {
  let rankDetail = {
    // 从URL中正则获取ASIN
    productAsin: (location.href.match(/\/dp\/([A-Z0-9]{10})/) || [])[1],
    productName: document.querySelector('#productTitle')?.textContent?.trim(),
    rankList: [],
  };
  // 获取价格
  {
    const priceNextSpan = document.querySelector('#corePriceDisplay_desktop_feature_div #taxInclusiveMessage');
    const priceSpan = priceNextSpan.previousElementSibling
    const price = Number(priceSpan.querySelector('.a-price-whole').textContent.trim()) + Number(priceSpan.querySelector('.a-price-fraction').textContent.trim()) / 100;
    rankDetail.price = price;
  }
  // 获取折扣
  {
    const couponInfo = document.querySelector('#promoPriceBlockMessage_feature_div span[id^="couponTextpctch"]');
    const couponText = couponInfo?.innerText.trim() || '';
    const couponTextArr = couponText.split('|');
    // 正则提取第一个字符串中的数字和百分号内容或者$数字
    const match = couponTextArr[0]?.match(/(\d+%|\$\d+)/);
    rankDetail.coupon = match ? match[1] : '';
    // 获取折扣率
    const couponRate = couponTextArr[0]?.match(/(\d+%)/);
    rankDetail.couponRate = couponRate ? couponRate[1] : '';
  }
  // 获取 Code 折扣
  {
    const codeInfo = document.querySelector('#promoPriceBlockMessage_feature_div label[id^="greenBadgepctch"]');
    const codeText = codeInfo?.innerText.trim() || '';
    const match = codeText.match(/(\d+%|\$\d+)/);
    rankDetail.code = match ? match[1] : '';
  }
  // 获取销量信息
  {
    const salesInfo = document.querySelector('#social-proofing-faceout-title-tk_bought');
    const salesText = salesInfo?.innerText.trim() || '';
    rankDetail.sales = salesText;
  }
  // 遍历所有 th，查找“Best Sellers Rank”
  document.querySelectorAll('th').forEach(item => {
    if (item.textContent.trim() != 'Best Sellers Rank') {
      return
    }
    // 找到对应 th 获取 td 的排名信息
    const catelogList = item.parentNode.querySelector('td span ul');
    catelogList.querySelectorAll("li").forEach((liItem, index) => {
      // 提取排名和类目信息
      const rankStr =
        liItem
          .querySelector('span:not([class])')
          .textContent
          .replace(/ \(See Top 100 in .*\)/, '');
      const tempArr = rankStr.split(' in ');
      const rank = tempArr?.[0].replaceAll('#', '').replaceAll(',', '');
      const category = tempArr?.[1];
      rankDetail.rankList.push({
        rank: Number(rank), // 排名
        category, // 类目名
        categoryType: index == 0 ? CATEGORY_TYPE.BIG_CATEGORY : CATEGORY_TYPE.SMALL_CATEGORY, // 大类/小类
        categoryIndex: index + 1, // 序号
        categoryLink: liItem.querySelector('a')?.href, // 类目链接
      })
    })
  });
  return rankDetail;
}

// 采集任务主流程
function doTask(response) {
  if (response.monitored) {
    // 如果没有遮罩则创建遮罩，防止用户操作
    if (!document.getElementById('amazonMonitorMask')) {
      const mask = document.createElement('div');
      mask.id = 'amazonMonitorMask';
      mask.style.position = 'fixed';
      mask.style.top = '0';
      mask.style.left = '0';
      mask.style.width = '100%';
      mask.style.height = '100%';
      mask.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
      mask.style.zIndex = '9999';
      mask.style.display = 'flex';
      mask.style.justifyContent = 'center';
      mask.style.alignItems = 'center';
      mask.style.color = '#fff';
      mask.style.fontSize = '20px';
      mask.style.fontWeight = 'bold';
      mask.textContent = '采集数据页面请勿手动操作，数据采集中...';
      document.body.appendChild(mask);
    }
    // 获取商品排名详情
    const detail = getAmazonGoodsRankDetail();
    // 格式化当前时间为 YYYY-MM-DD HH:mm:ss
    function formatDateToCN(date) {
      const pad = n => n < 10 ? '0' + n : n;
      return date.getFullYear() + '-' +
        pad(date.getMonth() + 1) + '-' +
        pad(date.getDate()) + ' ' +
        pad(date.getHours()) + ':' +
        pad(date.getMinutes()) + ':' +
        pad(date.getSeconds());
    }
    detail.datetime = formatDateToCN(new Date());
    // 提交数据到 background.js
    chrome.runtime.sendMessage({ action: 'submitData', data: detail });
    // 修改遮罩文字为采集完成
    document.getElementById('amazonMonitorMask').textContent = '采集数据页面请勿手动操作，数据采集完成';
  }
}

console.log('content.js loaded');
// DOM 加载完毕后自动发起监控状态查询
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded');
    chrome.runtime.sendMessage({ action: 'getTabMonitorStatus' }, doTask);
  });
} else {
  // DOM 已经加载完毕
  console.log('DOMContentLoaded (immediate)');
  chrome.runtime.sendMessage({ action: 'getTabMonitorStatus' }, doTask);
}