import { useEffect, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { copy, currency, products, readCartCookie, saveCartCookie } from '../catalog';
import type { Cart, Language, ProductId } from '../catalog';

export const Route = createFileRoute('/')({ component: Home });

function Brand({ footer = false }: { footer?: boolean }) {
  return (
    <a
      className={footer ? 'brand footer-brand' : 'brand'}
      href="#top"
      aria-label={footer ? undefined : 'Moose Supply 首页'}
    >
      <img src="/mark.svg" alt="" />
      <span>Moose Supply</span>
    </a>
  );
}

function HeroMark() {
  return (
    <svg viewBox="0 0 100 100">
      <path d="M53 48C43 45 28 45 20 37c-7-7-8-17-6-24 1-1 3 0 3 3l4 10 3 1-1-17c0-3 3-3 4 0l4 16 4 1 2-19c1-3 4-2 4 1v18l4-2 6-12c2-3 5-1 4 2l-4 18c-3 6-4 7 3 10z" />
      <path d="M22 87c7-11 13-21 17-33l1-6c-7 0-13-5-13-11 7-1 13 2 17 7 6-4 12-4 17 0 4 3 5 9 11 12l11 5c4 2 6 6 5 11 0 4-3 7-8 7l-16-1c-4 0-6-2-7-5-3 7-4 12-4 17H22z" />
      <circle cx="61.5" cy="54" r="1.5" />
    </svg>
  );
}

function Home() {
  const [language, setLanguage] = useState<Language>('zh');
  const [cart, setCart] = useState<Cart>({});
  const [cartReady, setCartReady] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);
  const [orderText, setOrderText] = useState('');
  const [copyLabel, setCopyLabel] = useState<string>(copy.zh.copyOrder);
  const bagButtonRef = useRef<HTMLButtonElement>(null);
  const bagCloseRef = useRef<HTMLButtonElement>(null);
  const orderDialogRef = useRef<HTMLDialogElement>(null);
  const t = copy[language];

  useEffect(() => {
    setCart(readCartCookie());
    setCartReady(true);
  }, []);

  useEffect(() => {
    if (cartReady) saveCartCookie(cart);
  }, [cart, cartReady]);

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    setCopyLabel(copy[language].copyOrder);
  }, [language]);

  useEffect(() => {
    document.body.style.overflow = bagOpen ? 'hidden' : '';
    if (bagOpen) bagCloseRef.current?.focus();
    return () => {
      document.body.style.overflow = '';
    };
  }, [bagOpen]);

  useEffect(() => {
    if (!bagOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeBag();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [bagOpen]);

  useEffect(() => {
    if (copyLabel !== t.copied) return;
    const timer = window.setTimeout(() => setCopyLabel(t.copyOrder), 1600);
    return () => window.clearTimeout(timer);
  }, [copyLabel, t.copied, t.copyOrder]);

  const entries = Object.entries(cart).flatMap(([id, quantity]) => {
    const product = products.find((item) => item.id === id);
    return product && quantity > 0 ? [{ product, quantity }] : [];
  });
  const count = entries.reduce((sum, { quantity }) => sum + quantity, 0);
  const total = entries.reduce((sum, { product, quantity }) => sum + product.price * quantity, 0);

  function changeQuantity(id: ProductId, delta: number) {
    setCart((current) => {
      const next = { ...current };
      const quantity = Math.max(0, Math.min(99, (next[id] || 0) + delta));
      if (quantity) next[id] = quantity;
      else delete next[id];
      return next;
    });
  }

  function addProduct(id: ProductId) {
    changeQuantity(id, 1);
    setBagOpen(true);
  }

  function closeBag() {
    setBagOpen(false);
    bagButtonRef.current?.focus();
  }

  function reviewOrder() {
    const lines = entries.map(
      ({ product, quantity }) =>
        `${product.name[language]} × ${quantity} — ${currency(product.price * quantity, language)}`,
    );
    setOrderText(`${lines.join('\n')}\n\n${t.subtotal}: ${currency(total, language)}`);
    closeBag();
    orderDialogRef.current?.showModal();
  }

  async function copyOrder() {
    await navigator.clipboard.writeText(orderText);
    setCopyLabel(t.copied);
  }

  return (
    <>
      <a className="skip-link" href="#products">
        跳到商品
      </a>

      <header className="site-header">
        <Brand />
        <nav aria-label="主导航">
          <a href="#products">{t.navProducts}</a>
          <a href="#delivery">{t.navDelivery}</a>
          <a href="#about">{t.navAbout}</a>
        </nav>
        <div className="header-actions">
          <button
            className="language-button"
            type="button"
            aria-label={language === 'zh' ? 'Switch to English' : '切换到中文'}
            onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
          >
            {language === 'zh' ? 'EN' : '中文'}
          </button>
          <button
            className="bag-button"
            type="button"
            aria-controls="bag"
            aria-expanded={bagOpen}
            onClick={() => setBagOpen(true)}
            ref={bagButtonRef}
          >
            <span>{t.bag}</span>
            <span className="bag-count" aria-live="polite">
              {count}
            </span>
          </button>
        </div>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <h1 id="hero-title">{t.heroTitle}</h1>
            <p className="hero-lede">{t.heroLede}</p>
            <a className="button button-primary" href="#products">
              {t.browse}
            </a>
          </div>
          <div className="hero-mark" aria-hidden="true">
            <HeroMark />
          </div>
          <div className="hero-note">
            <span>{t.physicalGoods}</span>
            <span>{t.shipsFrom}</span>
            <span>{t.smallBatch}</span>
          </div>
        </section>

        <section className="catalog" id="products" aria-labelledby="products-title">
          <div className="section-heading">
            <h2 id="products-title">{t.productsTitle}</h2>
            <p>{t.productsIntro}</p>
          </div>
          <div className="product-grid" id="product-grid">
            {products.map((product) => (
              <article className="product-card" data-product-id={product.id} key={product.id}>
                <div className="product-image">
                  <img
                    className="product-photo"
                    src={`/products/${product.image}`}
                    alt={product.alt}
                    width="1200"
                    height="900"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <div className="product-meta">
                  <div>
                    <h3>{product.name[language]}</h3>
                    <p>{product.detail[language]}</p>
                  </div>
                  <span className="product-price">{currency(product.price, language)}</span>
                </div>
                <button className="add-button" type="button" onClick={() => addProduct(product.id)}>
                  {t.add}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="delivery" id="delivery" aria-labelledby="delivery-title">
          <div className="delivery-title-block">
            <h2 id="delivery-title">{t.deliveryTitle}</h2>
            <p>{t.deliveryIntro}</p>
          </div>
          <div className="policy-list">
            <article>
              <h3>{t.dispatchTitle}</h3>
              <p>{t.dispatchText}</p>
            </article>
            <article>
              <h3>{t.shippingTitle}</h3>
              <p>{t.shippingText}</p>
            </article>
            <article>
              <h3>{t.returnsTitle}</h3>
              <p>{t.returnsText}</p>
            </article>
            <article>
              <h3>{t.supportTitle}</h3>
              <p>
                {t.supportText} <a href="mailto:shqingda@gmail.com">shqingda@gmail.com</a>
              </p>
            </article>
          </div>
        </section>

        <section className="about" id="about" aria-labelledby="about-title">
          <div className="about-mark" aria-hidden="true">
            <img src="/mark.svg" alt="" />
          </div>
          <div>
            <h2 id="about-title">{t.aboutTitle}</h2>
            <p>{t.aboutText}</p>
            <a href="https://github.com/shqingda/moose" rel="noreferrer">
              {t.learnMoose}
            </a>
          </div>
        </section>
      </main>

      <footer>
        <Brand footer />
        <div className="footer-links">
          <a href="#delivery">{t.footerShipping}</a>
          <a href="mailto:shqingda@gmail.com">{t.footerContact}</a>
        </div>
        <p>© {new Date().getFullYear()} Moose Supply</p>
      </footer>

      <div className="scrim" onClick={closeBag} hidden={!bagOpen} />
      <aside
        className={`bag${bagOpen ? ' is-open' : ''}`}
        id="bag"
        aria-labelledby="bag-title"
        aria-hidden={!bagOpen}
      >
        <div className="bag-header">
          <h2 id="bag-title">{t.bagTitle}</h2>
          <button
            className="icon-button"
            type="button"
            onClick={closeBag}
            aria-label="关闭购物袋"
            ref={bagCloseRef}
          >
            ×
          </button>
        </div>
        <div className="bag-items" id="bag-items">
          {entries.map(({ product, quantity }) => (
            <article className="bag-item" key={product.id}>
              <div>
                <h3>{product.name[language]}</h3>
                <p>{currency(product.price * quantity, language)}</p>
              </div>
              <div className="bag-item-actions">
                <div className="quantity-control" aria-label={t.quantity}>
                  <button
                    type="button"
                    onClick={() => changeQuantity(product.id, -1)}
                    aria-label={`${t.decrease}：${product.name[language]}`}
                  >
                    −
                  </button>
                  <span aria-live="polite">{quantity}</span>
                  <button
                    type="button"
                    onClick={() => changeQuantity(product.id, 1)}
                    aria-label={`${t.increase}：${product.name[language]}`}
                  >
                    +
                  </button>
                </div>
                <button
                  className="remove-item"
                  type="button"
                  onClick={() => changeQuantity(product.id, -quantity)}
                >
                  {t.remove}
                </button>
              </div>
            </article>
          ))}
        </div>
        <div className="bag-empty" id="bag-empty" hidden={entries.length > 0}>
          <p>{t.emptyBag}</p>
          <button className="text-button" type="button" onClick={closeBag}>
            {t.continueShopping}
          </button>
        </div>
        <div className="bag-summary" id="bag-summary" hidden={entries.length === 0}>
          <div>
            <span>{t.subtotal}</span>
            <strong id="subtotal">{currency(total, language)}</strong>
          </div>
          <p>{t.shippingAtOrder}</p>
          <button
            className="button button-primary checkout-button"
            type="button"
            onClick={reviewOrder}
          >
            {t.checkout}
          </button>
        </div>
      </aside>

      <dialog className="order-dialog" id="order-dialog" ref={orderDialogRef}>
        <button
          className="icon-button dialog-close"
          type="button"
          aria-label="关闭"
          onClick={() => orderDialogRef.current?.close()}
        >
          ×
        </button>
        <h2>{t.orderTitle}</h2>
        <p>{t.orderText}</p>
        <pre id="order-copy">{orderText}</pre>
        <button className="button button-primary copy-order" type="button" onClick={copyOrder}>
          {copyLabel}
        </button>
      </dialog>
    </>
  );
}
