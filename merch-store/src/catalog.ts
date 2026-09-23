export type Language = 'zh' | 'en';

export const products = [
  {
    id: 'tee',
    image: 'tee.jpg',
    alt: '森林绿 Moose 重磅 T 恤效果图',
    name: { zh: 'Moose 重磅 T 恤', en: 'Moose Heavyweight Tee' },
    detail: { zh: '240g 精梳棉，森林绿', en: '240g combed cotton, forest green' },
    price: 179,
  },
  {
    id: 'mug',
    image: 'mug.jpg',
    alt: '森林绿 Moose 陶瓷杯效果图',
    name: { zh: 'Moose 陶瓷杯', en: 'Moose Ceramic Mug' },
    detail: { zh: '360ml，哑光釉面', en: '360ml, matte glaze' },
    price: 89,
  },
  {
    id: 'mat',
    image: 'desk-mat.jpg',
    alt: '森林绿 Moose 桌垫效果图',
    name: { zh: 'Moose 桌垫', en: 'Moose Desk Mat' },
    detail: { zh: '800 × 300mm，锁边', en: '800 × 300mm, stitched edge' },
    price: 139,
  },
  {
    id: 'pin',
    image: 'pin.jpg',
    alt: 'Moose 珐琅徽章效果图',
    name: { zh: 'Moose 珐琅徽章', en: 'Moose Enamel Pin' },
    detail: { zh: '30mm，双针扣', en: '30mm, double post' },
    price: 59,
  },
  {
    id: 'stickers',
    image: 'stickers.jpg',
    alt: '五枚 Moose 防水贴纸效果图',
    name: { zh: 'Moose 防水贴纸', en: 'Moose Sticker Pack' },
    detail: { zh: '5 枚，防水覆膜', en: 'Set of 5, waterproof vinyl' },
    price: 39,
  },
] as const;

export type ProductId = (typeof products)[number]['id'];
export type Cart = Partial<Record<ProductId, number>>;

export const copy = {
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
} as const;

export function currency(value: number, language: Language) {
  return new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(value);
}

export function readCartCookie(): Cart {
  const entry = document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith('moose_merch_cart='));
  if (!entry) return {};
  try {
    const value: unknown = JSON.parse(decodeURIComponent(entry.split('=').slice(1).join('=')));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([id, quantity]) =>
          products.some((product) => product.id === id) &&
          Number.isInteger(quantity) &&
          Number(quantity) > 0 &&
          Number(quantity) <= 99,
      ),
    ) as Cart;
  } catch {
    return {};
  }
}

export function saveCartCookie(cart: Cart) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `moose_merch_cart=${encodeURIComponent(JSON.stringify(cart))}; Max-Age=34560000; Path=/; SameSite=Lax${secure}`;
}
