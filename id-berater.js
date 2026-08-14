// ==UserScript==
// @name         Interdiscount Berater Tool
// @namespace    https://local.interdiscount-berater
// @version      3.1.0
// @description  Mobiles Berater-Tool fuer Interdiscount-Produktseiten
// @match        https://www.interdiscount.ch/*
// @match        https://www.interdiscount.test/*
// @require      https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  // ============================================================
  // CONFIG
  // ============================================================

  var CONFIG = {
    IDS: {
      stickyBar: "idb-sticky-bar",
      overlay: "idb-overlay",
      style: "idb-style",
      toast: "idb-toast",
      spacer: "idb-spacer"
    },
    KEYS: {
      settings: "idb-settings",
      cart: "idb-cart",
      debug: "idb_debug"
    },
    VERSION: "3.1.0",
    PREFIX: "[ID-Berater]",
    RETRY: [0, 250, 700, 1800],
    SHORT_SPEC_GROUPS: 4,
    CART_SCHEMA: 2,
    MAX_DIAGNOSTICS: 200,
    SPEC_EXPAND_MAX: 5,
    LEGAL: "Preis- und Sortimentsänderungen vorbehalten. Alle Angaben ohne Gewähr. Massgebend sind die aktuellen Preise und Bedingungen auf interdiscount.ch."
  };

  // ============================================================
  // SERVICE PACKAGES
  // Conservative rules: avoid offering setup packages on accessories.
  // ============================================================

  var ACCESSORY_BLOCK = /hülle|huelle|case|cover|schutzglas|folie|display.?schutz|ladegerät|ladegeraet|charger|kabel|adapter|halterung|tasche|sleeve|keyboard|tastatur|maus|mouse|stift|pen|stylus|dock|docking|powerbank|kopfhörer|kopfhoerer|headset|zubehör|zubehoer/i;

  var SERVICE_PACKAGES = [
    {
      group: "Mobile Easy Services",
      match: /\b(handy|smartphone|iphone|ipad|tablet|galaxy\s*tab|surface\s*go|mobile)\b/i,
      exclude: ACCESSORY_BLOCK,
      items: [
        { name: "Mobile Easy Basic", amount: 29.95 },
        { name: "Mobile Easy Comfort", amount: 49.95 },
        { name: "Mobile Easy Transfer", amount: 39.95 },
        { name: "Mobile Easy Anticrash", amount: 34.95 },
        { name: "Mobile Easy Privacy", amount: 39.95 },
        { name: "Mobile Easy Antiglare", amount: 39.95 },
        { name: "Mobile Easy Anticrash16", amount: 44.95 }
      ]
    },
    {
      group: "PC Easy Services – Windows",
      match: /laptop|notebook|desktop|computer|\bpc\b|thinkpad|ideapad|pavilion|surface\s*pro|surface\s*laptop|windows/i,
      exclude: /macbook|imac|macos|\bmac\b/i,
      items: [
        { name: "PC Easy Service 1 (Windows)", amount: 99.95 },
        { name: "PC Easy Service 2 (Windows)", amount: 139.95 }
      ]
    },
    {
      group: "Mac Easy Services",
      match: /macbook|imac|macos|apple\s+mac|\bmac\b/i,
      exclude: ACCESSORY_BLOCK,
      items: [
        { name: "MAC Easy Service 1", amount: 69.95 },
        { name: "MAC Easy Service 2", amount: 99.95 }
      ]
    }
  ];

  // ============================================================
  // SPEC GROUPING
  // ============================================================

  var SPEC_GROUP_MAP = [
    { key: "allgemein",    label: "Allgemein",                 match: /^(marke|brand|hersteller|modell|farbe|serie|produkttyp|produktlinie|ean|gtin|gewicht$)/i },
    { key: "display",      label: "Display",                   match: /display|bildschirm|screen|aufl.sung|lcd|oled|amoled|retina|refresh|bildwiederhol|nit|ppi/i },
    { key: "kamera",       label: "Kamera",                    match: /kamera|camera|megapixel|blende|zoom|video.*aufnahme|selfie|weitwinkel|makro/i },
    { key: "speicher",     label: "Speicher",                  match: /speicher|storage|ram|arbeitsspeicher|intern.*speicher|ssd|hdd|festplatte|kapazit/i },
    { key: "prozessor",    label: "Prozessor",                 match: /prozessor|cpu|chip|kern|core|ghz|apple.*m\d|snapdragon|dimensity/i },
    { key: "grafik",       label: "Grafik",                    match: /grafik|gpu|graphics|geforce|radeon|intel\s*(arc|iris|uhd)|vram/i },
    { key: "akku",         label: "Akku & Energie",            match: /akku|batterie|battery|mah|laufzeit|laden|watt|wireless.*charg|induktiv/i },
    { key: "konnektiv",    label: "Konnektivität",             match: /wifi|wi-fi|wlan|bluetooth|nfc|5g|4g|lte|sim|esim|usb|anschluss|port|hdmi|thunderbolt|ethernet|infrarot|gps/i },
    { key: "betriebssys",  label: "Betriebssystem",            match: /betriebssystem|\bos\b|android|ios|windows|macos|chrome.*os/i },
    { key: "dimension",    label: "Abmessungen",               match: /abmessung|dimension|breite|h.he|tiefe|l.nge|masse|format|zoll|inch|cm\b|mm\b|gewicht.*g\b/i },
    { key: "energie",      label: "Energie & Nachhaltigkeit",   match: /energieeffizienz|energielabel|verbrauch|kwh|standby|nachhaltig|recycl/i },
    { key: "lieferumfang", label: "Lieferumfang",               match: /lieferumfang|im.*lieferumfang|mitgeliefert|zubeh.r.*enthalten|paket.*inhalt/i }
  ];

  // ============================================================
  // STATE / RUNTIME
  // ============================================================

  var state = {
    debugEnabled: false,
    lastClassification: null,
    lastProduct: null,
    diagnostics: [],
    cartSummary: null,
    productCache: null,
    productCacheUrl: null,
    lastRouteUrl: location.href,
    mutationScheduled: false
  };

  var runtime = window.__ID_BERATER__ || {};
  runtime.version = CONFIG.VERSION;
  runtime.startedAt = new Date().toISOString();
  runtime.status = "booting";
  window.__ID_BERATER__ = runtime;

  // ============================================================
  // UTIL
  // ============================================================

  function safeText(v) {
    return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  }

  function escapeHtml(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function debugLog(type, payload) {
    state.diagnostics.push({
      time: new Date().toISOString(),
      level: "debug",
      type: type,
      payload: payload == null ? null : payload
    });
    if (state.diagnostics.length > CONFIG.MAX_DIAGNOSTICS) state.diagnostics.shift();
    if (state.debugEnabled) console.log(CONFIG.PREFIX, type, payload == null ? "" : payload);
  }

  function debugError(type, err) {
    var payload = {
      message: err && err.message ? err.message : String(err || "Unbekannter Fehler"),
      stack: err && err.stack ? err.stack : ""
    };
    state.diagnostics.push({ time: new Date().toISOString(), level: "error", type: type, payload: payload });
    if (state.diagnostics.length > CONFIG.MAX_DIAGNOSTICS) state.diagnostics.shift();
    if (state.debugEnabled) console.error(CONFIG.PREFIX, type, err);
  }

  function debounce(fn, ms) {
    var t = 0;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function nowIso() { return new Date().toISOString(); }

  function getCanonicalUrl() {
    var can = document.querySelector("link[rel='canonical']");
    var u = can ? safeText(can.getAttribute("href")) : "";
    return u || location.href;
  }

  // ============================================================
  // DOM
  // ============================================================

  function isVisible(n) {
    if (!n || !n.isConnected) return false;
    var s = getComputedStyle(n);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    var r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function queryAll(sels, root) {
    var s = root || document, r = [], seen = new Set();
    for (var i = 0; i < sels.length; i++) {
      var ns;
      try { ns = s.querySelectorAll(sels[i]); } catch (e) { continue; }
      for (var j = 0; j < ns.length; j++) {
        if (!seen.has(ns[j])) { seen.add(ns[j]); r.push(ns[j]); }
      }
    }
    return r;
  }

  function queryFirst(sels, root) {
    var s = root || document;
    for (var i = 0; i < sels.length; i++) {
      try {
        var n = s.querySelector(sels[i]);
        if (n) return n;
      } catch (e) {}
    }
    return null;
  }

  // ============================================================
  // PRICE
  // Supports: 1299 | 1299.- | 1299.95 | 1'299.95 | 1’299.95 |
  //           1,299.95 | 1.299,95 | CHF 1'299.–
  // ============================================================

  function formatPrice(a) {
    if (typeof a !== "number" || !isFinite(a)) return "";
    var p = a.toFixed(2).split(".");
    return "CHF " + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, "'") + "." + p[1];
  }

  function normalizePriceToken(token) {
    var t = safeText(token)
      .replace(/CHF/gi, "")
      .replace(/[’‘`´]/g, "'")
      .replace(/[–—]/g, "-")
      .replace(/\s+/g, "")
      .replace(/\.-$/g, ".00")
      .replace(/,-$/g, ",00")
      .replace(/-$/g, ".00")
      .replace(/[^0-9'.,]/g, "");

    if (!t || !/\d/.test(t)) return null;

    // Determine decimal separator.
    var lastDot = t.lastIndexOf(".");
    var lastComma = t.lastIndexOf(",");
    var decSep = null;
    var decPos = -1;

    if (lastDot >= 0 && lastComma >= 0) {
      // The right-most separator is decimal if followed by exactly two digits.
      var rp = Math.max(lastDot, lastComma);
      if (/^[0-9]{2}$/.test(t.slice(rp + 1))) {
        decSep = t.charAt(rp);
        decPos = rp;
      }
    } else {
      var onlyPos = Math.max(lastDot, lastComma);
      if (onlyPos >= 0 && /^[0-9]{2}$/.test(t.slice(onlyPos + 1))) {
        decSep = t.charAt(onlyPos);
        decPos = onlyPos;
      }
    }

    var intPart = decPos >= 0 ? t.slice(0, decPos) : t;
    var decPart = decPos >= 0 ? t.slice(decPos + 1) : "00";
    intPart = intPart.replace(/[',.]/g, "");

    if (!/^\d+$/.test(intPart)) return null;
    if (!/^\d{2}$/.test(decPart)) decPart = "00";

    var amount = Number(intPart + "." + decPart);
    return isFinite(amount) ? amount : null;
  }

  function parseSwissPrice(v) {
    var text = safeText(v)
      .replace(/[’‘`´]/g, "'")
      .replace(/[–—]/g, "-");

    if (!text) return null;

    // Longest / most specific forms first to avoid "129" from "1299.95".
    var re = /(?:CHF\s*)?(?:\d{1,3}(?:['.,]\d{3})+|\d+)(?:[.,]\d{2}|[.,]-|-)?/gi;
    var matches = text.match(re) || [];

    for (var i = 0; i < matches.length; i++) {
      var amount = normalizePriceToken(matches[i]);
      if (amount != null) {
        return {
          raw: safeText(matches[i]),
          amount: amount,
          formatted: formatPrice(amount)
        };
      }
    }
    return null;
  }

  // ============================================================
  // STORAGE + MIGRATION
  // ============================================================

  function getStore(k, fallback) {
    try {
      var raw = localStorage.getItem(k);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      debugError("storage-read", e);
      return fallback;
    }
  }

  function setStore(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
      return true;
    } catch (e) {
      debugError("storage-write", e);
      return false;
    }
  }

  function getSettings() {
    var s = getStore(CONFIG.KEYS.settings, {});
    if (!s || typeof s !== "object" || Array.isArray(s)) s = {};
    return {
      advisorName: safeText(s.advisorName || ""),
      branch: safeText(s.branch || "")
    };
  }

  function normalizeService(s) {
    if (!s || typeof s !== "object") return null;
    var amount = Number(s.amount);
    if (!isFinite(amount)) amount = 0;
    return {
      name: safeText(s.name || "Service"),
      amount: amount
    };
  }

  function normalizeCartItem(it) {
    if (!it || typeof it !== "object") return null;
    var basePrice = Number(it.basePrice);
    if (!isFinite(basePrice)) basePrice = 0;
    var svcs = Array.isArray(it.selectedServices) ? it.selectedServices.map(normalizeService).filter(Boolean) : [];
    return {
      id: it.id || (Date.now() + Math.floor(Math.random() * 100000)),
      name: safeText(it.name || "Produkt"),
      basePrice: basePrice,
      selectedServices: svcs,
      imageUrl: safeText(it.imageUrl || ""),
      url: safeText(it.url || ""),
      articleNumber: safeText(it.articleNumber || ""),
      createdAt: it.createdAt || nowIso(),
      priceCapturedAt: it.priceCapturedAt || it.createdAt || nowIso(),
      toolVersion: it.toolVersion || "3.0.0"
    };
  }

  function getCart() {
    var raw = getStore(CONFIG.KEYS.cart, []);
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeCartItem).filter(Boolean);
  }

  function saveCart(cart) {
    var normalized = Array.isArray(cart) ? cart.map(normalizeCartItem).filter(Boolean) : [];
    setStore(CONFIG.KEYS.cart, normalized);
    summarizeCart();
  }

  function calcCartTotal(cart) {
    var t = 0;
    (cart || []).forEach(function (it) {
      t += Number(it.basePrice) || 0;
      (it.selectedServices || []).forEach(function (s) { t += Number(s.amount) || 0; });
    });
    return t;
  }

  function summarizeCart() {
    var c = getCart();
    var t = calcCartTotal(c);
    state.cartSummary = { count: c.length, total: t, formatted: formatPrice(t) };
    return state.cartSummary;
  }

  // ============================================================
  // JSON-LD / PRODUCT DATA
  // ============================================================

  function flattenJsonLd(value, out) {
    out = out || [];
    if (!value) return out;
    if (Array.isArray(value)) {
      value.forEach(function (x) { flattenJsonLd(x, out); });
      return out;
    }
    if (typeof value === "object") {
      out.push(value);
      if (Array.isArray(value["@graph"])) flattenJsonLd(value["@graph"], out);
    }
    return out;
  }

  function extractJsonLd() {
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      try {
        var parsed = JSON.parse(scripts[i].textContent || "null");
        var items = flattenJsonLd(parsed, []);
        for (var j = 0; j < items.length; j++) {
          var type = items[j] && items[j]["@type"];
          var types = Array.isArray(type) ? type : [type];
          if (types.indexOf("Product") !== -1 || types.indexOf("IndividualProduct") !== -1) return items[j];
        }
      } catch (e) {
        debugLog("jsonld-parse-failed", e.message);
      }
    }
    return null;
  }

  function extractArticleNumber() {
    var attrNodes = queryAll(["[data-article-number]", "[data-sku]", "[data-product-sku]"]);
    for (var i = 0; i < attrNodes.length; i++) {
      var v = attrNodes[i].getAttribute("data-article-number") || attrNodes[i].getAttribute("data-sku") || attrNodes[i].getAttribute("data-product-sku") || safeText(attrNodes[i].textContent);
      v = String(v || "").replace(/[^0-9]/g, "");
      if (v.length >= 6 && v.length <= 12) return v;
    }

    var textNodes = queryAll([".article-number", "[class*='article']", "[class*='sku']"]);
    for (var j = 0; j < textNodes.length; j++) {
      var m = safeText(textNodes[j].textContent).match(/(?:artikel(?:nummer|nr\.?)?|art\.?\s*(?:nr\.?)?)\s*:?\s*(\d{6,12})/i);
      if (m) return m[1];
    }

    var href = getCanonicalUrl();
    var um = href.match(/\/(\d{6,12})\/?(?:\?|#|$)/);
    if (um) return um[1];
    var pm = location.pathname.match(/-(\d{6,12})\/?$/);
    if (pm) return pm[1];

    var jl = extractJsonLd();
    if (jl && jl.sku) {
      var sku = String(jl.sku).replace(/[^0-9]/g, "");
      if (sku.length >= 6 && sku.length <= 12) return sku;
    }
    return null;
  }

  function extractSpecsFromDom() {
    var containers = queryAll([
      "[data-specs]", ".product-specs", ".specs", "[data-tech-specs]",
      "#redirect-collapsible-details", "[data-testid='collapsible-details']",
      "[data-testid='collapsible-specifications']", "[data-testid='product-specifications']",
      ".product-detail__specifications", ".specification-list",
      "[class*='specification']", "[class*='techspec']"
    ]);

    var specs = [];
    var seenPairs = {};

    function add(label, value) {
      label = safeText(label);
      value = safeText(value);
      if (!label) return;
      var key = label.toLowerCase() + "\u0000" + value.toLowerCase();
      if (seenPairs[key]) return;
      seenPairs[key] = true;
      specs.push({ label: label, value: value });
    }

    containers.forEach(function (ctr) {
      var rows = ctr.querySelectorAll("tr");
      for (var r = 0; r < rows.length; r++) {
        var cells = rows[r].querySelectorAll("td, th");
        if (cells.length >= 2) add(cells[0].textContent, cells[1].textContent);
      }

      var dts = ctr.querySelectorAll("dt");
      for (var d = 0; d < dts.length; d++) {
        var dd = dts[d].nextElementSibling;
        add(dts[d].textContent, dd ? dd.textContent : "");
      }

      var lis = ctr.querySelectorAll("li");
      for (var li = 0; li < lis.length; li++) {
        var t = safeText(lis[li].textContent);
        if (!t || t.length < 4 || t.length > 240) continue;
        var cs = t.match(/^(.+?):\s*(.+)$/);
        if (cs) add(cs[1], cs[2]);
      }

      var sr = ctr.querySelectorAll("[class*='spec-row'], [class*='specification-row']");
      for (var s = 0; s < sr.length; s++) {
        var ch = sr[s].children;
        if (ch.length >= 2) add(ch[0].textContent, ch[1].textContent);
      }
    });

    return specs;
  }

  function extractSpecsFromJsonLd(jl) {
    if (!jl) return [];
    var sp = [];
    if (Array.isArray(jl.additionalProperty)) {
      jl.additionalProperty.forEach(function (p) {
        if (p && p.name != null && p.value != null) {
          sp.push({ label: safeText(p.name), value: safeText(String(p.value)) });
        }
      });
    }
    var fixed = {
      "Marke": jl.brand && (jl.brand.name || jl.brand),
      "Farbe": jl.color,
      "Modell": jl.model
    };
    Object.keys(fixed).forEach(function (k) {
      if (fixed[k]) sp.push({ label: k, value: safeText(String(fixed[k])) });
    });
    return sp;
  }

  function mergeSpecs(a, b) {
    var merged = [], seen = {};
    function add(x) {
      if (!x || !safeText(x.label)) return;
      var label = safeText(x.label), value = safeText(x.value);
      var key = label.toLowerCase().replace(/\s+/g, "") + "\u0000" + value.toLowerCase().replace(/\s+/g, " ");
      if (seen[key]) return;
      seen[key] = true;
      merged.push({ label: label, value: value });
    }
    (a || []).forEach(add);
    (b || []).forEach(add);
    return merged;
  }

  function groupSpecs(specs) {
    var groups = [], groupMap = {}, otherSpecs = [];
    SPEC_GROUP_MAP.forEach(function (g) { groupMap[g.key] = { label: g.label, items: [] }; });

    (specs || []).forEach(function (s) {
      var matched = false;
      for (var i = 0; i < SPEC_GROUP_MAP.length; i++) {
        var rule = SPEC_GROUP_MAP[i].match;
        rule.lastIndex = 0;
        var a = rule.test(s.label || "");
        rule.lastIndex = 0;
        var b = rule.test(s.value || "");
        if (a || b) {
          groupMap[SPEC_GROUP_MAP[i].key].items.push(s);
          matched = true;
          break;
        }
      }
      if (!matched) otherSpecs.push(s);
    });

    SPEC_GROUP_MAP.forEach(function (g) {
      if (groupMap[g.key].items.length) groups.push(groupMap[g.key]);
    });
    if (otherSpecs.length) groups.push({ label: "Weitere Angaben", items: otherSpecs });
    return groups;
  }

  // ============================================================
  // SERVICES EXTRACTION
  // ============================================================

  function cleanServiceText(v) {
    var t = safeText(v)
      .replace(/[’‘`´]/g, "'")
      .replace(/[–—]/g, "-");

    t = t.replace(/^(?:CHF\s*)?(?:\d{1,3}(?:['.,]\d{3})+|\d+)(?:[.,]\d{2}|[.,]-|-)\s*/i, "");
    t = t.split(/Interdiscount verlängert|Mit unserer|Weitere Informationen|Mit dem Kauf bestätigen/i)[0];
    return safeText(t);
  }

  function extractServices() {
    var roots = queryAll(["[data-services]", ".services", "[data-service-options]", "[data-testid='collapsible-services']"]);
    var svcs = [], seen = {};

    roots.forEach(function (root) {
      var ns = root.querySelectorAll("li, [data-service-item], .service-option, label");
      for (var i = 0; i < ns.length; i++) {
        var raw = safeText(ns[i].textContent);
        var pr = parseSwissPrice(raw);
        var nm = cleanServiceText(raw);
        var key = nm.toLowerCase();
        if (nm && nm.length > 3 && !seen[key]) {
          seen[key] = true;
          svcs.push({ name: nm, price: pr });
        }
      }
    });

    return svcs;
  }

  // ============================================================
  // CATEGORY DETECTION / PACKAGES
  // ============================================================

  function extractBreadcrumb() {
    var bc = queryFirst(["[data-testid='breadcrumb']", ".breadcrumb", "nav[aria-label*='readcrumb']", "[class*='breadcrumb']", "ol[class*='bread']"]);
    return bc ? safeText(bc.textContent) : "";
  }

  function extractCategory() {
    var jl = extractJsonLd();
    if (jl && jl.category) return safeText(typeof jl.category === "string" ? jl.category : JSON.stringify(jl.category));
    var m = document.querySelector("meta[property='product:category']") || document.querySelector("meta[name='category']");
    return m ? safeText(m.getAttribute("content") || "") : "";
  }

  function getCategorySignal() {
    var h1 = queryFirst(["[data-product-title]", "[data-testid='product-title']", ".product-title", "main h1", "h1"]);
    return [extractBreadcrumb(), extractCategory(), h1 ? h1.textContent : "", location.pathname, document.title].join(" ").toLowerCase();
  }

  function getMatchingPackages() {
    var sig = getCategorySignal();
    var matched = [];

    SERVICE_PACKAGES.forEach(function (pkg) {
      pkg.match.lastIndex = 0;
      var isMatch = pkg.match.test(sig);
      var excluded = false;
      if (pkg.exclude) {
        pkg.exclude.lastIndex = 0;
        excluded = pkg.exclude.test(sig);
      }
      if (isMatch && !excluded) {
        matched.push({
          group: pkg.group,
          items: pkg.items.map(function (it) {
            return { name: it.name, amount: it.amount, formatted: formatPrice(it.amount) };
          })
        });
      }
    });

    return matched;
  }

  // ============================================================
  // PRODUCT DATA
  // Important in 3.1: user actions read fresh volatile data.
  // ============================================================

  function readMainPrice(jl) {
    // Prefer the visible DOM: on variant changes the UI is usually fresher than JSON-LD.
    var nodes = queryAll([
      "[data-main-price]", "[data-testid='main-price']",
      "[data-testid='pdp-product-price-discount']", "[data-testid='pdp-product-price']",
      ".price-box .price-current", ".price-box .price", ".buybox .price", "[data-price-box]"
    ]);

    for (var j = 0; j < nodes.length; j++) {
      if (!isVisible(nodes[j])) continue;
      var parsed = parseSwissPrice(nodes[j].textContent);
      if (parsed) return parsed;
    }

    // JSON-LD is a reliable fallback, especially during initial hydration.
    if (jl && jl.offers) {
      var offers = Array.isArray(jl.offers) ? jl.offers : [jl.offers];
      for (var i = 0; i < offers.length; i++) {
        var raw = offers[i] && offers[i].price;
        if (raw != null && raw !== "") {
          var amount = Number(String(raw).replace(/'/g, "").replace(",", "."));
          if (isFinite(amount)) return { raw: String(raw), amount: amount, formatted: formatPrice(amount) };
        }
      }
    }

    // Last resort: hidden main price selectors may still be valid during hydration.
    for (var k = 0; k < nodes.length; k++) {
      var p2 = parseSwissPrice(nodes[k].textContent);
      if (p2) return p2;
    }
    return null;
  }

  function getProductData(forceFresh) {
    if (!forceFresh && state.productCache && state.productCacheUrl === location.href) return state.productCache;

    var jl = extractJsonLd();
    var name = "";

    var h1 = queryFirst(["[data-product-title]", "[data-testid='product-title']", ".product-title", "main h1", "h1"]);
    if (h1) name = safeText(h1.textContent);
    if (!name && jl && jl.name) name = safeText(jl.name);
    if (!name) {
      var og = document.querySelector("meta[property='og:title']");
      if (og) name = safeText((og.getAttribute("content") || "").replace(/\s*[-–|]\s*Interdiscount\s*$/i, ""));
    }
    if (!name) name = safeText(document.title.replace(/\s*[-–|]\s*Interdiscount\s*$/i, ""));

    var price = readMainPrice(jl);

    var img = "";
    var iN = queryFirst(["[data-product-image] img", "img[data-main-image]", ".product-gallery img", "main img"]);
    if (iN && isVisible(iN)) img = iN.currentSrc || iN.getAttribute("src") || iN.getAttribute("data-src") || "";
    if (!img && jl && jl.image) {
      img = Array.isArray(jl.image) ? jl.image[0] : (typeof jl.image === "string" ? jl.image : (jl.image.url || ""));
    }
    if (!img) {
      var ogI = document.querySelector("meta[property='og:image']");
      if (ogI) img = ogI.getAttribute("content") || "";
    }

    var artNr = extractArticleNumber();
    var allSpecs = mergeSpecs(extractSpecsFromJsonLd(jl), extractSpecsFromDom());

    var brand = "";
    if (jl && jl.brand) brand = safeText(typeof jl.brand === "string" ? jl.brand : jl.brand.name || "");
    if (!brand) {
      var bs = allSpecs.find(function (s) { return /^(marke|brand|hersteller)$/i.test(safeText(s.label)); });
      if (bs) brand = bs.value;
    }

    var prod = {
      name: name,
      brand: brand,
      price: price,
      imageUrl: safeText(img),
      articleNumber: artNr,
      specs: allSpecs,
      specGroups: groupSpecs(allSpecs),
      services: extractServices(),
      url: getCanonicalUrl(),
      capturedAt: nowIso()
    };

    state.lastProduct = prod;
    state.productCache = prod;
    state.productCacheUrl = location.href;
    return prod;
  }

  function invalidateCache() {
    state.productCache = null;
    state.productCacheUrl = null;
  }

  // ============================================================
  // QR CODE – qrcode-generator 1.4.4 via @require
  // ============================================================

  function generateQrDataUrl(text, size) {
    size = size || 200;
    try {
      if (typeof qrcode !== "function") throw new Error("QR library unavailable");
      var qr = qrcode(0, "L");
      qr.addData(String(text || ""), "Byte");
      qr.make();
      // createDataURL(cellSize, margin)
      var modules = qr.getModuleCount();
      var margin = 4;
      var cellSize = Math.max(2, Math.floor(size / (modules + margin * 2)));
      return qr.createDataURL(cellSize, margin);
    } catch (e) {
      debugLog("qr-fallback", e.message);
      return null;
    }
  }

  function buildQrHtml(url, dim) {
    dim = dim || 80;
    var dataUrl = generateQrDataUrl(url, dim * 2);
    if (dataUrl) {
      return '<img src="' + dataUrl + '" width="' + dim + '" height="' + dim + '" style="image-rendering:pixelated;border-radius:4px" alt="QR zur Produktseite">';
    }
    return '<div class="idb-qr-fallback" aria-label="QR nicht verfügbar">LINK</div>';
  }

  // ============================================================
  // PAGE DETECT
  // ============================================================

  function isProductPage() {
    var h = location.hostname, p = location.pathname;
    var pathLooksProduct = p.indexOf("/product/") !== -1 || p.indexOf("/p/") !== -1;
    var hasProductSignal = !!extractJsonLd() || !!queryFirst(["[data-product-title]", "[data-testid='product-title']", ".product-title", "main h1"]);
    var ok = /interdiscount\.(ch|test)$/i.test(h) && pathLooksProduct && hasProductSignal;
    state.lastClassification = { pathname: p, isProduct: ok };
    return ok;
  }

  // ============================================================
  // STYLES
  // ============================================================

  function ensureStyles() {
    if (document.getElementById(CONFIG.IDS.style)) return;
    var s = document.createElement("style");
    s.id = CONFIG.IDS.style;
    s.textContent = buildCSS();
    (document.head || document.documentElement).appendChild(s);
  }

  function buildCSS() {
    var S = CONFIG.IDS;
    return [
      ":root{--idb-red:#D71920;--idb-ink:#111;--idb-muted:#6B7280;--idb-line:#E5E7EB;--idb-soft:#F8F9FB;--idb-dark:#111827}",
      "#"+S.stickyBar+"{position:fixed;bottom:0;left:0;right:0;z-index:2147483640;display:flex;align-items:center;gap:6px;padding:8px 10px;padding-bottom:calc(8px + env(safe-area-inset-bottom,16px));font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:rgba(255,255,255,.97);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-top:1px solid var(--idb-line);box-shadow:0 -2px 12px rgba(0,0,0,.05)}",
      "#"+S.stickyBar+" button{flex:1;min-height:40px;padding:8px 6px;border:1px solid var(--idb-line);border-radius:9px;font-size:12px;font-weight:700;background:#fff;color:var(--idb-ink);cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "#"+S.stickyBar+" button:disabled{opacity:.55;cursor:default}",
      "#"+S.stickyBar+" button[data-tone='red']{background:var(--idb-red);border-color:var(--idb-red);color:#fff}",
      "#"+S.stickyBar+" button[data-tone='dark']{background:var(--idb-dark);border-color:var(--idb-dark);color:#fff}",
      "#"+S.stickyBar+" .idb-bw{position:relative;flex:1}",
      "#"+S.stickyBar+" .idb-bw button{width:100%}",
      "#"+S.stickyBar+" .idb-pill{position:absolute;top:-4px;right:-4px;min-width:15px;height:15px;padding:0 3px;border-radius:99px;background:var(--idb-red);color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;line-height:1}",
      "#"+S.overlay+"{position:fixed;inset:0;z-index:2147483646;background:rgba(17,24,39,.45);overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}",
      "#"+S.overlay+" .idb-dialog{width:100%;max-width:680px;margin:0 auto;background:#fff;min-height:100%}",
      "#"+S.overlay+" .idb-topbar{position:sticky;top:0;z-index:2;display:flex;justify-content:flex-end;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--idb-line);background:rgba(255,255,255,.97);backdrop-filter:blur(8px)}",
      "#"+S.overlay+" .idb-topbar button{min-height:34px;padding:7px 12px;border:1px solid #D1D5DB;border-radius:8px;background:#fff;color:var(--idb-ink);font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}",
      "#"+S.overlay+" .idb-topbar [data-idb-pdf]{background:var(--idb-dark);border-color:var(--idb-dark);color:#fff}",
      "#"+S.overlay+" .idb-body{padding:14px;box-sizing:border-box;overflow-x:hidden}",
      ".idb-mode-tabs{display:flex;gap:6px;margin-bottom:10px}",
      ".idb-mode-tabs button{flex:1;padding:9px;border:2px solid var(--idb-line);border-radius:8px;background:#fff;font-size:12px;font-weight:700;color:var(--idb-muted);cursor:pointer}",
      ".idb-mode-tabs button.active{border-color:var(--idb-red);color:var(--idb-red);background:#FFF5F5}",
      ".idb-sheet{display:grid;gap:10px;width:100%;box-sizing:border-box}",
      ".idb-doc-card{display:grid;gap:8px;padding:12px;border:1px solid var(--idb-line);border-radius:10px;background:#fff;box-sizing:border-box}",
      ".idb-doc-hdr{display:grid;grid-template-columns:72px 1fr;gap:10px;align-items:start}",
      ".idb-doc-hdr img{width:72px;height:72px;object-fit:contain;border-radius:6px;background:var(--idb-soft);border:1px solid var(--idb-line)}",
      ".idb-doc-info{display:grid;gap:2px;min-width:0}",
      ".idb-brand{font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--idb-red)}",
      ".idb-doc-title{margin:0;font-size:14px;line-height:1.25;font-weight:700;color:var(--idb-ink);overflow-wrap:break-word}",
      ".idb-doc-price{font-size:17px;font-weight:800;color:var(--idb-red)}",
      ".idb-doc-meta{display:flex;flex-wrap:wrap;gap:4px;font-size:10px;color:var(--idb-muted)}",
      ".idb-doc-meta span{padding:2px 6px;background:var(--idb-soft);border-radius:4px;white-space:nowrap}",
      ".idb-section{padding:10px;border:1px solid var(--idb-line);border-radius:8px;background:#fff;box-sizing:border-box}",
      ".idb-section-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;font-size:11px;font-weight:700;color:var(--idb-ink)}",
      ".idb-section-hd span{font-weight:400;color:var(--idb-muted);font-size:10px}",
      ".idb-spec-grid{display:grid;gap:0}",
      ".idb-spec-row,.idb-svc-row{display:flex;justify-content:space-between;gap:6px;padding:4px 0;border-bottom:1px solid #F1F5F9;font-size:11px;line-height:1.4}",
      ".idb-spec-row:last-child,.idb-svc-row:last-child{border-bottom:0}",
      ".idb-spec-l{color:var(--idb-muted);flex-shrink:0;max-width:48%}",
      ".idb-spec-v{color:var(--idb-ink);font-weight:600;text-align:right;word-break:break-word;min-width:0}",
      ".idb-svc-row strong{color:var(--idb-muted);white-space:nowrap;font-weight:600}",
      ".idb-qr-row{display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--idb-line);border-radius:8px;background:#fff}",
      ".idb-qr-row img{flex-shrink:0}",
      ".idb-qr-row p{margin:0;font-size:9px;line-height:1.3;color:var(--idb-muted);word-break:break-all}",
      ".idb-qr-fallback{width:48px;height:48px;border:1px solid var(--idb-line);border-radius:4px;display:grid;place-items:center;font-size:8px;font-weight:700;color:var(--idb-muted);background:var(--idb-soft)}",
      ".idb-discl{font-size:7.5px;line-height:1.4;color:var(--idb-muted);padding:4px 0}",
      ".idb-empty{font-size:11px;color:var(--idb-muted)}",
      ".idb-off-card{display:grid;gap:0;padding:12px;border:1px solid var(--idb-line);border-radius:10px;background:#fff;box-sizing:border-box}",
      ".idb-off-hdr{display:flex;justify-content:space-between;gap:6px;align-items:flex-start;padding-bottom:8px;border-bottom:2px solid var(--idb-red)}",
      ".idb-off-hdr strong{display:block;font-size:16px;line-height:1.2;color:var(--idb-ink)}",
      ".idb-off-adv{margin-top:6px;padding:8px;border:1px solid var(--idb-line);border-radius:6px;background:var(--idb-soft);font-size:11px;color:var(--idb-ink)}",
      ".idb-off-items{display:grid;gap:0;margin-top:8px}",
      ".idb-off-item{padding:10px 0;border-bottom:1px solid var(--idb-line)}",
      ".idb-off-item:last-child{border-bottom:0}",
      ".idb-off-main{display:grid;grid-template-columns:40px 1fr auto 28px;gap:6px;align-items:start}",
      ".idb-off-img{width:40px;height:40px;border:1px solid var(--idb-line);border-radius:5px;background:var(--idb-soft);display:grid;place-items:center;overflow:hidden}",
      ".idb-off-img img{max-width:34px;max-height:34px;object-fit:contain}",
      ".idb-off-nm{font-size:12px;font-weight:700;color:var(--idb-ink);overflow-wrap:break-word}",
      ".idb-off-pr{font-size:12px;font-weight:700;color:var(--idb-ink);white-space:nowrap;text-align:right}",
      ".idb-off-svcs{margin-top:4px;padding-left:46px}",
      ".idb-off-svc{display:flex;justify-content:space-between;align-items:center;gap:6px;padding:3px 0;font-size:10px;color:var(--idb-muted)}",
      ".idb-off-svc .idb-svc-name{flex:1;min-width:0}",
      ".idb-off-svc .idb-svc-pr{white-space:nowrap;font-weight:600;color:var(--idb-ink)}",
      ".idb-del-btn{width:28px;height:28px;border:none;background:none;color:var(--idb-muted);font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:6px;padding:0;touch-action:manipulation}",
      ".idb-del-svc{width:18px;height:18px;border:none;background:none;color:#bbb;font-size:12px;cursor:pointer;padding:0;margin-left:2px;touch-action:manipulation}",
      ".idb-off-tot{display:flex;justify-content:space-between;align-items:flex-end;gap:6px;padding:10px 0 0;margin-top:6px;border-top:2px solid #111}",
      ".idb-off-tot strong{font-size:13px;color:var(--idb-ink)}",
      ".idb-off-tot span{font-size:20px;line-height:1;color:var(--idb-red);font-weight:800}",
      ".idb-off-foot{margin-top:8px;font-size:7.5px;line-height:1.4;color:var(--idb-muted)}",
      ".idb-set-wrap,.idb-ss{display:grid;gap:12px;padding:14px}",
      ".idb-set-wrap h1,.idb-ss h1{margin:0;font-size:17px;color:var(--idb-ink)}",
      ".idb-set-wrap p{margin:0;font-size:11px;color:var(--idb-muted)}",
      ".idb-fg{display:grid;gap:10px}",
      "#"+S.overlay+" label{display:grid;gap:4px;font-size:11px;font-weight:600;color:var(--idb-ink)}",
      "#"+S.overlay+" input{min-height:42px;padding:9px 10px;border:1px solid #D1D5DB;border-radius:8px;font-size:13px;color:var(--idb-ink);background:#fff;box-sizing:border-box}",
      ".idb-mf{display:flex;gap:6px;justify-content:flex-end}",
      ".idb-mf button{min-height:40px;padding:9px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer}",
      ".idb-mf [data-idb-save]{background:var(--idb-red);border:1px solid var(--idb-red);color:#fff}",
      ".idb-mf [data-idb-cancel]{background:#fff;border:1px solid #D1D5DB;color:var(--idb-ink)}",
      ".idb-ss-pr{font-size:17px;font-weight:800;color:var(--idb-red)}",
      ".idb-sopts{display:grid;gap:6px}",
      ".idb-sopt{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;padding:9px;border:1px solid var(--idb-line);border-radius:8px;background:#fff}",
      ".idb-sopt[data-disabled='1']{opacity:.55}",
      ".idb-sopt input{width:16px;height:16px;min-height:auto;padding:0}",
      ".idb-sopt strong{font-size:12px;color:var(--idb-ink)}",
      ".idb-sopt span{font-size:10px;color:var(--idb-muted);white-space:nowrap}",
      ".idb-ssub{width:100%;min-height:42px;padding:10px;border:1px solid var(--idb-red);border-radius:9px;background:var(--idb-red);color:#fff;font-size:13px;font-weight:700;cursor:pointer;box-sizing:border-box}",
      ".idb-pkg-hd{font-size:11px;font-weight:700;color:var(--idb-dark);margin:10px 0 4px;padding:6px 0 3px;border-bottom:1px solid var(--idb-line)}",
      "#"+S.toast+"{position:fixed;left:50%;bottom:calc(58px + env(safe-area-inset-bottom,16px));transform:translateX(-50%);z-index:2147483647;min-width:160px;max-width:min(88vw,340px);padding:8px 12px;border-radius:9px;background:#111827;color:#fff;box-shadow:0 10px 20px rgba(0,0,0,.18);display:grid;gap:1px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}",
      "#"+S.toast+" strong{font-size:11px}",
      "#"+S.toast+" span{font-size:10px;color:#d0d5dd}",
      "#"+S.spacer+"{height:calc(54px + env(safe-area-inset-bottom,16px))}",
      "@media(max-width:680px){#"+S.overlay+" .idb-dialog{max-width:none}.idb-doc-hdr{grid-template-columns:56px 1fr;gap:8px}.idb-doc-hdr img{width:56px;height:56px}}"
    ].join("\n");
  }

  // ============================================================
  // PRINT / PDF HTML
  // ============================================================

  function buildPdfCss() {
    return [
      "*{margin:0;padding:0;box-sizing:border-box}",
      "html,body{width:100%;background:#fff;color:#111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:10pt;line-height:1.4;-webkit-print-color-adjust:exact;print-color-adjust:exact}",
      "body{padding:8mm 10mm}",
      "@page{size:A4;margin:8mm 10mm}",
      "@media print{body{padding:0}.p-toolbar{display:none!important}}",
      ".p-sheet{width:100%;max-width:190mm}",
      ".p-hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:3mm;border-bottom:2px solid #D71920;margin-bottom:3mm}",
      ".p-hdr-l{display:flex;gap:3mm;align-items:flex-start}",
      ".p-hdr img{width:18mm;height:18mm;object-fit:contain}",
      ".p-brand{font-size:8pt;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#D71920}",
      ".p-title{font-size:11pt;font-weight:700;margin:.5mm 0;color:#111}",
      ".p-price{font-size:11pt;font-weight:800;color:#D71920}",
      ".p-meta{font-size:7.5pt;color:#6B7280;margin-top:.5mm}",
      ".p-hdr-r{text-align:right;font-size:7.5pt;color:#6B7280}",
      ".p-sec{margin-top:2.5mm;page-break-inside:avoid}",
      ".p-sec-t{font-size:8.5pt;font-weight:700;color:#111;border-bottom:1px solid #E5E7EB;padding-bottom:.5mm;margin-bottom:1mm}",
      ".p-row{display:flex;justify-content:space-between;gap:2mm;padding:.8mm 0;border-bottom:1px solid #F1F5F9;font-size:8pt}",
      ".p-row:last-child{border-bottom:0}",
      ".p-lbl{color:#6B7280;max-width:48%}",
      ".p-val{color:#111;font-weight:600;text-align:right}",
      ".p-qr{display:flex;align-items:center;gap:3mm;margin-top:3mm}",
      ".p-qr img{width:16mm;height:16mm;image-rendering:pixelated}",
      ".p-qr span{font-size:7pt;color:#6B7280;word-break:break-all}",
      ".p-discl{font-size:6.5pt;color:#999;margin-top:2mm;border-top:1px solid #E5E7EB;padding-top:1mm}",
      ".p-toolbar{position:sticky;top:0;z-index:10;display:flex;gap:8px;padding:10px 12px;background:#111827;color:#fff;font-size:13px;font-weight:600;align-items:center;justify-content:center;flex-wrap:wrap}",
      ".p-toolbar button{padding:8px 18px;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;color:#fff;background:#D71920}",
      ".p-toolbar span{font-size:12px;opacity:.85}"
    ].join("\n");
  }

  function executePdf(bodyHtml, filename) {
    var safe = (filename || "Dokument").replace(/[^a-zA-Z0-9äöüÄÖÜ\-_ ]/g, "");
    var full = '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escapeHtml(safe) + '</title><style>' + buildPdfCss() + '</style></head><body>' +
      '<div class="p-toolbar"><span>📄 ' + escapeHtml(safe) + '</span><button onclick="window.print()">Drucken / PDF speichern</button></div>' +
      bodyHtml + '</body></html>';

    var blob = new Blob([full], { type: "text/html;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var win = window.open(url, "_blank");

    if (!win) {
      var a = document.createElement("a");
      a.href = url;
      a.download = safe + ".html";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 5000);
      showToast("PDF", "Druckansicht als HTML gespeichert.");
      return;
    }

    setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
    debugLog("pdf-opened", safe);
  }

  function pRow(label, value) {
    return '<div class="p-row"><span class="p-lbl">' + escapeHtml(label) + '</span><span class="p-val">' + escapeHtml(value || "") + '</span></div>';
  }

  function buildPrintDatasheet(prod, settings, mode) {
    var d = new Date().toLocaleDateString("de-CH");
    var short = mode === "short";
    var groups = prod.specGroups || groupSpecs(prod.specs);
    var visibleGroups = short ? groups.slice(0, CONFIG.SHORT_SPEC_GROUPS) : groups;
    var qrData = generateQrDataUrl(prod.url, 220);

    var h = '<div class="p-sheet"><div class="p-hdr"><div class="p-hdr-l">';
    if (prod.imageUrl) h += '<img src="' + escapeHtml(prod.imageUrl) + '" alt="">';
    h += '<div><div class="p-brand">Interdiscount</div><div class="p-title">' + escapeHtml(prod.name || "Produkt") + '</div><div class="p-price">' + escapeHtml(prod.price ? prod.price.formatted : "–") + '</div><div class="p-meta">Art. ' + escapeHtml(prod.articleNumber || "–") + (prod.brand ? ' · ' + escapeHtml(prod.brand) : '') + '</div></div></div><div class="p-hdr-r">' + escapeHtml(d) + '<br>Berater: ' + escapeHtml(settings.advisorName || "–") + '<br>Filiale: ' + escapeHtml(settings.branch || "–") + '</div></div>';

    visibleGroups.forEach(function (g) {
      h += '<div class="p-sec"><div class="p-sec-t">' + escapeHtml(g.label) + '</div>';
      g.items.forEach(function (s) { h += pRow(s.label, s.value); });
      h += '</div>';
    });

    if (prod.services.length) {
      h += '<div class="p-sec"><div class="p-sec-t">Services</div>';
      prod.services.forEach(function (s) { h += pRow(s.name, s.price ? s.price.formatted : "Preis nicht erkannt"); });
      h += '</div>';
    }

    h += '<div class="p-qr">' + (qrData ? '<img src="' + qrData + '" width="60" height="60">' : '') + '<span>' + escapeHtml(prod.url) + '</span></div>';
    h += '<div class="p-discl">' + escapeHtml(CONFIG.LEGAL) + '</div></div>';
    return h;
  }

  function buildOfferPdfCss() {
    return [
      "*{margin:0;padding:0;box-sizing:border-box}",
      "html,body{width:100%;min-height:100vh;background:#fff;color:#111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:10.5pt;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}",
      "body{padding:12mm 14mm 14mm}",
      "@page{size:A4;margin:12mm 14mm 14mm}",
      "@media print{body{padding:0}.po-toolbar{display:none!important}}",
      ".po-toolbar{position:sticky;top:0;z-index:10;display:flex;gap:8px;padding:10px 14px;background:#111827;color:#fff;font-size:13px;font-weight:600;align-items:center;justify-content:center;flex-wrap:wrap;margin:-12mm -14mm 0;width:calc(100% + 28mm)}",
      ".po-toolbar button{padding:8px 20px;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;color:#fff;background:#D71920}",
      ".po-toolbar span{font-size:12px;opacity:.85}",
      ".po-offer{width:100%;max-width:182mm}",
      ".po-hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:4mm;border-bottom:2.5px solid #D71920;margin-bottom:4mm}",
      ".po-brand{font-size:10.5pt;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#D71920;margin-bottom:.5mm}",
      ".po-title{font-size:15pt;font-weight:700;color:#111;line-height:1.2}",
      ".po-subtitle{font-size:8.5pt;color:#6B7280;margin-top:1mm}",
      ".po-meta{text-align:right;font-size:8.5pt;color:#6B7280;line-height:1.6}",
      ".po-adv{display:flex;justify-content:space-between;font-size:8.5pt;color:#111;padding:2.5mm 3.5mm;background:#F8F9FB;border:1px solid #E5E7EB;border-radius:1.5mm;margin-bottom:5mm}",
      ".po-colhdr{display:flex;gap:3mm;padding:1.5mm 0;border-bottom:1.5px solid #111;margin-bottom:1mm;font-size:7.5pt;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:.04em}",
      ".po-colhdr .po-c-prod{flex:1;padding-left:17.5mm}",
      ".po-colhdr .po-c-price{width:26mm;text-align:right}",
      ".po-item{padding:2.5mm 0;border-bottom:1px solid #E5E7EB;page-break-inside:avoid}",
      ".po-main{display:flex;gap:3mm;align-items:flex-start}",
      ".po-img,.po-noimg{width:14mm;height:14mm;flex-shrink:0;border:1px solid #eee;border-radius:1.5mm;background:#FAFAFA;object-fit:contain}",
      ".po-info{flex:1;min-width:0}",
      ".po-nm{font-size:10pt;font-weight:600;color:#111;line-height:1.3}",
      ".po-art{font-size:7.5pt;color:#6B7280;margin-top:.3mm}",
      ".po-pr{font-size:10pt;font-weight:700;color:#111;white-space:nowrap;text-align:right;min-width:26mm}",
      ".po-svc{display:flex;justify-content:space-between;gap:3mm;padding:.8mm 0 .8mm 17.5mm;font-size:8.5pt;color:#6B7280}",
      ".po-svc-arrow{color:#9CA3AF;margin-right:1mm}",
      ".po-svc-nm{flex:1}",
      ".po-svc-pr{font-weight:600;color:#111;text-align:right;min-width:26mm}",
      ".po-total{display:flex;justify-content:space-between;align-items:flex-end;padding:4mm 0 0;margin-top:3mm;border-top:2.5px solid #111}",
      ".po-total strong{font-size:11pt}",
      ".po-total span{font-size:15pt;font-weight:800;color:#D71920}",
      ".po-foot{font-size:7pt;color:#999;margin-top:5mm;padding-top:2.5mm;border-top:1px solid #E5E7EB;line-height:1.5}",
      ".po-spacer{min-height:8mm}"
    ].join("\n");
  }

  function executeOfferPdf(bodyHtml, filename) {
    var safe = (filename || "Zusammenstellung").replace(/[^a-zA-Z0-9äöüÄÖÜ\-_ ]/g, "");
    var full = '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escapeHtml(safe) + '</title><style>' + buildOfferPdfCss() + '</style></head><body>' +
      '<div class="po-toolbar"><span>📄 ' + escapeHtml(safe) + '</span><button onclick="window.print()">Drucken / PDF speichern</button></div>' +
      bodyHtml + '</body></html>';

    var blob = new Blob([full], { type: "text/html;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var win = window.open(url, "_blank");

    if (!win) {
      var a = document.createElement("a");
      a.href = url;
      a.download = safe + ".html";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 5000);
      showToast("PDF", "Druckansicht als HTML gespeichert.");
      return;
    }

    setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
    debugLog("offer-pdf-opened", safe);
  }

  function buildPrintOffer(cart, settings) {
    var d = new Date().toLocaleDateString("de-CH"), tot = calcCartTotal(cart);
    var h = '<div class="po-offer"><div class="po-hdr"><div><div class="po-brand">Interdiscount</div><div class="po-title">Zusammenstellung</div><div class="po-subtitle">Persönliche Produktzusammenstellung</div></div><div class="po-meta">' + escapeHtml(d) + '<br>Berater: ' + escapeHtml(settings.advisorName || "–") + '<br>Filiale: ' + escapeHtml(settings.branch || "–") + '</div></div>';
    h += '<div class="po-adv"><span>Berater: ' + escapeHtml(settings.advisorName || "–") + '</span><span>Filiale: ' + escapeHtml(settings.branch || "–") + '</span><span>Datum: ' + escapeHtml(d) + '</span></div>';
    h += '<div class="po-colhdr"><span class="po-c-prod">Produkt</span><span class="po-c-price">Preis</span></div>';

    cart.forEach(function (it) {
      h += '<div class="po-item"><div class="po-main">';
      h += it.imageUrl ? '<img class="po-img" src="' + escapeHtml(it.imageUrl) + '" alt="">' : '<div class="po-noimg"></div>';
      h += '<div class="po-info"><div class="po-nm">' + escapeHtml(it.name) + '</div>';
      if (it.articleNumber) h += '<div class="po-art">Art. ' + escapeHtml(it.articleNumber) + '</div>';
      h += '</div><div class="po-pr">' + escapeHtml(formatPrice(it.basePrice || 0)) + '</div></div>';

      (it.selectedServices || []).forEach(function (s) {
        h += '<div class="po-svc"><span class="po-svc-arrow">↳</span><span class="po-svc-nm">' + escapeHtml(s.name) + '</span><span class="po-svc-pr">' + escapeHtml(formatPrice(s.amount)) + '</span></div>';
      });
      h += '</div>';
    });

    if (cart.length <= 3) h += '<div class="po-spacer"></div>';
    h += '<div class="po-total"><strong>Total</strong><span>' + escapeHtml(formatPrice(tot)) + '</span></div>';
    h += '<div class="po-foot">' + escapeHtml(CONFIG.LEGAL) + '</div></div>';
    return h;
  }

  // ============================================================
  // OVERLAY / TOAST
  // ============================================================

  function closeOverlay() {
    var o = document.getElementById(CONFIG.IDS.overlay);
    if (o) o.remove();
  }

  function showToast(title, sub) {
    var ex = document.getElementById(CONFIG.IDS.toast);
    if (ex) ex.remove();
    if (!document.body) return;
    var el = document.createElement("div");
    el.id = CONFIG.IDS.toast;
    el.innerHTML = "<strong>" + escapeHtml(title) + "</strong><span>" + escapeHtml(sub || "") + "</span>";
    document.body.appendChild(el);
    setTimeout(function () { if (el.isConnected) el.remove(); }, 2400);
  }

  function showOverlay(bodyHtml, actions) {
    closeOverlay();
    ensureStyles();
    var ov = document.createElement("div");
    ov.id = CONFIG.IDS.overlay;
    var btns = (actions || []).map(function (a) {
      return '<button type="button" ' + a.attr + '>' + escapeHtml(a.label) + '</button>';
    }).join("");
    ov.innerHTML = '<div class="idb-dialog" role="dialog" aria-modal="true"><div class="idb-topbar">' + btns + '</div><div class="idb-body">' + bodyHtml + '</div></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) {
      var t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (t === ov || t.hasAttribute("data-idb-close")) closeOverlay();
    });
    return ov;
  }

  // ============================================================
  // SCREEN RENDERERS
  // ============================================================

  function renderSpecGroup(g) {
    return '<div class="idb-section"><div class="idb-section-hd"><strong>' + escapeHtml(g.label) + '</strong><span>' + g.items.length + '</span></div><div class="idb-spec-grid">' + g.items.map(function (s) {
      return '<div class="idb-spec-row"><span class="idb-spec-l">' + escapeHtml(s.label) + '</span><span class="idb-spec-v">' + escapeHtml(s.value || "") + '</span></div>';
    }).join("") + '</div></div>';
  }

  function renderSvcs(svcs) {
    if (!svcs.length) return "";
    return '<div class="idb-section"><div class="idb-section-hd"><strong>Services</strong></div>' + svcs.map(function (s) {
      return '<div class="idb-svc-row"><span>' + escapeHtml(s.name) + '</span><strong>' + escapeHtml(s.price ? s.price.formatted : "Preis nicht erkannt") + '</strong></div>';
    }).join("") + '</div>';
  }

  function screenHeader(prod, settings) {
    var d = new Date().toLocaleDateString("de-CH");
    return '<div class="idb-doc-card"><div class="idb-doc-hdr">' +
      (prod.imageUrl ? '<img src="' + escapeHtml(prod.imageUrl) + '" alt="">' : '<div style="width:72px;height:72px;background:var(--idb-soft);border-radius:6px"></div>') +
      '<div class="idb-doc-info"><div class="idb-brand">Interdiscount</div><h1 class="idb-doc-title">' + escapeHtml(prod.name || "Produkt") + '</h1><div class="idb-doc-price">' + escapeHtml(prod.price ? prod.price.formatted : "–") + '</div><div class="idb-doc-meta"><span>Art. ' + escapeHtml(prod.articleNumber || "–") + '</span>' + (prod.brand ? '<span>' + escapeHtml(prod.brand) + '</span>' : '') + '</div></div></div><div class="idb-doc-meta"><span>' + escapeHtml(d) + '</span><span>Berater: ' + escapeHtml(settings.advisorName || "–") + '</span><span>Filiale: ' + escapeHtml(settings.branch || "–") + '</span></div></div>';
  }

  // ============================================================
  // AUTO EXPAND SPECIFICATIONS
  // ============================================================

  function waitForDomUpdate(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms || 350); });
  }

  function scrollSpecsIntoView() {
    var area = queryFirst([
      "[data-testid='collapsible-specifications']", "[data-testid='collapsible-details']",
      "#redirect-collapsible-details", "[class*='specification']", "[data-specs]"
    ]);
    if (area) {
      try { area.scrollIntoView({ behavior: "auto", block: "center" }); } catch (e) { area.scrollIntoView(); }
      return true;
    }

    var headings = document.querySelectorAll("h2, h3, h4, [role='heading'], summary, button");
    for (var i = 0; i < headings.length; i++) {
      if (/spezifikation|technische\s*daten|specification/i.test(headings[i].textContent || "")) {
        try { headings[i].scrollIntoView({ behavior: "auto", block: "center" }); } catch (e2) { headings[i].scrollIntoView(); }
        return true;
      }
    }
    return false;
  }

  function openSpecsAccordionIfClosed() {
    var containers = document.querySelectorAll(
      "[data-testid='collapsible-specifications']," +
      "[data-testid='collapsible-details']," +
      "#redirect-collapsible-details," +
      "details[class*='spec'],details[class*='detail']"
    );

    for (var i = 0; i < containers.length; i++) {
      var el = containers[i];
      if (el.tagName === "DETAILS" && !el.hasAttribute("open")) {
        var summary = el.querySelector("summary");
        if (summary) { summary.click(); debugLog("spec-expand", "opened-details"); return true; }
      }

      var triggers = el.querySelectorAll("[aria-expanded='false'], [role='button']");
      for (var j = 0; j < triggers.length; j++) {
        if (triggers[j].getAttribute("aria-expanded") === "false") {
          triggers[j].click();
          debugLog("spec-expand", "opened-aria");
          return true;
        }
      }
    }

    var allBtns = document.querySelectorAll("button, [role='button'], summary, a[class*='collaps']");
    for (var k = 0; k < allBtns.length; k++) {
      var txt = safeText(allBtns[k].textContent).toLowerCase();
      if (/spezifikation|specification|technische\s*daten/.test(txt)) {
        if (allBtns[k].getAttribute("aria-expanded") === "true") continue;
        var parent = allBtns[k].closest("details");
        if (parent && parent.hasAttribute("open")) continue;
        allBtns[k].click();
        debugLog("spec-expand", "opened-by-text");
        return true;
      }
    }
    return false;
  }

  function expandSpecsUntilComplete() {
    var specAreas = document.querySelectorAll("[data-testid*='specification'], [data-testid*='detail'], [class*='specification'], [class*='techspec'], [data-specs], #redirect-collapsible-details");

    for (var a = 0; a < specAreas.length; a++) {
      var btns = specAreas[a].querySelectorAll("button, a[role='button'], [class*='more'], [class*='expand'], [class*='show-all'], [data-testid*='show-more']");
      for (var b = 0; b < btns.length; b++) {
        var txt = safeText(btns[b].textContent).toLowerCase();
        if (/mehr\s*anzeigen|mehr\s*laden|show\s*more|alle\s*anzeigen|weitere|alles\s*zeigen|expand|aufklapp|einblend|mehr\s*spezifikation/.test(txt) && isVisible(btns[b])) {
          btns[b].click();
          debugLog("spec-expand", "expand: " + txt.substring(0, 40));
          return true;
        }
      }
    }

    var all = document.querySelectorAll("button, [role='button']");
    for (var c = 0; c < all.length; c++) {
      var t2 = safeText(all[c].textContent).toLowerCase();
      if (/alle\s+spezifikation|all\s+spec|mehr\s+anzeigen|show\s+all/.test(t2) && isVisible(all[c])) {
        all[c].click();
        debugLog("spec-expand", "expand-fallback: " + t2.substring(0, 40));
        return true;
      }
    }
    return false;
  }

  async function prepareSpecificationsForExtraction() {
    scrollSpecsIntoView();
    await waitForDomUpdate(300);

    for (var i = 0; i < CONFIG.SPEC_EXPAND_MAX; i++) {
      if (!openSpecsAccordionIfClosed()) break;
      await waitForDomUpdate(400);
    }

    for (var j = 0; j < CONFIG.SPEC_EXPAND_MAX; j++) {
      if (!expandSpecsUntilComplete()) break;
      await waitForDomUpdate(400);
    }

    await waitForDomUpdate(200);
    debugLog("spec-expand", "preparation complete");
  }

  // ============================================================
  // VIEWS
  // ============================================================

  async function showDatasheet() {
    var bar = document.getElementById(CONFIG.IDS.stickyBar);
    var dsBtn = bar ? bar.querySelector("[data-a='datasheet']") : null;
    if (dsBtn) { dsBtn.textContent = "Lade Spez…"; dsBtn.disabled = true; }

    try {
      await prepareSpecificationsForExtraction();
    } catch (e) {
      debugError("spec-expand-err", e);
    } finally {
      if (dsBtn) { dsBtn.textContent = "Datenblatt"; dsBtn.disabled = false; }
    }

    invalidateCache();
    var prod = getProductData(true), sets = getSettings();
    var groups = prod.specGroups || [];

    var shortH = '<section class="idb-sheet">' + screenHeader(prod, sets);
    groups.slice(0, CONFIG.SHORT_SPEC_GROUPS).forEach(function (g) { shortH += renderSpecGroup(g); });
    shortH += renderSvcs(prod.services);
    shortH += '<div class="idb-qr-row">' + buildQrHtml(prod.url, 48) + '<p>QR zur Produktseite<br>' + escapeHtml(prod.url) + '</p></div>';
    shortH += '<div class="idb-discl">' + escapeHtml(CONFIG.LEGAL) + '</div></section>';

    var detailH = '<section class="idb-sheet">' + screenHeader(prod, sets);
    groups.forEach(function (g) { detailH += renderSpecGroup(g); });
    detailH += renderSvcs(prod.services);
    detailH += '<div class="idb-qr-row">' + buildQrHtml(prod.url, 48) + '<p>QR zur Produktseite<br>' + escapeHtml(prod.url) + '</p></div>';
    detailH += '<div class="idb-discl">' + escapeHtml(CONFIG.LEGAL) + '</div></section>';

    var body = '<div class="idb-mode-tabs"><button type="button" class="active" data-m="short">Kurzblatt</button><button type="button" data-m="detail">Detailblatt</button></div><div data-v="short">' + shortH + '</div><div data-v="detail" style="display:none">' + detailH + '</div>';
    var ov = showOverlay(body, [
      { label: "📄 PDF", attr: "data-idb-pdf" },
      { label: "Schliessen", attr: "data-idb-close" }
    ]);

    var mode = "short";
    ov.addEventListener("click", function (e) {
      var t = e.target;
      if (!(t instanceof HTMLElement)) return;

      if (t.hasAttribute("data-m")) {
        mode = t.getAttribute("data-m");
        ov.querySelectorAll("[data-m]").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-m") === mode); });
        ov.querySelectorAll("[data-v]").forEach(function (v) { v.style.display = v.getAttribute("data-v") === mode ? "block" : "none"; });
      }

      if (t.hasAttribute("data-idb-pdf")) {
        executePdf(buildPrintDatasheet(prod, sets, mode), "Datenblatt - " + (prod.name || "Produkt"));
      }
    });
  }

  function showOffer() {
    var sets = getSettings();

    function render() {
      var cart = getCart();
      var d = new Date().toLocaleDateString("de-CH"), tot = calcCartTotal(cart);
      var rows = "";

      if (!cart.length) {
        rows = '<p class="idb-empty">Keine Produkte.</p>';
      } else {
        cart.forEach(function (it, idx) {
          rows += '<div class="idb-off-item" data-cart-idx="' + idx + '">';
          rows += '<div class="idb-off-main"><div class="idb-off-img">' + (it.imageUrl ? '<img src="' + escapeHtml(it.imageUrl) + '" alt="">' : '') + '</div>';
          rows += '<div class="idb-off-nm">' + escapeHtml(it.name) + '</div>';
          rows += '<div class="idb-off-pr">' + escapeHtml(formatPrice(it.basePrice || 0)) + '</div>';
          rows += '<button class="idb-del-btn" data-del-item="' + idx + '" title="Entfernen">×</button></div>';

          if (it.selectedServices && it.selectedServices.length) {
            rows += '<div class="idb-off-svcs">';
            it.selectedServices.forEach(function (s, si) {
              rows += '<div class="idb-off-svc"><span class="idb-svc-name">↳ ' + escapeHtml(s.name) + '</span><span class="idb-svc-pr">' + escapeHtml(formatPrice(s.amount)) + '</span><button class="idb-del-svc" data-del-svc="' + idx + '-' + si + '" title="Service entfernen">×</button></div>';
            });
            rows += '</div>';
          }
          rows += '</div>';
        });
      }

      return '<section class="idb-sheet"><article class="idb-off-card"><header class="idb-off-hdr"><div><div class="idb-brand">Interdiscount</div><strong>Zusammenstellung</strong></div><div style="font-size:10px;color:var(--idb-muted)">' + escapeHtml(d) + '</div></header><div class="idb-off-adv">Berater: ' + escapeHtml(sets.advisorName || "–") + ' · Filiale: ' + escapeHtml(sets.branch || "–") + '</div><section class="idb-off-items">' + rows + '</section><div class="idb-off-tot"><strong>Total</strong><span>' + escapeHtml(formatPrice(tot)) + '</span></div><footer class="idb-off-foot">' + escapeHtml(CONFIG.LEGAL) + '</footer></article></section>';
    }

    var ov = showOverlay(render(), [
      { label: "📄 PDF", attr: "data-idb-pdf" },
      { label: "Leeren", attr: "data-idb-clear-cart" },
      { label: "Schliessen", attr: "data-idb-close" }
    ]);

    ov.addEventListener("click", function (e) {
      var t = e.target;
      if (!(t instanceof HTMLElement)) return;

      if (t.hasAttribute("data-idb-clear-cart")) {
        saveCart([]);
        syncBar();
        closeOverlay();
        showToast("Geleert", "Zusammenstellung geleert.");
        return;
      }

      if (t.hasAttribute("data-idb-pdf")) {
        executeOfferPdf(buildPrintOffer(getCart(), sets), "Zusammenstellung");
        return;
      }

      if (t.hasAttribute("data-del-item")) {
        var idx = Number(t.getAttribute("data-del-item"));
        var c = getCart();
        if (idx >= 0 && idx < c.length) {
          c.splice(idx, 1);
          saveCart(c);
        }
        var bd = ov.querySelector(".idb-body");
        if (bd) bd.innerHTML = render();
        syncBar();
        return;
      }

      if (t.hasAttribute("data-del-svc")) {
        var parts = t.getAttribute("data-del-svc").split("-");
        var ci = Number(parts[0]), si = Number(parts[1]);
        var c2 = getCart();
        if (c2[ci] && c2[ci].selectedServices && si >= 0 && si < c2[ci].selectedServices.length) {
          c2[ci].selectedServices.splice(si, 1);
          saveCart(c2);
        }
        var bd2 = ov.querySelector(".idb-body");
        if (bd2) bd2.innerHTML = render();
        syncBar();
      }
    });
  }

  function showSettings() {
    var s = getSettings();
    var ov = showOverlay(
      '<section class="idb-set-wrap" data-idb-set><h1>Einstellungen</h1><p>Erscheinen auf Datenblatt und Zusammenstellung.</p><div class="idb-fg"><label>Beratername<input name="advisorName" value="' + escapeHtml(s.advisorName) + '" placeholder="z.B. Joel Sieber"></label><label>Filiale<input name="branch" value="' + escapeHtml(s.branch) + '" placeholder="z.B. Frauenfeld"></label></div><div class="idb-mf"><button type="button" data-idb-cancel>Abbrechen</button><button type="button" data-idb-save>Speichern</button></div></section>',
      [{ label: "Schliessen", attr: "data-idb-close" }]
    );

    ov.addEventListener("click", function (e) {
      var t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.hasAttribute("data-idb-cancel")) { closeOverlay(); return; }
      if (!t.hasAttribute("data-idb-save")) return;

      var sc = ov.querySelector("[data-idb-set]");
      if (!sc) return;
      var nI = sc.querySelector("input[name='advisorName']");
      var bI = sc.querySelector("input[name='branch']");
      setStore(CONFIG.KEYS.settings, {
        advisorName: nI ? nI.value.trim() : "",
        branch: bI ? bI.value.trim() : ""
      });
      syncBar();
      closeOverlay();
      showToast("Gespeichert", "OK");
    });
  }

  // ============================================================
  // ADD TO CART
  // ============================================================

  function showAddSheet(prod) {
    var svcs = prod.services || [];
    var pkgs = getMatchingPackages();
    var svcHtml = "";

    if (svcs.length) {
      svcHtml += '<div><div class="idb-section-hd"><strong>Garantie &amp; Versicherung</strong></div><div class="idb-sopts">';
      svcs.forEach(function (s, i) {
        var recognized = !!(s.price && typeof s.price.amount === "number" && isFinite(s.price.amount));
        svcHtml += '<label class="idb-sopt" data-disabled="' + (recognized ? "0" : "1") + '"><input type="checkbox" data-si="' + i + '" ' + (recognized ? "" : "disabled") + '><strong>' + escapeHtml(s.name) + '</strong><span>' + escapeHtml(recognized ? s.price.formatted : "Preis nicht erkannt") + '</span></label>';
      });
      svcHtml += '</div></div>';
    }

    var allPkgItems = [];
    var pkgHtml = "";
    pkgs.forEach(function (pkg) {
      pkgHtml += '<div><div class="idb-pkg-hd">Servicepakete – ' + escapeHtml(pkg.group) + '</div><div class="idb-sopts">';
      pkg.items.forEach(function (it) {
        var idx = allPkgItems.length;
        allPkgItems.push(it);
        pkgHtml += '<label class="idb-sopt"><input type="checkbox" data-pi="' + idx + '"><strong>' + escapeHtml(it.name) + '</strong><span>' + escapeHtml(it.formatted) + '</span></label>';
      });
      pkgHtml += '</div></div>';
    });

    var ov = showOverlay(
      '<section class="idb-ss"><h1>' + escapeHtml(prod.name) + '</h1><div class="idb-ss-pr">' + escapeHtml(prod.price ? prod.price.formatted : "–") + '</div>' + svcHtml + pkgHtml + '<button type="button" class="idb-ssub" data-idb-confirm>Hinzufügen</button></section>',
      [{ label: "Schliessen", attr: "data-idb-close" }]
    );

    ov.addEventListener("click", function (e) {
      var t = e.target;
      if (!(t instanceof HTMLElement) || !t.hasAttribute("data-idb-confirm")) return;

      var selected = [];

      ov.querySelectorAll("[data-si]:checked").forEach(function (chk) {
        var idx = Number(chk.getAttribute("data-si"));
        if (!isNaN(idx) && svcs[idx] && svcs[idx].price && isFinite(svcs[idx].price.amount)) {
          selected.push({ name: svcs[idx].name, amount: svcs[idx].price.amount });
        }
      });

      ov.querySelectorAll("[data-pi]:checked").forEach(function (chk) {
        var pi = Number(chk.getAttribute("data-pi"));
        if (!isNaN(pi) && allPkgItems[pi]) {
          selected.push({ name: allPkgItems[pi].name, amount: allPkgItems[pi].amount });
        }
      });

      var cart = getCart();
      cart.push({
        id: Date.now(),
        name: prod.name,
        basePrice: prod.price ? prod.price.amount : 0,
        selectedServices: selected,
        imageUrl: prod.imageUrl || "",
        url: prod.url,
        articleNumber: prod.articleNumber || "",
        createdAt: nowIso(),
        priceCapturedAt: prod.capturedAt || nowIso(),
        toolVersion: CONFIG.VERSION
      });

      saveCart(cart);
      syncBar();
      closeOverlay();
      showToast("Hinzugefügt", prod.name);
    });
  }

  function addToCart() {
    // Important: never trust a stale variant cache here.
    invalidateCache();
    var p = getProductData(true);
    if (!p.name || !p.price) {
      showToast("Fehler", "Produktname oder Preis nicht erkannt.");
      return;
    }
    showAddSheet(p);
  }

  // ============================================================
  // BAR
  // ============================================================

  function renderBar() {
    ensureStyles();
    var bar = document.createElement("nav");
    bar.id = CONFIG.IDS.stickyBar;
    bar.setAttribute("aria-label", "Berater-Tool");
    bar.innerHTML = '<button type="button" data-a="datasheet" data-tone="red">Datenblatt</button><div class="idb-bw"><button type="button" data-a="offer" data-tone="dark">Zusammenst.</button><span class="idb-pill" data-pill style="display:none">0</span></div><button type="button" data-a="add">Hinzufügen</button><button type="button" data-a="settings" style="max-width:38px;padding:8px 5px;font-size:15px" title="Einstellungen">⚙</button>';

    bar.addEventListener("click", function (e) {
      var b = e.target instanceof HTMLElement ? e.target.closest("[data-a]") : null;
      if (!b) return;
      var a = b.getAttribute("data-a");
      if (a === "datasheet") showDatasheet();
      else if (a === "offer") showOffer();
      else if (a === "add") addToCart();
      else if (a === "settings") showSettings();
    });
    return bar;
  }

  function syncBar() {
    var bar = document.getElementById(CONFIG.IDS.stickyBar);
    if (!bar) return;
    var info = summarizeCart();
    var pill = bar.querySelector("[data-pill]");
    if (pill) {
      pill.textContent = String(info.count);
      pill.style.display = info.count > 0 ? "flex" : "none";
    }
  }

  function ensureSpacer() {
    if (!document.body || document.getElementById(CONFIG.IDS.spacer)) return;
    var s = document.createElement("div");
    s.id = CONFIG.IDS.spacer;
    document.body.appendChild(s);
  }

  function cleanupNonProduct() {
    var bar = document.getElementById(CONFIG.IDS.stickyBar);
    var spacer = document.getElementById(CONFIG.IDS.spacer);
    if (bar) bar.remove();
    if (spacer) spacer.remove();
    closeOverlay();
  }

  // ============================================================
  // INJECT / BOOT / SPA
  // ============================================================

  function inject() {
    runtime.status = "injecting";

    if (!isProductPage()) {
      cleanupNonProduct();
      runtime.status = "non-product";
      return false;
    }

    if (!document.body) return false;

    var ex = document.getElementById(CONFIG.IDS.stickyBar);
    if (ex) {
      ensureSpacer();
      syncBar();
      runtime.status = "bar-ok";
      return true;
    }

    document.body.appendChild(renderBar());
    ensureSpacer();
    syncBar();
    runtime.status = "bar-injected";
    debugLog("bar-injected", location.href);
    return true;
  }

  function boot() {
    invalidateCache();
    state.lastRouteUrl = location.href;
    CONFIG.RETRY.forEach(function (d) { setTimeout(inject, d); });
  }

  ["pushState", "replaceState"].forEach(function (n) {
    var original = history[n];
    if (typeof original !== "function" || original.__idbWrapped) return;
    var wrapped = function () {
      var r = original.apply(this, arguments);
      setTimeout(boot, 0);
      return r;
    };
    wrapped.__idbWrapped = true;
    history[n] = wrapped;
  });

  window.addEventListener("popstate", boot);

  var observerTrigger = debounce(function () {
    var routeChanged = state.lastRouteUrl !== location.href;
    var barMissingOnPossibleProduct = !document.getElementById(CONFIG.IDS.stickyBar) && (location.pathname.indexOf("/product/") !== -1 || location.pathname.indexOf("/p/") !== -1);
    if (routeChanged) {
      state.lastRouteUrl = location.href;
      boot();
    } else if (barMissingOnPossibleProduct) {
      inject();
    }
  }, 450);

  new MutationObserver(observerTrigger).observe(document.documentElement, { childList: true, subtree: true });

  // ============================================================
  // SELF TESTS
  // ============================================================

  function selfTest() {
    var priceCases = [
      ["CHF 1299.95", 1299.95],
      ["CHF 1'299.95", 1299.95],
      ["CHF 1’299.95", 1299.95],
      ["CHF 1,299.95", 1299.95],
      ["CHF 1.299,95", 1299.95],
      ["1299.-", 1299],
      ["CHF 899.–", 899],
      ["29.95", 29.95]
    ];

    var tests = priceCases.map(function (tc) {
      var p = parseSwissPrice(tc[0]);
      var got = p ? p.amount : null;
      return {
        name: "parseSwissPrice(" + tc[0] + ")",
        ok: got === tc[1],
        expected: tc[1],
        got: got
      };
    });

    var allOk = tests.every(function (t) { return t.ok; });
    var out = { version: CONFIG.VERSION, ok: allOk, tests: tests };
    if (console.table) console.table(tests);
    console.log(CONFIG.PREFIX, "selfTest", out);
    return out;
  }

  // ============================================================
  // INIT / PUBLIC API
  // ============================================================

  state.debugEnabled = (function () {
    try {
      return new URLSearchParams(location.search).get(CONFIG.KEYS.debug) === "1" || localStorage.getItem(CONFIG.KEYS.debug) === "1";
    } catch (e) {
      return false;
    }
  })();

  runtime.status = "initialized";
  summarizeCart();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  window.addEventListener("error", function (e) {
    debugError("window-error", e.error || new Error(e.message || "window error"));
  });

  Object.assign(window.__ID_BERATER__, {
    version: CONFIG.VERSION,
    getProductData: function () { return getProductData(true); },
    getCart: getCart,
    getSettings: getSettings,
    dump: function () {
      return {
        url: location.href,
        version: CONFIG.VERSION,
        status: runtime.status,
        classification: state.lastClassification,
        product: state.lastProduct || getProductData(true),
        settings: getSettings(),
        cart: summarizeCart(),
        diag: state.diagnostics.slice()
      };
    },
    closeOverlay: closeOverlay,
    showDatasheet: showDatasheet,
    showOffer: showOffer,
    showSettings: showSettings,
    parseSwissPrice: parseSwissPrice,
    invalidateCache: invalidateCache,
    selfTest: selfTest
  });

})();
