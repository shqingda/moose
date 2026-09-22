const products = [
  {
    id: 'tee',
    name: { zh: 'Moose 重磅 T 恤', en: 'Moose Heavyweight Tee' },
    detail: { zh: '240g 精梳棉，森林绿', en: '240g combed cotton, forest green' },
    price: 179,
  },
  {
    id: 'mug',
    name: { zh: 'Moose 陶瓷杯', en: 'Moose Ceramic Mug' },
    detail: { zh: '360ml，哑光釉面', en: '360ml, matte glaze' },
    price: 89,
  },
  {
    id: 'mat',
    name: { zh: 'Moose 桌垫', en: 'Moose Desk Mat' },
    detail: { zh: '800 × 300mm，锁边', en: '800 × 300mm, stitched edge' },
    price: 139,
  },
  {
    id: 'pin',
    name: { zh: 'Moose 珐琅徽章', en: 'Moose Enamel Pin' },
    detail: { zh: '30mm，双针扣', en: '30mm, double post' },
    price: 59,
  },
  {
    id: 'stickers',
    name: { zh: 'Moose 防水贴纸', en: 'Moose Sticker Pack' },
    detail: { zh: '5 枚，防水覆膜', en: 'Set of 5, waterproof vinyl' },
    price: 39,
  },
];

const copy = {
  zh: {
    navProducts: '商品',
    navDelivery: '配送与退换',
    navAbout: '关于',
    bag: '购物袋',
    heroTitle: 'Moose 实体周边',
    heroLede: 'T 恤、杯子、桌垫、徽章和贴纸。少量制作。',
    browse: '看商品',
    physicalGoods: '实体商品',
    shipsFrom: '从中国发货',
    smallBatch: '部分地区可寄海外',
    productsTitle: '周边商品',
    productsIntro: '首批包含 T 恤、杯子、桌垫、徽章和贴纸。图片为效果图，实际细节以实物为准。',
    deliveryTitle: '配送与售后',
    deliveryIntro: '运费按收货地址计算。',
    dispatchTitle: '发货时间',
    dispatchText: '现货会在 3–5 个工作日内发出。预售商品会单独标注发货日期。',
    shippingTitle: '配送范围',
    shippingText: '可寄中国大陆及部分海外地区。运费按地址计算。',
    returnsTitle: '退换货',
    returnsText: '签收后 7 天内可申请。商品须保持未使用、未清洗，包装完整；定制品除外。',
    supportTitle: '售后支持',
    supportText: '如有破损、错发或漏发，请在签收后 48 小时内发送照片至',
    aboutTitle: '关于 Moose',
    aboutText: 'Moose 是一个可扩展的 AI 编程代理工作台，提供 macOS 桌面端和本机 Web 入口。',
    learnMoose: '查看 Moose 项目',
    footerShipping: '配送与退换',
    footerContact: '售后邮箱',
    bagTitle: '购物袋',
    emptyBag: '还没有装入周边。',
    continueShopping: '继续逛逛',
    subtotal: '商品小计',
    shippingAtOrder: '运费在确认配送地址后计算。',
    checkout: '确认订单商品',
    orderTitle: '暂不能在线付款',
    orderText: '在线付款正在接入，开放后可使用 PayPal。现在不会扣款，你可以先复制商品清单。',
    copyOrder: '复制商品清单',
    copied: '已复制',
    add: '加入购物袋',
    remove: '移除',
    quantity: '数量',
    decrease: '减少数量',
    increase: '增加数量',
  },
  en: {
    navProducts: 'Goods',
    navDelivery: 'Shipping & returns',
    navAbout: 'About',
    bag: 'Bag',
    heroTitle: 'Moose physical goods',
    heroLede: 'T-shirts, mugs, desk mats, pins, and stickers. Made in small batches.',
    browse: 'Shop goods',
    physicalGoods: 'Physical goods',
    shipsFrom: 'Ships from China',
    smallBatch: 'Made in small batches',
    productsTitle: 'Goods',
    productsIntro:
      'The first collection includes T-shirts, mugs, desk mats, pins, and stickers. Images are product mockups; final details may vary.',
    deliveryTitle: 'Shipping & support',
    deliveryIntro: 'Shipping is calculated from the delivery address.',
    dispatchTitle: 'Dispatch',
    dispatchText:
      'In-stock orders are expected to ship in 3–5 business days. Pre-order dates will be shown on the product page.',
    shippingTitle: 'Destinations',
    shippingText:
      'Shipping is available to mainland China and selected international destinations. Cost and carriers appear at order confirmation.',
    returnsTitle: 'Returns',
    returnsText:
      'Request a return within 7 days of delivery. Items must be unused, unwashed, and in original packaging; custom goods are excluded.',
    supportTitle: 'Order support',
    supportText:
      'For damaged, incorrect, or missing goods, send photos within 48 hours of delivery to',
    aboutTitle: 'About Moose',
    aboutText:
      'Moose is an extensible workspace for coding agents, available as a macOS desktop app and a local web app.',
    learnMoose: 'View the Moose project',
    footerShipping: 'Shipping & returns',
    footerContact: 'Support email',
    bagTitle: 'Your bag',
    emptyBag: 'Your bag is still out in the woods.',
    continueShopping: 'Keep browsing',
    subtotal: 'Subtotal',
    shippingAtOrder: 'Shipping is calculated after confirming the delivery address.',
    checkout: 'Review order items',
    orderTitle: 'Online payment is not open yet',
    orderText:
      'Online payment is being set up. PayPal will be available when checkout opens. No charge will be made now.',
    copyOrder: 'Copy item list',
    copied: 'Copied',
    add: 'Add to bag',
    remove: 'Remove',
    quantity: 'Qty',
    decrease: 'Decrease quantity',
    increase: 'Increase quantity',
  },
};

