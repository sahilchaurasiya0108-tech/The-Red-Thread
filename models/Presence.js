import mongoose from 'mongoose';

const presenceSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      enum: ['sahil', 'gauri'],
      required: true,
      unique: true,
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    lastSeen: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: false,
  }
);

export default mongoose.model('Presence', presenceSchema);
