import { Impit } from "impit";

const STC_BASE = "https://digitalapi-gateway.stc.com.kw";
const stcClient = new Impit({ browser: "chrome" });
let tokenCache = null;
let tokenExpiresAt = 0;
let tokenRequest = null;

const DEFAULT_HEADERS = {
  channel: "WEB",
  locale: "en",
  "Accept-Language": "en",
  "User-Agent": "Mozilla/5.0",
};

function text(value) {
  return value == null ? "" : String(value).replace(/\s+/g, " ").trim();
}

function absUrl(href) {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  return `https://www.stc.com.kw/en${href.startsWith("/") ? href : `/${href}`}`;
}

function productKey(product) {
  const href = product?.link?.href || "";
  const match = href.match(/\/product\/([^/]+)\/([^/?#]+)/i);
  if (match) return `${match[1]}/${match[2]}`;
  return `${product.category || ""}/${product.itemGroup || ""}`;
}

function isRealProduct(product) {
  return Boolean(
    text(product?.itemGroup) ||
    text(product?.model) ||
    text(product?.brand) ||
    text(product?.category) ||
    text(product?.link?.href)
  );
}

function findBlock(detail, type) {
  return detail?.content?.find((item) => item?.type === type)?.content;
}

function deviceConfig(detail) {
  const detailBlock = findBlock(detail, "StcB2cDeviceDetail");
  const direct = detailBlock?.rightComponent?.find((item) => item?.type === "StcCwsColorAndCapacityRevamp")?.content;
  if (Array.isArray(direct?.capacity) && direct.capacity.length) return normalizeConfig(direct);

  const candidates = [];
  function walk(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value.capacity) || Array.isArray(value.capacities)) candidates.push(value);
    if (Array.isArray(value)) value.forEach(walk);
    else Object.values(value).forEach(walk);
  }
  walk(detail);
  const fallback = candidates.find((candidate) => normalizeConfig(candidate).capacity.length);
  return fallback ? normalizeConfig(fallback) : normalizeConfig(direct || {});
}

function detailImages(detail) {
  const detailBlock = findBlock(detail, "StcB2cDeviceDetail");
  return detailBlock?.leftComponent?.find((item) => item?.type === "StcCwsHeaderProductImage")?.content?.images || [];
}

function detailSpecs(detail) {
  return findBlock(detail, "StcCwsProductSpec")?.specs || [];
}

function normalizeConfig(config) {
  const rawCapacities = config?.capacity || config?.capacities || [];
  const capacity = rawCapacities.map((raw) => {
    const rawColors = raw?.colors || raw?.color || raw?.colour || raw?.items || [];
    const colors = Array.isArray(rawColors) && rawColors.length
      ? rawColors
      : raw?.itemCode
        ? [raw]
        : [];
    return {
      ...raw,
      capacity: raw?.capacity ?? raw?.storage ?? raw?.memory ?? raw?.name ?? "",
      unit: raw?.unit ?? raw?.capacityUnit ?? "",
      colors: colors.map((color) => ({
        ...color,
        itemCode: color?.itemCode || color?.code || color?.equipmentId || color?.equipId || "",
        colorName: color?.colorName || color?.name || color?.label || raw?.colorName || "",
        colorCode: color?.colorCode || color?.hexCode || "",
        thumbs: color?.thumbs || color?.images || color?.imageUrl ? color?.thumbs || color?.images || [color?.imageUrl].filter(Boolean) : [],
      })),
    };
  });
  return {
    ...config,
    capacity,
  };
}

function firstDeepValue(value, key) {
  if (!value || typeof value !== "object") return "";
  if (value[key]) return value[key];
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    const found = firstDeepValue(child, key);
    if (found) return found;
  }
  return "";
}

function firstItemCode(config, detail, product) {
  for (const capacity of config.capacity || []) {
    for (const color of capacity.colors || []) {
      if (color?.itemCode && color.available !== false) return color.itemCode;
    }
  }
  for (const capacity of config.capacity || []) {
    for (const color of capacity.colors || []) {
      if (color?.itemCode) return color.itemCode;
    }
  }
  return product?.itemCode || product?.defaultItemCode || product?.equipId || firstDeepValue(detail, "itemCode") || "";
}

