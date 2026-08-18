export interface Organization {
  id: number;
  display_name: string;
  license_status: "active" | "trial" | "pending" | "suspended" | "expired";
  license_key_prefix: string | null;
  license_started_at: string | null;
  license_expires_at: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  username: string | null;
  password_prefix: string | null;
  candidate_count: number;
  debate_count: number;
}

export interface OrganizationCredential {
  organization_id: number;
  display_name: string;
  username: string;
  password: string;
  license_key: string;
}

export interface JobPosting {
  id: number;
  title: string;
  description: string;
  deadline_at: string | null;
  is_active: boolean;
  created_at: string;
  candidate_count: number;
  debate_count: number;
}

export interface UploadResult {
  created: { id: number; full_name: string; filename: string }[];
  errors: { filename: string; detail: string }[];
}

export interface Candidate {
  id: number;
  full_name: string;
  university: string | null;
  gpa: number | null;
  current_class: number;
  experience_years: number;
  skills: string[];
  source_path: string | null;
  created_at?: string;
  raw_cv_text?: string;
  // Persisted the moment the candidate applies (posting embedding is cached, so this
  // is free after the first applicant) or after an org runs "sırala"/"kısa liste" --
  // present here so the "Adaylar" tab survives a page refresh.
  pre_llm_score?: number | null;
  relevance_score?: number | null;
  competency_score?: number | null;
}

export interface RankedCandidate extends Candidate {
  raw_cv_text: string;
  similarity: number;
  pre_llm_score?: number;
  relevance_score?: number;
  competency_score?: number;
}

export interface DebateResult {
  id?: number;
  candidate_id: number;
  optimist_score: number;
  optimist_arguments: string;
  pessimist_score: number;
  pessimist_arguments: string;
  final_score: number;
  arbitrator_rationale: string;
  is_selected?: boolean;
  created_at?: string;
  pre_llm_score?: number | null;
  relevance_score?: number | null;
  competency_score?: number | null;
}

export interface CandidateUser {
  id: number;
  email: string;
  full_name: string;
  is_guest: boolean;
  created_at: string;
}

export interface CandidateProfile {
  candidate_id: number | null;
  full_name: string;
  email: string;
  university: string | null;
  gpa: number | null;
  current_class: number | null;
  experience_years: number | null;
  skills: string[] | null;
  raw_cv_text: string | null;
  source_path: string | null;
  has_embedding: boolean;
  updated_at: string | null;
}

export interface OpenJobPosting {
  id: number;
  organization_id: number;
  organization_name: string;
  title: string;
  description: string;
  deadline_at: string | null;
  created_at: string;
}

export interface JobApplication {
  application_id: number;
  job_posting_id: number;
  job_title: string;
  organization_name: string;
  status: string;
  applied_at: string;
}

export interface TopResult {
  candidate_id: number;
  full_name: string;
  university: string | null;
  final_score: number;
  // Blends final_score with pre_llm_score so visually-tied LLM scores (a common LLM
  // habit -- rounding to multiples of 5) still resolve to a distinct, meaningful order.
  // This is what actually decides ranking/selection; final_score alone is just the raw
  // LLM verdict. Falls back to final_score when pre_llm_score isn't available.
  ranking_score: number;
  arbitrator_rationale: string;
  is_selected: boolean;
  pre_llm_score?: number | null;
  relevance_score?: number | null;
  competency_score?: number | null;
  application_status?: "applied" | "selected" | "rejected" | null;
}

export interface FinalizeResponse {
  status: string;
  selected_count: number;
  rejected_post_llm_count: number;
  rejected_pre_llm_count: number;
  notifications_sent: number;
}

export interface ResetEvaluationsResponse {
  status: string;
  debates_deleted: number;
  notifications_deleted: number;
  applications_reset: number;
}

export interface CandidateNotification {
  id: number;
  type: "selected" | "rejected_post_llm" | "rejected_pre_llm";
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  job_title: string | null;
  organization_name: string | null;
  optimist_score: number | null;
  optimist_arguments: string | null;
  pessimist_score: number | null;
  pessimist_arguments: string | null;
  final_score: number | null;
  arbitrator_rationale: string | null;
}

export interface ShortlistCandidateRef {
  id: number;
  full_name: string;
}

export interface ShortlistResponse {
  status: string;
  shortlisted_count: number;
  queued_count: number;
  already_evaluated_count: number;
  queued: ShortlistCandidateRef[];
  already_evaluated: ShortlistCandidateRef[];
}