let language = 'zh';

function readCartCookie() {
  const entry = document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith('moose_merch_cart='));
  if (!entry) return {};

  try {
    const value = JSON.parse(decodeURIComponent(entry.split('=').slice(1).join('=')));
    return Object.fromEntries(
      Object.entries(value).filter(
        ([id, quantity]) =>
          products.some((product) => product.id === id) &&
          Number.isInteger(quantity) &&
          quantity > 0 &&
          quantity <= 99,
      ),
    );
  } catch {
    return {};
  }
}

function saveCartCookie() {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `moose_merch_cart=${encodeURIComponent(JSON.stringify(cart))}; Max-Age=34560000; Path=/; SameSite=Lax${secure}`;
}

let cart = readCartCookie();

const productGrid = document.querySelector('#product-grid');
const bag = document.querySelector('#bag');
const bagButton = document.querySelector('.bag-button');
const bagCount = document.querySelector('.bag-count');
const bagItems = document.querySelector('#bag-items');
const bagEmpty = document.querySelector('#bag-empty');
const bagSummary = document.querySelector('#bag-summary');
const subtotal = document.querySelector('#subtotal');
const scrim = document.querySelector('.scrim');
const orderDialog = document.querySelector('#order-dialog');
const orderCopy = document.querySelector('#order-copy');

function currency(value) {
  return new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(value);
}

function renderProducts() {
  products.forEach((product) => {
    const card = productGrid.querySelector(`[data-product-id="${product.id}"]`);
    card.querySelector('h3').textContent = product.name[language];
    card.querySelector('.product-meta p').textContent = product.detail[language];
    card.querySelector('.product-price').textContent = currency(product.price);
    card.querySelector('.add-button').textContent = copy[language].add;
  });
}

function renderBag() {
  const entries = Object.entries(cart).filter(([, quantity]) => quantity > 0);
  const count = entries.reduce((sum, [, quantity]) => sum + quantity, 0);
  const total = entries.reduce((sum, [id, quantity]) => {
    const product = products.find((item) => item.id === id);
    return sum + product.price * quantity;
  }, 0);

  bagCount.textContent = count;
  bagEmpty.hidden = entries.length > 0;
  bagSummary.hidden = entries.length === 0;
  subtotal.textContent = currency(total);
  bagItems.innerHTML = entries
    .map(([id, quantity]) => {
      const product = products.find((item) => item.id === id);
      return `
        <article class="bag-item">
          <div>
            <h3>${product.name[language]}</h3>
            <p>${currency(product.price * quantity)}</p>
          </div>
          <div class="bag-item-actions">
            <div class="quantity-control" aria-label="${copy[language].quantity}">
              <button type="button" data-decrease="${id}" aria-label="${copy[language].decrease}：${product.name[language]}">−</button>
              <span aria-live="polite">${quantity}</span>
              <button type="button" data-increase="${id}" aria-label="${copy[language].increase}：${product.name[language]}">+</button>
            </div>
            <button class="remove-item" type="button" data-remove="${id}">${copy[language].remove}</button>
          </div>
        </article>`;
    })
    .join('');
}

