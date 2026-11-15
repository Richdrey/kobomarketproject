const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    orderId: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5, validate: Number.isInteger },
    comment: { type: String, trim: true, maxlength: 2000, default: '' }
  },
  { timestamps: true, versionKey: false }
);

reviewSchema.index({ productId: 1, buyerId: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);
