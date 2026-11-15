const Cart = require('../models/cart.models');
const Product = require('../models/product.models');
const pool = require('../configs/postgres');
const { AppError } = require('../middleware/errorHandler');

async function findAvailableProduct(productId, variantId) {
  const product = await Product.findOne({ _id: productId, isActive: true, deletedAt: null });
  if (!product) throw new AppError(404, 'PRODUCT_NOT_AVAILABLE', 'Product is not available');

  if (variantId) {
    const variant = product.variants.id(variantId);
    if (!variant || !variant.isActive) throw new AppError(404, 'VARIANT_NOT_AVAILABLE', 'Product variant is not available');
    return { product, stock: variant.stockQuantity };
  }
  if (product.variants.length) {
    throw new AppError(400, 'VARIANT_REQUIRED', 'Choose a product variant');
  }
  return { product, stock: product.stockQuantity };
}

async function getOrCreateCart(userId) {
  try {
    return await Cart.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId, items: [] } },
      { upsert: true, new: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    return Cart.findOne({ userId });
  }
}

async function getCart(userId) {
  const cart = await getOrCreateCart(userId);
  if (!cart.items.length) return { items: [] };
  const ids = [...new Set(cart.items.map((item) => String(item.productId)))];
  const products = await Product.find({ _id: { $in: ids }, deletedAt: null }).lean();
  const prices = await pool.query(
    `SELECT product_id, variant_id, price_kobo::text AS price_kobo
       FROM product_prices WHERE product_id = ANY($1::text[])`,
    [ids]
  );
  const productById = new Map(products.map((product) => [String(product._id), product]));
  const priceByKey = new Map(prices.rows.map((row) => [`${row.product_id}:${row.variant_id}`, row.price_kobo]));
  const items = cart.items.map((item) => {
    const productId = String(item.productId);
    const variantId = item.variantId ? String(item.variantId) : '';
    const product = productById.get(productId);
    if (!product || !product.isActive) return null;
    const priceKobo = priceByKey.get(`${productId}:${variantId}`);
    return {
      id: String(item._id),
      productId,
      variantId: variantId || null,
      quantity: item.quantity,
      product: { name: product.name, slug: product.slug, images: product.images },
      priceKobo: priceKobo || null,
      currency: 'NGN'
    };
  }).filter(Boolean);
  return { items };
}

async function addItem(userId, { productId, variantId, quantity }) {
  const { stock } = await findAvailableProduct(productId, variantId);
  const cart = await getOrCreateCart(userId);
  const existing = cart.items.find((item) =>
    String(item.productId) === String(productId) &&
    String(item.variantId || '') === String(variantId || '')
  );
  const nextQuantity = (existing?.quantity || 0) + quantity;
  if (nextQuantity > stock) throw new AppError(409, 'INSUFFICIENT_STOCK', 'Requested quantity exceeds available stock');
  if (existing) existing.quantity = nextQuantity;
  else cart.items.push({ productId, variantId: variantId || null, quantity });
  await cart.save();
  return getCart(userId);
}

async function updateItem(userId, itemId, { quantity }) {
  const cart = await Cart.findOne({ userId });
  if (!cart) throw new AppError(404, 'CART_NOT_FOUND', 'Cart not found');
  const item = cart.items.id(itemId);
  if (!item) throw new AppError(404, 'CART_ITEM_NOT_FOUND', 'Cart item not found');
  const { stock } = await findAvailableProduct(item.productId, item.variantId);
  if (quantity > stock) throw new AppError(409, 'INSUFFICIENT_STOCK', 'Requested quantity exceeds available stock');
  item.quantity = quantity;
  await cart.save();
  return getCart(userId);
}

async function removeItem(userId, itemId) {
  const cart = await Cart.findOne({ userId });
  if (!cart) throw new AppError(404, 'CART_NOT_FOUND', 'Cart not found');
  const item = cart.items.id(itemId);
  if (!item) throw new AppError(404, 'CART_ITEM_NOT_FOUND', 'Cart item not found');
  item.deleteOne();
  await cart.save();
  return getCart(userId);
}

module.exports = { getCart, addItem, updateItem, removeItem };