function catalogStorageLabels(product) {
  return [...new Set((product?.filter?.storage || []).map((item) => text(item.categoryLabel || item.label || item.name)).filter(Boolean))];
}

function catalogColorRows(product) {
  const productColors = Array.isArray(product?.colors) ? product.colors : [];
  const filterColors = product?.filter?.color || product?.filter?.colors || [];
  const source = productColors.length ? productColors : filterColors;
  return source.map((color) => ({
    colorName: text(color.colorName || color.name || color.categoryLabel || color.label),
    colorCode: text(color.colorCode || color.hexCode),
    itemCode: color.itemCode || color.code || "",
    imageUrl: color.thumbs?.[0]?.url || color.thumbs?.[0] || color.imageUrl || "",
  })).filter((color) => color.colorName || color.itemCode || color.imageUrl);
}

function uniqueJoined(values) {
  return [...new Set(values.map(text).filter(Boolean))].join(", ");
}

function capacityLabel(capacity) {
  const cap = text(capacity.capacity);
  const unit = text(capacity.unit);
  if (!cap) return "";
  return unit && !cap.toLowerCase().endsWith(unit.toLowerCase()) ? `${cap} ${unit}` : cap;
}

function imageFromThumb(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.url || value.href || "";
}

async function getToken() {
  if (tokenCache && Date.now() < tokenExpiresAt) return tokenCache;
  if (tokenRequest) return tokenRequest;

  tokenRequest = (async () => {
    const response = await stcClient.fetch(`${STC_BASE}/ClientCred/v1`, {
      method: "POST",
      headers: DEFAULT_HEADERS,
    });
    if (!response.ok) throw new Error(`STC token request failed: ${response.status}`);
    const token = await response.json();
    const lifetimeSeconds = Number(token.expires_in) || 300;
    tokenCache = token;
    tokenExpiresAt = Date.now() + Math.max(30, lifetimeSeconds - 60) * 1000;
    return token;
  })();

  try {
    return await tokenRequest;
  } finally {
    tokenRequest = null;
  }
}

