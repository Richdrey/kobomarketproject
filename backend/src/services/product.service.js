const Product = require('../models/product.models');
const Store = require('../models/store.models');
const pool = require('../configs/postgres');
const { AppError } = require('../middleware/errorHandler');

function priceRows(product, priceKobo, variants) {
  if (variants && variants.length) {
    return variants.map((variant, index) => ({
      productId: String(product._id),
      variantId: String(product.variants[index]._id),
      priceKobo: variant.priceKobo
    }));
  }
  return [{
    productId: String(product._id),
    variantId: '',
    priceKobo
  }];
}

async function storePrices(rows, replaceProductPrices = false) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      await client.query(
        `INSERT INTO product_prices (product_id, variant_id, currency, price_kobo)
         VALUES ($1, $2, 'NGN', $3)
         ON CONFLICT (product_id, variant_id)
         DO UPDATE SET price_kobo = EXCLUDED.price_kobo, updated_at = NOW()`,
        [row.productId, row.variantId, row.priceKobo]
      );
    }
    if (replaceProductPrices && rows.length) {
      const variantIds = rows.map((row) => row.variantId).filter(Boolean);
      if (variantIds.length) {
        await client.query(
          `DELETE FROM product_prices WHERE product_id = $1 AND NOT (variant_id = ANY($2::text[]))`,
          [rows[0].productId, variantIds]
        );
      } else {
        await client.query(
          "DELETE FROM product_prices WHERE product_id = $1 AND variant_id <> ''",
          [rows[0].productId]
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createProduct(vendorId, input) {
  const store = await Store.findOne({ vendorId, status: 'approved' });
  if (!store) throw new AppError(403, 'VENDOR_NOT_APPROVED', 'An approved store is required');

  const product = await Product.create({
    vendorId,
    name: input.name,
    slug: input.slug,
    description: input.description,
    category: input.category,
    images: input.images || [],
    stockQuantity: input.stockQuantity || 0,
    variants: (input.variants || []).map(({ label, stockQuantity }) => ({ label, stockQuantity })),
    tags: input.tags || [],
    isActive: input.isActive !== false
  });
  try {
    await storePrices(priceRows(product, input.priceKobo, input.variants));
  } catch (error) {
    await Product.updateOne({ _id: product._id }, { $set: { isActive: false, deletedAt: new Date() } });
    throw error;
  }
  return product;
}

async function updateProduct(vendorId, productId, input) {
  const product = await Product.findOne({ _id: productId, vendorId, deletedAt: null });
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');

  const previous = product.toObject();
  if (input.name !== undefined) product.name = input.name;
  if (input.slug !== undefined) product.slug = input.slug;
  if (input.description !== undefined) product.description = input.description;
  if (input.category !== undefined) product.category = input.category;
  if (input.images !== undefined) product.images = input.images;
  if (input.stockQuantity !== undefined) product.stockQuantity = input.stockQuantity;
  if (input.tags !== undefined) product.tags = input.tags;
  if (input.isActive !== undefined) product.isActive = input.isActive;
  if (input.variants !== undefined) {
    const suppliedIds = new Set();
    for (const variant of input.variants) {
      if (!variant.id) continue;
      if (suppliedIds.has(variant.id) || !product.variants.id(variant.id)) {
        throw new AppError(400, 'INVALID_VARIANT', 'A supplied variant ID is duplicated or does not belong to this product');
      }
      suppliedIds.add(variant.id);
    }
    product.variants = input.variants.map(({ id, label, stockQuantity }) => ({
      ...(id ? { _id: id } : {}),
      label,
      stockQuantity
    }));
  }

  await product.save();
  if (input.priceKobo !== undefined || input.variants !== undefined) {
    try {
      if (product.variants.length) {
        if (!input.variants) {
          throw new AppError(400, 'VARIANT_PRICES_REQUIRED', 'Send variant IDs and prices to update variant prices');
        }
        const rows = input.variants.map((variant, index) => {
          const current = product.variants[index];
          if (variant.id && String(current._id) !== variant.id) {
            throw new AppError(400, 'INVALID_VARIANT', 'A supplied variant ID does not belong to this product');
          }
          return { productId: String(product._id), variantId: String(current._id), priceKobo: variant.priceKobo };
        });
        await storePrices(rows, true);
      } else if (input.priceKobo !== undefined) {
        await storePrices(priceRows(product, input.priceKobo), true);
      } else if (input.variants !== undefined) {
        throw new AppError(400, 'BASE_PRICE_REQUIRED', 'A base product price is required when removing all variants');
      }
    } catch (error) {
      await Product.replaceOne({ _id: product._id }, previous);
      throw error;
    }
  }
  return product;
}

async function softDeleteProduct(vendorId, productId) {
  const product = await Product.findOneAndUpdate(
    { _id: productId, vendorId, deletedAt: null },
    { $set: { isActive: false, deletedAt: new Date() } },
    { new: true }
  );
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  return product;
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!value.id || !['newest', 'rating', 'price'].includes(value.sort)) throw new Error();
    return value;
  } catch {
    throw new AppError(400, 'INVALID_CURSOR', 'The pagination cursor is invalid');
  }
}

async function listProducts(filters) {
  const query = { isActive: true, deletedAt: null };
  if (filters.category) query.category = filters.category;
  if (filters.vendorId) query.vendorId = filters.vendorId;
  if (filters.q) query.$text = { $search: filters.q };
  if (filters.minRating) {
    query.$expr = {
      $gte: [
        { $cond: [{ $gt: ['$ratingCount', 0] }, { $divide: ['$ratingSum', '$ratingCount'] }, 0] },
        Number(filters.minRating)
      ]
    };
  }

  const candidates = await Product.find(query)
    .select('vendorId name slug description category images stockQuantity variants tags createdAt ratingSum ratingCount')
    .limit(10000)
    .lean();
  if (!candidates.length) return { products: [], nextCursor: null };

  const candidateIds = candidates.map((product) => String(product._id));
  const priceResult = await pool.query(
    `SELECT DISTINCT ON (product_id) product_id, price_kobo::text AS price_kobo
       FROM product_prices
      WHERE product_id = ANY($1::text[])
        AND ($2::bigint IS NULL OR price_kobo >= $2::bigint)
        AND ($3::bigint IS NULL OR price_kobo <= $3::bigint)
      ORDER BY product_id, price_kobo ASC`,
    [candidateIds, filters.minPriceKobo || null, filters.maxPriceKobo || null]
  );
  const prices = new Map(priceResult.rows.map((row) => [row.product_id, row.price_kobo]));
  const products = candidates
    .filter((product) => prices.has(String(product._id)))
    .map((product) => ({
      ...product,
      priceKobo: prices.get(String(product._id)),
      currency: 'NGN',
      averageRating: product.ratingCount ? product.ratingSum / product.ratingCount : 0
    }));

  const sort = filters.sort || 'newest';
  const compare = (left, right) => {
    let order = 0;
    if (sort === 'price') {
      const a = BigInt(left.priceKobo);
      const b = BigInt(right.priceKobo);
      order = a < b ? -1 : a > b ? 1 : 0;
    } else if (sort === 'rating') {
      const aCount = BigInt(left.ratingCount || 0);
      const bCount = BigInt(right.ratingCount || 0);
      const a = BigInt(left.ratingSum || 0) * (bCount || 1n);
      const b = BigInt(right.ratingSum || 0) * (aCount || 1n);
      order = a > b ? -1 : a < b ? 1 : 0;
    } else {
      order = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    }
    if (order) return sort === 'price' ? order : order;
    return String(left._id).localeCompare(String(right._id));
  };
  products.sort(compare);

  const cursor = decodeCursor(filters.cursor);
  let startIndex = 0;
  if (cursor) {
    if (cursor.sort !== sort) {
      throw new AppError(400, 'CURSOR_SORT_MISMATCH', 'The cursor was created for a different sort order');
    }
    const cursorIndex = products.findIndex((product) => String(product._id) === cursor.id);
    if (cursorIndex < 0) {
      throw new AppError(400, 'STALE_CURSOR', 'The cursor item is no longer in this result set');
    }
    startIndex = cursorIndex + 1;
  }
  const limit = Number(filters.limit || 20);
  const page = products.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < products.length;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ id: String(last._id), sort }) : null;
  return { products: page, nextCursor };
}

async function getProductBySlug(slug) {
  const product = await Product.findOne({ slug, isActive: true, deletedAt: null }).lean();
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  const prices = await pool.query(
    `SELECT variant_id AS "variantId", price_kobo::text AS "priceKobo", currency
       FROM product_prices WHERE product_id = $1 ORDER BY variant_id`,
    [String(product._id)]
  );
  return { ...product, prices: prices.rows };
}

module.exports = { createProduct, updateProduct, softDeleteProduct, listProducts, getProductBySlug };
