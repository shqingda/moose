import type { ReactNode } from 'react';
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import '../styles.css';

const origin = 'https://moose-merch.shqingda.workers.dev/';
const structuredData = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'OnlineStore',
      '@id': `${origin}#store`,
      name: 'Moose Supply',
      url: origin,
      logo: `${origin}mark.svg`,
      email: 'shqingda@gmail.com',
      description: 'Moose 实体周边商店，销售 T 恤、陶瓷杯、桌垫、珐琅徽章和防水贴纸。',
      sameAs: ['https://github.com/shqingda/moose'],
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'CN',
        returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays: 7,
        returnMethod: 'https://schema.org/ReturnByMail',
        returnFees: 'https://schema.org/ReturnShippingFees',
      },
    },
    {
      '@type': 'WebSite',
      '@id': `${origin}#website`,
      name: 'Moose Supply',
      url: origin,
      inLanguage: ['zh-CN', 'en'],
      publisher: { '@id': `${origin}#store` },
    },
  ],
});

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width,initial-scale=1' },
      { name: 'theme-color', content: '#123b2b' },
      { name: 'robots', content: 'index,follow,max-image-preview:large' },
      {
        name: 'description',
        content:
          'Moose 实体周边商店，提供 Moose T 恤、陶瓷杯、桌垫、珐琅徽章和防水贴纸，从中国发货。',
      },
      { property: 'og:title', content: 'Moose 周边商店｜T 恤、桌垫、杯子、徽章与贴纸' },
      {
        property: 'og:description',
        content: 'Moose 官方实体周边。少量制作，从中国发货，支持部分海外地区。',
      },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: origin },
      { property: 'og:image', content: `${origin}products/tee.jpg` },
      { property: 'og:locale', content: 'zh_CN' },
      { name: 'twitter:card', content: 'summary' },
      { name: 'twitter:title', content: 'Moose 周边商店' },
      { name: 'twitter:description', content: 'Moose T 恤、杯子、桌垫、徽章和贴纸。' },
      { title: 'Moose 周边商店｜T 恤、桌垫、杯子、徽章与贴纸' },
    ],
    links: [
      { rel: 'canonical', href: origin },
      { rel: 'icon', href: '/mark.svg' },
    ],
  }),
  component: Root,
});

function Root() {
  return (
    <Document>
      <Outlet />
    </Document>
  );
}

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <HeadContent />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
