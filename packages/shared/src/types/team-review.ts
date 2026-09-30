/** Gate 8 / TKT-809 (DEC-017, D24). The author of a review is never shown publicly. */
export type TeamReviewStatus = 'VISIBLE' | 'HIDDEN' | 'DELETED';
export type TeamReviewTextStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type TeamReviewIneligibleReason =
  | 'NOT_FINAL'
  | 'ABANDONED'
  | 'NOT_IN_LINEUP'
  | 'NO_OPPOSING_TEAM'
  | 'OWN_TEAM'
  | 'REVIEW_WINDOW_CLOSED';

export interface MyTeamReview {
  id: string;
  rating: number;
  text: string | null;
  textStatus: TeamReviewTextStatus | null;
  status: TeamReviewStatus;
  editableUntil: string;
  createdAt: string;
}

export interface TeamReviewContext {
  eligible: boolean;
  reason: TeamReviewIneligibleReason | null;
  team: { id: string; name: string } | null;
  editableUntil: string | null;
  /** A new review can be left until this time (14 days after the final result). */
  reviewableUntil: string | null;
  review: MyTeamReview | null;
}

export interface PublicTeamReview {
  id: string;
  rating: number;
  /** Only approved text is ever public. */
  text: string | null;
  createdAt: string;
}

export interface TeamReviewSummary {
  /** False below three visible reviews: show "Not enough reviews." */
  enoughReviews: boolean;
  averageRating: number | null;
  reviewCount: number | null;
  reviews: PublicTeamReview[];
}

export interface AdminTeamReview {
  id: string;
  match: { id: string; name: string };
  team: { id: string; name: string };
  author: { id: string; displayName: string };
  rating: number;
  text: string | null;
  textStatus: TeamReviewTextStatus | null;
  status: TeamReviewStatus;
  reportedAt: string | null;
  moderationNote: string | null;
  createdAt: string;
}