async function createClient() {
  const token = await getToken();
  const headers = {
    ...DEFAULT_HEADERS,
    Authorization: `${token.token_type} ${token.access_token}`,
  };

  async function request(pathname, options = {}) {
    const response = await stcClient.fetch(`${STC_BASE}${pathname}`, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers || {}),
      },
    });
    const bodyText = await response.text();
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = bodyText;
    }
    if (!response.ok) {
      const error = new Error(`STC API request failed: ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }

  return {
    get: request,
    post(pathname, body) {
      return request(pathname, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
    },
  };
}

async function withConcurrency(items, limit, worker) {
  const queue = [...items];
  const results = [];
  let index = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (queue.length) {
      const item = queue.shift();
      const current = index++;
      results[current] = await worker(item, current);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function fetchStcDevices() {
  const client = await createClient();
  const catalog = await client.get("/dig-estoreAllDevices/v1/ESTORWEB?name=all-device&ver=v1");
  const products = (catalog?.block?.find((block) => Array.isArray(block.items) && block.items.length === 122)?.items
    || catalog?.block?.flatMap((block) => block.items || [])
    || []).filter(isRealProduct);

  const errors = [];
  const colors = [];
  const capacities = [];
  const specs = [];
  const images = [];
  const plans = [];
  const zeed = [];

  const devices = await withConcurrency(products, 5, async (product, index) => {
    const key = productKey(product);
    let detail = {};
    try {
      detail = await client.get(`/b2cSC_getProductDetailPage/v5/${key}`);
    } catch (error) {
      errors.push({ itemGroup: product.itemGroup || "", key, stage: "detail", status: error.status || "", message: text(JSON.stringify(error.body || error.message)) });
    }

    const config = deviceConfig(detail);
    const itemCode = firstItemCode(config, detail, product);
    const productSpecs = detailSpecs(detail);
    const specMap = Object.fromEntries(productSpecs.map((item) => [text(item.title), text(item.value)]));
    const productImages = detailImages(detail);
    let cashOffer = {};
    let zeedOffers = [];
    let planOffers = [];

    if (itemCode) {
      const calls = await Promise.allSettled([
        client.post("/b2cSC_getCashOffer/v1", { itemCode }),
        client.post("/b2cSC_getZeedOffers/v1", { itemCode }),
        client.post("/dig-purchaseOptionsWithPrimaryOffers/v1", { itemCode }),
      ]);
      if (calls[0].status === "fulfilled") cashOffer = calls[0].value?.data || {};
      else errors.push({ itemGroup: product.itemGroup || "", key, stage: "cash", status: calls[0].reason?.status || "", message: text(calls[0].reason?.message) });
      if (calls[1].status === "fulfilled") zeedOffers = Array.isArray(calls[1].value?.data) ? calls[1].value.data : [];
      else errors.push({ itemGroup: product.itemGroup || "", key, stage: "zeed", status: calls[1].reason?.status || "", message: text(calls[1].reason?.message) });
      if (calls[2].status === "fulfilled") planOffers = calls[2].value?.data?.offers || [];
      else errors.push({ itemGroup: product.itemGroup || "", key, stage: "plans", status: calls[2].reason?.status || "", message: text(calls[2].reason?.message) });
    } else {
      errors.push({ itemGroup: product.itemGroup || "", key, stage: "itemCode", status: "missing", message: "No item code found in detail configurations" });
    }

    for (const capacity of config.capacity || []) {
      capacities.push({
        itemGroup: product.itemGroup || "",
        model: text(product.model),
        capacity: capacityLabel(capacity),
        unit: text(capacity.unit),
        name: text(capacity.name),
        brand: text(capacity.brand),
        available: capacity.available,
        preorder: capacity.preorder,
        qty: capacity.qty ?? "",
        standalonePrice: capacity.standalonePrice ?? "",
        equipId: capacity.equipId || "",
      });
      for (const color of capacity.colors || []) {
        colors.push({
          itemGroup: product.itemGroup || "",
          model: text(product.model),
          capacity: capacityLabel(capacity),
          unit: text(capacity.unit),
          itemCode: color.itemCode || "",
          colorName: text(color.colorName),
          colorCode: text(color.colorCode),
          available: color.available,
          preorder: color.preorder,
          qty: color.qty ?? "",
          standalonePrice: color.standalonePrice ?? "",
          imageName: text(color.name),
          imageUrl: imageFromThumb((color.thumbs || [])[0]) || "",
        });
      }
    }

    if (!(config.capacity || []).length) {
      for (const storage of catalogStorageLabels(product)) {
        capacities.push({
          itemGroup: product.itemGroup || "",
          model: text(product.model),
          capacity: storage,
          unit: "",
          name: text(product.model),
          brand: text(product.brand),
          available: product.available ?? "",
          preorder: product.preorder ?? "",
          qty: "",
          standalonePrice: product.retailPriceValue ?? "",
          equipId: product.equipId || "",
        });
      }
      for (const color of catalogColorRows(product)) {
        colors.push({
          itemGroup: product.itemGroup || "",
          model: text(product.model),
          capacity: "",
          unit: "",
          itemCode: color.itemCode || itemCode || "",
          colorName: color.colorName,
          colorCode: color.colorCode,
          available: product.available ?? "",
          preorder: product.preorder ?? "",
          qty: "",
          standalonePrice: product.retailPriceValue ?? "",
          imageName: color.colorName,
          imageUrl: color.imageUrl,
        });
      }
    }

    productSpecs.forEach((item) => specs.push({
      itemGroup: product.itemGroup || "",
      model: text(product.model),
      specTitle: text(item.title),
      specValue: text(item.value),
    }));

    productImages.forEach((imageUrl, imageIndex) => images.push({
      itemGroup: product.itemGroup || "",
      model: text(product.model),
      imageNo: imageIndex + 1,
      imageUrl,
    }));

    for (const offer of planOffers) {
      for (const commitment of offer.commitment || []) {
        plans.push({
          itemGroup: product.itemGroup || "",
          model: text(product.model),
          itemCode,
          planName: text(offer.name),
          planId: offer.id || "",
          period: commitment.period ?? "",
          deviceRent: commitment.deviceRent ?? "",
          parentPlanPrice: commitment.parentPlanPrice ?? "",
          currency: commitment.currency || "",
          commitmentDescription: text(commitment.commitEquipDesc),
          parentPlan: text(commitment.parentPlan),
          benefits: (offer.benifits || []).map((benefit) => `${text(benefit.label)}: ${text(benefit.value)}`).join(" | "),
        });
      }
    }

    for (const offer of zeedOffers) {
      zeed.push({
        itemGroup: product.itemGroup || "",
        model: text(product.model),
        itemCode,
        period: offer.period ?? "",
        deviceRent: offer.deviceRent ?? "",
        minimumRentalPrice: offer.minimumRentalPrice ?? "",
        currency: offer.currency || "",
        name: text(offer.name),
        commitmentDescription: text(offer.commitEquipDesc),
        parentPlan: text(offer.parentPlan),
        parentPlanPrice: offer.parentPlanPrice ?? "",
      });
    }

    const productColorRows = colors.filter((color) => color.itemGroup === product.itemGroup);
    const storageOptions = uniqueJoined([
      ...(config.capacity || []).map(capacityLabel),
      ...capacities.filter((capacity) => capacity.itemGroup === product.itemGroup).map((capacity) => capacity.capacity),
      ...catalogStorageLabels(product),
    ]);
    const colorNames = uniqueJoined([
      ...productColorRows.map((color) => color.colorName),
      ...catalogColorRows(product).map((color) => color.colorName),
    ]);
    const cashValue = product.retailPriceValue ?? "";

    return {
      no: index + 1,
      label: text(product.cardBadgeText),
      category: text(product.category),
      brand: text(product.brand),
      deviceName: text(product.model),
      itemGroup: product.itemGroup || "",
      productUrl: absUrl(product.link?.href),
      detailApiKey: key,
      cardStartingPriceText: product.startingPriceValue != null && product.startingPriceValue !== "" ? `From ${product.startingPriceCurrency}${product.startingPriceValue} ${product.startingPriceType}` : "",
      cardZeedPriceText: product.zeedPriceValue != null && product.zeedPriceValue !== "" ? `Zeed ${product.zeedPriceCurrency}${product.zeedPriceValue} ${product.zeedPriceType}` : "",
      cardCashPriceText: cashValue !== "" ? `Price: ${product.retailPriceCurrency} ${cashValue}` : "",
      cardStartingPriceValue: product.startingPriceValue ?? "",
      cardZeedPriceValue: product.zeedPriceValue ?? "",
      cardCashValue: cashValue,
      detailTitle: text(detail.title),
      productDescription: text(config.productDescription || detail.description || product.description),
      defaultItemCode: itemCode,
      cashOfferPrice: cashOffer.price ?? "",
      cashOfferCurrency: cashOffer.currency || "",
      cashOfferName: text(cashOffer.name),
      zeedLowest24Month: zeedOffers.find((offer) => Number(offer.period) === 24)?.deviceRent ?? "",
      zeedLowest36Month: zeedOffers.find((offer) => Number(offer.period) === 36)?.deviceRent ?? "",
      planOfferCount: planOffers.length,
      storageOptions,
      colorNames,
      display: specMap.Display || "",
      processorChip: specMap["Processor Chip"] || "",
      primaryCameraRear: specMap["Primary Camera (Rear)"] || "",
      selfieCameraFront: specMap["Selfie Camera (Front)"] || "",
      battery: specMap.Battery || "",
      networkType: specMap["Network Type"] || "",
      filterDeviceType: (product.filter?.deviceType || []).map((item) => item.categoryLabel).join(", "),
      filterBrand: (product.filter?.brand || []).map((item) => item.categoryLabel).join(", "),
      filterStorage: (product.filter?.storage || []).map((item) => item.categoryLabel).join(", "),
      featured: product.filter?.featured || "",
      firstImageUrl: productImages[0] || imageFromThumb(product.colors?.[0]?.thumbs?.[0]) || "",
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    devices: devices.sort((a, b) => a.no - b.no),
    colors,
    capacities,
    specs,
    images,
    plans,
    zeed,
    errors,
  };
}
