(function () {
  'use strict';

  // Only run on listing detail pages — not search results
  const isDetailPage =
    /zillow\.com\/homedetails\//.test(location.href) ||
    /zillow\.com\/b\//.test(location.href);
  if (!isDetailPage) return;

  // Don't inject twice (handles SPA navigation)
  if (document.getElementById('dd-copy-btn')) return;

  // ── Button ─────────────────────────────────────────────────────────────────
  const btn = document.createElement('button');
  btn.id = 'dd-copy-btn';
  btn.textContent = '📋 Copy to DormDrop';
  Object.assign(btn.style, {
    position:     'fixed',
    bottom:       '24px',
    right:        '24px',
    zIndex:       '2147483647',
    background:   '#0E6E6E',
    color:        '#fff',
    border:       'none',
    borderRadius: '10px',
    padding:      '13px 20px',
    fontSize:     '14px',
    fontWeight:   '600',
    fontFamily:   'system-ui, -apple-system, sans-serif',
    cursor:       'pointer',
    boxShadow:    '0 4px 18px rgba(14,110,110,.4)',
    transition:   'background .15s ease',
    letterSpacing: '-.2px',
    lineHeight:   '1'
  });

  btn.addEventListener('mouseenter', () => { btn.style.background = '#0a5a5a'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = '#0E6E6E'; });
  btn.addEventListener('click', onCopy);
  document.body.appendChild(btn);

  // ── Click handler ──────────────────────────────────────────────────────────
  function onCopy() {
    btn.textContent = '⏳ Extracting…';
    btn.disabled = true;

    try {
      const raw  = extractListing();
      const code = formatListing(raw);

      navigator.clipboard.writeText(code).then(function () {
        toast('✅ Copied! Paste into your listings array.', '#0E6E6E');
      }).catch(function () {
        // Clipboard API requires user gesture — show text in a modal instead
        showFallbackModal(code);
      });
    } catch (err) {
      toast('❌ ' + err.message, '#DC2626');
    } finally {
      btn.textContent = '📋 Copy to DormDrop';
      btn.disabled = false;
    }
  }

  // ── Data extraction ────────────────────────────────────────────────────────
  function extractListing() {
    // Primary: parse __NEXT_DATA__ (Zillow runs on Next.js — all data is here)
    var fromNext = extractFromNextData();
    if (fromNext && fromNext.addrStr) return fromNext;

    // Fallback: scrape the visible DOM
    return extractFromDOM();
  }

  // Strategy 1 — __NEXT_DATA__ JSON blob
  function extractFromNextData() {
    var el = document.getElementById('__NEXT_DATA__');
    if (!el) return null;

    var nextData;
    try { nextData = JSON.parse(el.textContent); } catch (e) { return null; }

    var pp = nextData && nextData.props && nextData.props.pageProps;
    if (!pp) return null;

    var prop = null;

    // homedetails pages store data in gdpClientCache (a nested JSON string)
    if (pp.gdpClientCache) {
      try {
        var cache = JSON.parse(pp.gdpClientCache);
        var keys = Object.keys(cache);
        for (var i = 0; i < keys.length; i++) {
          var entry = cache[keys[i]];
          if (entry && entry.property)            { prop = entry.property; break; }
          if (entry && entry.data && entry.data.property) { prop = entry.data.property; break; }
        }
      } catch (e) {}
    }

    // apartment building pages
    if (!prop && pp.componentProps && pp.componentProps.hdpData) {
      prop = pp.componentProps.hdpData.homeInfo || pp.componentProps.hdpData;
    }

    // initialData pattern
    if (!prop && pp.initialData && pp.initialData.building) {
      var b = pp.initialData.building;
      prop = {
        address:     { streetAddress: b.streetAddress || b.address, city: b.city, state: b.state },
        price:       b.price || b.rent || b.listPrice,
        bedrooms:    b.bedrooms || b.beds,
        bathrooms:   b.bathrooms || b.baths,
        livingArea:  b.livingArea || b.sqft,
        description: b.description,
        homeType:    b.homeType || b.propertyType
      };
    }

    if (!prop) return null;
    return normalizeProperty(prop);
  }

  function normalizeProperty(p) {
    var addr  = p.address || {};
    var parts = [
      addr.streetAddress || p.streetAddress || '',
      addr.city          || p.city          || '',
      addr.state         || p.state         || ''
    ].filter(Boolean);
    var addrStr = parts.join(', ');

    var rawPrice = p.price || p.listPrice || p.rentZestimate || p.zestimate || 0;
    var price = typeof rawPrice === 'number'
      ? rawPrice
      : parseInt(String(rawPrice).replace(/\D/g, '')) || 0;

    var beds  = parseInt(p.bedrooms  || p.beds  || 0) || 0;
    var baths = parseFloat(p.bathrooms || p.baths || 0) || 0;
    var sqft  = parseInt(p.livingArea || p.livingAreaValue || p.sqft || 0) || 0;
    var desc  = (p.description || p.homeDescription || '').trim();
    var homeType  = (p.homeType || '').toLowerCase();
    var furnished = /furnished/i.test(desc);

    return { addrStr: addrStr, price: price, beds: beds, baths: baths,
             sqft: sqft, desc: desc, homeType: homeType, furnished: furnished };
  }

  // Strategy 2 — DOM scraping
  function extractFromDOM() {
    // Address from h1
    var h1 = document.querySelector('h1');
    var addrStr = h1 ? h1.textContent.trim() : '';

    // Price — try known selectors, then regex
    var price = 0;
    var priceSelectors = [
      '[data-testid="price"]',
      '[data-testid="summary-container"] [class*="price"]',
      'span[class*="Price"]',
      '[class*="list-price"]'
    ];
    for (var i = 0; i < priceSelectors.length; i++) {
      var el = document.querySelector(priceSelectors[i]);
      if (el) {
        var val = parseInt(el.textContent.replace(/\D/g, ''));
        if (val > 100) { price = val; break; }
      }
    }
    if (!price) {
      var m = document.body.innerText.match(/\$\s*([\d,]+)\s*\/\s*mo/i);
      if (m) price = parseInt(m[1].replace(/,/g, ''));
    }

    // Beds / baths / sqft from page text
    var bodyText = document.body.innerText;
    var beds = 0, baths = 0, sqft = 0;

    var bedsM  = bodyText.match(/(\d+)\s*(?:bd|bed|beds|bedroom)/i);
    if (bedsM)  beds  = parseInt(bedsM[1]);

    var bathsM = bodyText.match(/([\d.]+)\s*(?:ba|bath|baths|bathroom)/i);
    if (bathsM) baths = parseFloat(bathsM[1]);

    var sqftM  = bodyText.match(/([\d,]+)\s*sqft/i);
    if (sqftM)  sqft  = parseInt(sqftM[1].replace(/,/g, ''));

    // Description
    var descSelectors = [
      '[data-testid="listing-description-text"]',
      '[data-testid="listing-description"]',
      '[data-testid="description-text"]',
      '[class*="description-text"]',
      '[class*="Description"]'
    ];
    var desc = '';
    for (var j = 0; j < descSelectors.length; j++) {
      var d = document.querySelector(descSelectors[j]);
      if (d && d.textContent.length > 50) { desc = d.textContent.trim(); break; }
    }

    var furnished = /furnished/i.test(desc + bodyText.slice(0, 3000));

    return { addrStr: addrStr, price: price, beds: beds, baths: baths,
             sqft: sqft, desc: desc, homeType: '', furnished: furnished };
  }

  // ── Formatting — output matches DormDrop listing object exactly ────────────
  var BG_COLORS = ['li-1','li-2','li-3','li-4','li-5','li-6'];
  var DORM_COST = 1300; // ~$15,600/yr BU dorm ÷ 12

  function emojiFor(homeType, beds) {
    if (/apartment|condo/i.test(homeType)) return '🏢';
    if (/townhouse/i.test(homeType))       return '🏘️';
    if (/studio/i.test(homeType) || beds === 0) return '🏗️';
    if (/house/i.test(homeType) && beds >= 3)   return '🏠';
    return '🏡';
  }

  function formatListing(d) {
    var addrStr  = d.addrStr  || 'Address unknown';
    var price    = d.price    || 0;
    var beds     = d.beds     || 0;
    var baths    = d.baths    || 0;
    var sqft     = d.sqft     || 0;
    var desc     = d.desc     || '';
    var homeType = d.homeType || '';
    var furnished = !!d.furnished;

    // id — use last 4 digits of timestamp so it's unique each paste session
    var id   = Date.now() % 9000 + 1000;
    var bg   = BG_COLORS[id % 6];
    var em   = emojiFor(homeType, beds);
    var type = beds <= 1 ? '1br' : beds === 2 ? '2br' : '3br';

    // Price string — if multi-bedroom, show per-person
    var priceStr = price ? '$' + price.toLocaleString() : '$0';
    var per = beds > 1 ? '/mo per person' : '/mo';

    // Savings vs BU dorm
    var pricePerPerson = (beds > 1 && price > 0) ? Math.round(price / beds) : price;
    var savN = Math.max(0, Math.round((DORM_COST - pricePerPerson) * 12));
    var saving = savN > 0
      ? 'Saves ~$' + savN.toLocaleString() + ' / yr vs dorm'
      : 'Compare vs dorm rates';

    // Tags
    var tags = [];
    if (beds)  tags.push(beds + ' Bed');
    if (baths > 1) tags.push(baths + ' Bath');
    if (furnished) tags.push('Fully Furnished');
    // Pull neighborhood from address (last meaningful segment before state)
    var addrParts = addrStr.split(',');
    if (addrParts.length >= 2) {
      var hood = addrParts[addrParts.length - 2].trim();
      if (hood && !/^[A-Z]{2}$/.test(hood)) tags.push(hood);
    }

    // Truncate description — keep under 250 chars so it doesn't bloat the array
    var shortDesc = desc.length > 240
      ? desc.slice(0, 237).trimRight() + '...'
      : desc;

    // Escape single quotes in strings
    function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' '); }

    return (
      "{id:" + id + ",bg:'" + bg + "',em:'" + em + "',badge:'New',bc:'b-new'," +
      "price:'" + esc(priceStr) + "',per:'" + per + "'," +
      "addr:'" + esc(addrStr) + "'," +
      "beds:" + beds + ",baths:" + baths + ",sqft:" + sqft + ",avail:'Sep 1'," +
      "tags:" + JSON.stringify(tags) + "," +
      "saving:'" + esc(saving) + "',savN:" + savN + "," +
      "desc:'" + esc(shortDesc) + "'," +
      "type:'" + type + "',furnished:" + furnished + "}"
    );
  }

  // ── Toast notification ─────────────────────────────────────────────────────
  function toast(msg, color) {
    var t = document.createElement('div');
    t.textContent = msg;
    Object.assign(t.style, {
      position:     'fixed',
      bottom:       '78px',
      right:        '24px',
      background:   color || '#0E6E6E',
      color:        '#fff',
      padding:      '10px 16px',
      borderRadius: '8px',
      fontSize:     '13px',
      fontWeight:   '600',
      fontFamily:   'system-ui, sans-serif',
      zIndex:       '2147483647',
      boxShadow:    '0 4px 12px rgba(0,0,0,.25)',
      opacity:      '1',
      transition:   'opacity .35s ease',
      maxWidth:     '320px'
    });
    document.body.appendChild(t);
    setTimeout(function () {
      t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 400);
    }, 2500);
  }

  // ── Fallback modal (if clipboard is blocked) ───────────────────────────────
  function showFallbackModal(code) {
    var overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,.55)',
      zIndex: '2147483647', display: 'flex', alignItems: 'center', justifyContent: 'center'
    });

    var modal = document.createElement('div');
    Object.assign(modal.style, {
      background: '#fff', borderRadius: '14px', padding: '24px',
      maxWidth: '600px', width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,.3)',
      fontFamily: 'system-ui, sans-serif'
    });

    modal.innerHTML =
      '<div style="font-weight:700;font-size:16px;margin-bottom:8px">📋 Copy this into your listings array</div>' +
      '<textarea id="dd-fallback-ta" readonly style="width:100%;height:120px;font-size:12px;' +
        'font-family:monospace;border:1px solid #ddd;border-radius:8px;padding:10px;' +
        'resize:none;box-sizing:border-box"></textarea>' +
      '<div style="display:flex;gap:8px;margin-top:12px">' +
        '<button id="dd-fallback-copy" style="background:#0E6E6E;color:#fff;border:none;' +
          'border-radius:8px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;flex:1">' +
          'Copy</button>' +
        '<button id="dd-fallback-close" style="background:#f3f4f6;color:#374151;border:none;' +
          'border-radius:8px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer">' +
          'Close</button>' +
      '</div>';

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var ta = document.getElementById('dd-fallback-ta');
    ta.value = code;
    ta.select();

    document.getElementById('dd-fallback-copy').addEventListener('click', function () {
      ta.select();
      document.execCommand('copy');
      this.textContent = '✅ Copied!';
    });
    document.getElementById('dd-fallback-close').addEventListener('click', function () {
      overlay.remove();
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });
  }

})();
