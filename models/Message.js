import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    threadId: {
      type: String,
      default: 'red-thread',
      immutable: true,
    },
    sender: {
      type: String,
      enum: ['sahil', 'gauri'],
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    seen: {
      type: Boolean,
      default: false,
    },
    // ─── Reply linking ────────────────────────────────────────────────────────
    // Stored as a snapshot so reply context is preserved even if original
    // message is deleted. The _id field can still be used to scroll-to target.
    replyTo: {
      _id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message',
        default: null,
      },
      text: {
        type: String,
        trim: true,
        maxlength: 500, // truncated snapshot
        default: null,
      },
      sender: {
        type: String,
        enum: ['sahil', 'gauri'],
        default: null,
      },
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

// Index for efficient thread fetching
messageSchema.index({ threadId: 1, createdAt: 1 });

export default mongoose.model('Message', messageSchema);