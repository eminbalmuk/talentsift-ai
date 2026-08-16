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
}

export interface CandidateUser {
  id: number;
  email: string;
  full_name: string;
  is_guest: boolean;
  created_at: string;
}

export interface CandidateProfile {
  candidate_id: number;
  full_name: string;
  email: string;
  university: string | null;
  gpa: number | null;
  current_class: number;
  experience_years: number;
  skills: string[];
  raw_cv_text: string;
  source_path: string | null;
  has_embedding: boolean;
  updated_at: string;
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
  arbitrator_rationale: string;
  is_selected: boolean;
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
