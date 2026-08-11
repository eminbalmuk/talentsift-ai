export interface Organization {
  id: number;
  display_name: string;
  license_status: "active" | "trial" | "suspended" | "expired";
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
}

export interface DebateResult {
  id?: number;
  optimist_score: number;
  optimist_arguments: string;
  pessimist_score: number;
  pessimist_arguments: string;
  final_score: number;
  arbitrator_rationale: string;
  is_selected: boolean;
  created_at?: string;
}

export interface TopResult {
  candidate_id: number;
  full_name: string;
  university: string | null;
  final_score: number;
  arbitrator_rationale: string;
  is_selected: boolean;
}
