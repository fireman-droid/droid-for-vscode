// Local transport-neutral forms of Kilo's completion matching contracts.
export interface FillInAtCursorSuggestion { scope: string; prefix: string; suffix: string; text: string }
export interface MatchingSuggestionResult { text: string; matchType: 'exact' | 'partial_typing' | 'backward_deletion' }
export interface PendingRequest { scope: string; prefix: string; suffix: string }