function translate() {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = copy[language][node.dataset.i18n];
  });
  const languageButton = document.querySelector('.language-button');
  languageButton.textContent = language === 'zh' ? 'EN' : '中文';
  languageButton.setAttribute('aria-label', language === 'zh' ? 'Switch to English' : '切换到中文');
  renderProducts();
  renderBag();
}

function openBag() {
  bag.classList.add('is-open');
  bag.setAttribute('aria-hidden', 'false');
  bagButton.setAttribute('aria-expanded', 'true');
  scrim.hidden = false;
  document.body.style.overflow = 'hidden';
  bag.querySelector('.icon-button').focus();
}

function closeBag() {
  bag.classList.remove('is-open');
  bag.setAttribute('aria-hidden', 'true');
  bagButton.setAttribute('aria-expanded', 'false');
  scrim.hidden = true;
  document.body.style.overflow = '';
  bagButton.focus();
}

function createOrderSummary() {
  const lines = Object.entries(cart)
    .filter(([, quantity]) => quantity > 0)
    .map(([id, quantity]) => {
      const product = products.find((item) => item.id === id);
      return `${product.name[language]} × ${quantity} — ${currency(product.price * quantity)}`;
    });
  const total = Object.entries(cart).reduce((sum, [id, quantity]) => {
    const product = products.find((item) => item.id === id);
    return sum + product.price * quantity;
  }, 0);
  return `${lines.join('\n')}\n\n${copy[language].subtotal}: ${currency(total)}`;
}

document.addEventListener('click', (event) => {
  const addButton = event.target.closest('[data-add]');
  const increaseButton = event.target.closest('[data-increase]');
  const decreaseButton = event.target.closest('[data-decrease]');
  const removeButton = event.target.closest('[data-remove]');
  if (addButton) {
    const id = addButton.dataset.add;
    cart[id] = Math.min(99, (cart[id] || 0) + 1);
    saveCartCookie();
    renderBag();
    openBag();
  }
  if (increaseButton) {
    const id = increaseButton.dataset.increase;
    cart[id] = Math.min(99, (cart[id] || 0) + 1);
    saveCartCookie();
    renderBag();
  }
  if (decreaseButton) {
    const id = decreaseButton.dataset.decrease;
    cart[id] = Math.max(0, (cart[id] || 0) - 1);
    if (cart[id] === 0) delete cart[id];
    saveCartCookie();
    renderBag();
  }
  if (removeButton) {
    const id = removeButton.dataset.remove;
    delete cart[id];
    saveCartCookie();
    renderBag();
  }
});

document.querySelector('.language-button').addEventListener('click', () => {
  language = language === 'zh' ? 'en' : 'zh';
  translate();
});

bagButton.addEventListener('click', openBag);
document
  .querySelectorAll('[data-close-bag]')
  .forEach((button) => button.addEventListener('click', closeBag));

document.querySelector('.checkout-button').addEventListener('click', () => {
  orderCopy.textContent = createOrderSummary();
  closeBag();
  orderDialog.showModal();
});

document.querySelector('.dialog-close').addEventListener('click', () => orderDialog.close());
document.querySelector('.copy-order').addEventListener('click', async (event) => {
  await navigator.clipboard.writeText(orderCopy.textContent);
  event.currentTarget.textContent = copy[language].copied;
  window.setTimeout(() => {
    event.currentTarget.textContent = copy[language].copyOrder;
  }, 1600);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && bag.classList.contains('is-open')) closeBag();
});

document.querySelector('#year').textContent = new Date().getFullYear();
translate();
