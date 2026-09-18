function createProviderBudget({ collection, now = () => Date.now(), spacing = { anilist: 1500, mal: 1000 } }) {
  return {
    async reserve(provider) {
      if (!['anilist', 'mal'].includes(provider)) throw new Error('Invalid provider budget.');
      const gap = Number(spacing[provider]);
      if (!Number.isSafeInteger(gap) || gap < 0 || gap > 60000) throw new Error('Invalid provider spacing.');
      for (let attempt = 0; attempt < 8; attempt++) {
        const time = now();
        const current = await collection.findOne({ _id: provider });
        if (!current) {
          try {
            await collection.insertOne({ _id: provider, revision: 0, nextAllowedAt: new Date(time + gap), updatedAt: new Date(time) });
            return { ok: true, reservedAt: new Date(time) };
          } catch (error) { if (error.code !== 11000) throw error; }
          continue;
        }
        const available = Math.max(time, new Date(current.nextAllowedAt).getTime());
        if (available > time) return { ok: false, retryAfter: Math.max(1, Math.ceil((available - time) / 1000)) };
        const updated = await collection.findOneAndUpdate({ _id: provider, revision: current.revision },
          { $set: { nextAllowedAt: new Date(time + gap), updatedAt: new Date(time) }, $inc: { revision: 1 } }, { returnDocument: 'after' });
        if (updated) return { ok: true, reservedAt: new Date(time) };
      }
      return { ok: false, retryAfter: 1 };
    },
  };
}
module.exports = { createProviderBudget };
