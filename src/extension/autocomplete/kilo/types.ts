/*! Adapted from Kilo Code 54de37a85dfef8feb828382d8a71f84139857121
 * (services/autocomplete/types.ts). MIT; see third-party/KILO-LICENSE.txt.
 */
export interface FillInAtCursorSuggestion { scope: string; prefix: string; suffix: string; text: string }
export interface MatchingSuggestionResult { text: string; matchType: 'exact' | 'partial_typing' | 'backward_deletion' }
export interface PendingRequest { scope: string; prefix: string; suffix: string; promise: Promise<void>; resolve?: () => void }
