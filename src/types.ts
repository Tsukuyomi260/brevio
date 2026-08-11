/**
 * Free plan: conversations per calendar month. Display only — the quota is
 * enforced server-side in `api/chat.ts`, which owns the authoritative value.
 */
export const FREE_MONTHLY_QUOTA = 10;

export interface FieldToCollect {
  key: string;
  label: string;
  required: boolean;
}

export interface IntakeConfig {
  assistant_name?: string;
  welcome_message?: string;
  system_prompt_addition?: string;
  fields_to_collect?: FieldToCollect[];
}

export interface Profile {
  id: string;
  email: string;
  business_name: string;
  profession: string;
  slug: string;
  /** Public URL of the practice logo, or null when none has been uploaded. */
  logo_url: string | null;
  intake_config: IntakeConfig;
  plan: 'free' | 'pro';
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}
