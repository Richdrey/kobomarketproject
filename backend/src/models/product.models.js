const mongoose = require('mongoose');

const variantSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 100 },
    stockQuantity: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true }
  },
  { _id: true }
);

const productSchema = new mongoose.Schema(
  {
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 180 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, required: true, maxlength: 10000 },
    category: { type: String, required: true, trim: true, index: true },
    images: { type: [String], default: [] },
    stockQuantity: { type: Number, required: true, min: 0 },
    variants: { type: [variantSchema], default: [] },
    tags: { type: [String], default: [] },
    isActive: { type: Boolean, default: true, index: true },
    deletedAt: { type: Date, default: null },
    ratingSum: { type: Number, default: 0, min: 0 },
    ratingCount: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true, versionKey: false }
);

productSchema.index({ name: 'text', description: 'text' });

module.exports = mongoose.model('Product', productSchema);
