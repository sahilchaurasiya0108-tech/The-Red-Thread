import mongoose from 'mongoose';

/**
 * Stores Web Push subscriptions for sahil and gauri.
 * userId is a plain string: 'sahil' | 'gauri'
 * (Red Thread has no user accounts — just two named users)
 */
const pushSubscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      enum: ['sahil', 'gauri'],
      required: true,
      index: true,
    },
    subscription: {
      endpoint: { type: String, required: true },
      keys: {
        p256dh: { type: String, required: true },
        auth:   { type: String, required: true },
      },
    },
    // Optional label (browser/device name) for debugging
    label: { type: String, default: '' },
  },
  { timestamps: true }
);

// One subscription per endpoint (no duplicates)
pushSubscriptionSchema.index({ 'subscription.endpoint': 1 }, { unique: true });

export default mongoose.model('PushSubscription', pushSubscriptionSchema);
