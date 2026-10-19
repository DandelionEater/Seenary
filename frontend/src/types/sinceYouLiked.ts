import type { MediaType } from './domain';

export type RecommendationFeedback = 'like' | 'dislike' | null;
export type RecommendationPair = { sourceMediaId: number; recommendedMediaId: number };
export type RecommendationPairState = RecommendationPair & {
  feedbackAdjustment: number;
  sinceYouLikedFeedback: RecommendationFeedback;
};
export type RecommendationStateReply = {
  ok: boolean;
  message?: string;
  pairs?: RecommendationPairState[];
  hiddenMediaIds?: number[];
  retainedMediaIds?: number[];
  resolvedMediaIds?: number[];
};
export type RecommendationStateRequest = { mediaType: MediaType; pairs: RecommendationPair[]; track?: boolean };
export type RecommendationFeedbackRequest = RecommendationPair & { mediaType: MediaType; feedback: RecommendationFeedback };
export type RecommendationHiddenRequest = { mediaType: MediaType; mediaId: number; hidden: boolean };
export const recommendationPairKey = (pair: RecommendationPair) => `${pair.sourceMediaId}:${pair.recommendedMediaId}`;

export type CommunityRecommendationReply = { ok: boolean; message?: string; items?: Array<{ recommendations: number; dislikes: number; media: import('./domain').RecommendationMedia }> };
export type CommunityRecommendationRequest = { mediaType: MediaType; sourceMediaId: number; hideAdultContent: boolean };
export type RecommendationPreferencesRequest = { kind: 'hidden' | 'dislikes'; page: number; hideAdultContent: boolean };
export type RecommendationPreferenceItem = { mediaType: MediaType; mediaId: number; sourceMediaId?: number; media?: import('./domain').RecommendationMedia | null; source?: import('./domain').RecommendationMedia | null };
export type RecommendationPreferencesReply = { ok: boolean; message?: string; totals?: { hidden: number; dislikes: number }; hasMore?: boolean; items?: RecommendationPreferenceItem[] };
