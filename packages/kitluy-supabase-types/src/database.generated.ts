// GENERATED FILE — DO NOT EDIT BY HAND.
// Produced by `pnpm db:types` (supabase gen types typescript) from the LOCAL
// migrated development database. Regenerate instead of editing.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  kitluy_admin: {
    Tables: {
      crm_leads: {
        Row: {
          company_name: string;
          contact_name: string | null;
          contact_phone: string | null;
          created_at: string;
          id: string;
          next_action_at: string | null;
          owner_user_id: string | null;
          source_code: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          company_name: string;
          contact_name?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          id?: string;
          next_action_at?: string | null;
          owner_user_id?: string | null;
          source_code?: string | null;
          status: string;
          updated_at?: string;
        };
        Update: {
          company_name?: string;
          contact_name?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          id?: string;
          next_action_at?: string | null;
          owner_user_id?: string | null;
          source_code?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      go_live_approvals: {
        Row: {
          approver_id: string;
          decided_at: string;
          decision: string;
          evidence_package_id: string | null;
          id: string;
          requester_id: string;
          subject_id: string;
          subject_type: string;
        };
        Insert: {
          approver_id: string;
          decided_at?: string;
          decision: string;
          evidence_package_id?: string | null;
          id?: string;
          requester_id: string;
          subject_id: string;
          subject_type: string;
        };
        Update: {
          approver_id?: string;
          decided_at?: string;
          decision?: string;
          evidence_package_id?: string | null;
          id?: string;
          requester_id?: string;
          subject_id?: string;
          subject_type?: string;
        };
        Relationships: [];
      };
      onboarding_workspaces: {
        Row: {
          created_at: string;
          digital_store_id: string | null;
          id: string;
          owner_id: string | null;
          progress_state: string;
          store_location_id: string | null;
          tenant_id: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          digital_store_id?: string | null;
          id?: string;
          owner_id?: string | null;
          progress_state: string;
          store_location_id?: string | null;
          tenant_id: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          digital_store_id?: string | null;
          id?: string;
          owner_id?: string | null;
          progress_state?: string;
          store_location_id?: string | null;
          tenant_id?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [];
      };
      partner_verification_cases: {
        Row: {
          created_at: string;
          decided_at: string | null;
          evidence_summary: string | null;
          id: string;
          opened_at: string;
          reason_code: string | null;
          reviewer_id: string | null;
          status: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          decided_at?: string | null;
          evidence_summary?: string | null;
          id?: string;
          opened_at?: string;
          reason_code?: string | null;
          reviewer_id?: string | null;
          status?: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          decided_at?: string | null;
          evidence_summary?: string | null;
          id?: string;
          opened_at?: string;
          reason_code?: string | null;
          reviewer_id?: string | null;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      platform_incident_events: {
        Row: {
          actor_id: string | null;
          event_type: string;
          id: string;
          incident_id: string;
          message: string | null;
          occurred_at: string;
        };
        Insert: {
          actor_id?: string | null;
          event_type: string;
          id?: string;
          incident_id: string;
          message?: string | null;
          occurred_at?: string;
        };
        Update: {
          actor_id?: string | null;
          event_type?: string;
          id?: string;
          incident_id?: string;
          message?: string | null;
          occurred_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_incident_events_incident_id_fkey";
            columns: ["incident_id"];
            isOneToOne: false;
            referencedRelation: "platform_incidents";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_incidents: {
        Row: {
          commander_id: string | null;
          created_at: string;
          id: string;
          impact: string | null;
          incident_code: string;
          opened_at: string;
          resolved_at: string | null;
          review_due_at: string | null;
          severity: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          commander_id?: string | null;
          created_at?: string;
          id?: string;
          impact?: string | null;
          incident_code: string;
          opened_at?: string;
          resolved_at?: string | null;
          review_due_at?: string | null;
          severity: string;
          status: string;
          updated_at?: string;
        };
        Update: {
          commander_id?: string | null;
          created_at?: string;
          id?: string;
          impact?: string | null;
          incident_code?: string;
          opened_at?: string;
          resolved_at?: string | null;
          review_due_at?: string | null;
          severity?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      readiness_policies: {
        Row: {
          blocker: boolean;
          created_at: string;
          evaluator_key: string | null;
          id: string;
          policy_key: string;
          status: string;
          subject_type: string;
          version: number;
        };
        Insert: {
          blocker?: boolean;
          created_at?: string;
          evaluator_key?: string | null;
          id?: string;
          policy_key: string;
          status: string;
          subject_type: string;
          version: number;
        };
        Update: {
          blocker?: boolean;
          created_at?: string;
          evaluator_key?: string | null;
          id?: string;
          policy_key?: string;
          status?: string;
          subject_type?: string;
          version?: number;
        };
        Relationships: [];
      };
      readiness_results: {
        Row: {
          as_of: string | null;
          evaluated_at: string;
          evidence_file_id: string | null;
          id: string;
          policy_id: string;
          source_ref: string | null;
          status: string;
          subject_id: string;
          subject_type: string;
        };
        Insert: {
          as_of?: string | null;
          evaluated_at?: string;
          evidence_file_id?: string | null;
          id?: string;
          policy_id: string;
          source_ref?: string | null;
          status: string;
          subject_id: string;
          subject_type: string;
        };
        Update: {
          as_of?: string | null;
          evaluated_at?: string;
          evidence_file_id?: string | null;
          id?: string;
          policy_id?: string;
          source_ref?: string | null;
          status?: string;
          subject_id?: string;
          subject_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "readiness_results_policy_id_fkey";
            columns: ["policy_id"];
            isOneToOne: false;
            referencedRelation: "readiness_policies";
            referencedColumns: ["id"];
          },
        ];
      };
      safety_switches: {
        Row: {
          approval_request_id: string | null;
          created_at: string;
          environment: string;
          id: string;
          reason: string | null;
          scope: string;
          state: string;
          switch_key: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          approval_request_id?: string | null;
          created_at?: string;
          environment: string;
          id?: string;
          reason?: string | null;
          scope: string;
          state: string;
          switch_key: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          approval_request_id?: string | null;
          created_at?: string;
          environment?: string;
          id?: string;
          reason?: string | null;
          scope?: string;
          state?: string;
          switch_key?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [];
      };
      support_access_sessions: {
        Row: {
          consent_ref: string;
          created_at: string;
          expires_at: string;
          id: string;
          purpose: string;
          revoked_at: string | null;
          scope: Json;
          starts_at: string;
          ticket_id: string;
        };
        Insert: {
          consent_ref: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          purpose: string;
          revoked_at?: string | null;
          scope: Json;
          starts_at?: string;
          ticket_id: string;
        };
        Update: {
          consent_ref?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          purpose?: string;
          revoked_at?: string | null;
          scope?: Json;
          starts_at?: string;
          ticket_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_access_sessions_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: false;
            referencedRelation: "support_tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      support_interventions: {
        Row: {
          action: string;
          actor_id: string;
          id: string;
          occurred_at: string;
          outcome: string | null;
          resource: string | null;
          support_access_session_id: string;
        };
        Insert: {
          action: string;
          actor_id: string;
          id?: string;
          occurred_at?: string;
          outcome?: string | null;
          resource?: string | null;
          support_access_session_id: string;
        };
        Update: {
          action?: string;
          actor_id?: string;
          id?: string;
          occurred_at?: string;
          outcome?: string | null;
          resource?: string | null;
          support_access_session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_interventions_support_access_session_id_fkey";
            columns: ["support_access_session_id"];
            isOneToOne: false;
            referencedRelation: "support_access_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      support_tickets: {
        Row: {
          assignee_id: string | null;
          created_at: string;
          digital_store_id: string | null;
          id: string;
          priority: string;
          sla_due_at: string | null;
          status: string;
          store_location_id: string | null;
          tenant_id: string | null;
          updated_at: string;
        };
        Insert: {
          assignee_id?: string | null;
          created_at?: string;
          digital_store_id?: string | null;
          id?: string;
          priority: string;
          sla_due_at?: string | null;
          status: string;
          store_location_id?: string | null;
          tenant_id?: string | null;
          updated_at?: string;
        };
        Update: {
          assignee_id?: string | null;
          created_at?: string;
          digital_store_id?: string | null;
          id?: string;
          priority?: string;
          sla_due_at?: string | null;
          status?: string;
          store_location_id?: string | null;
          tenant_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  kitluy_audit: {
    Tables: {
      access_review_items: {
        Row: {
          access_review_id: string;
          assignment_id: string;
          decided_at: string;
          decision: string;
          evidence: string | null;
          id: string;
          reviewer_id: string | null;
        };
        Insert: {
          access_review_id: string;
          assignment_id: string;
          decided_at?: string;
          decision: string;
          evidence?: string | null;
          id?: string;
          reviewer_id?: string | null;
        };
        Update: {
          access_review_id?: string;
          assignment_id?: string;
          decided_at?: string;
          decision?: string;
          evidence?: string | null;
          id?: string;
          reviewer_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "access_review_items_access_review_id_fkey";
            columns: ["access_review_id"];
            isOneToOne: false;
            referencedRelation: "access_reviews";
            referencedColumns: ["id"];
          },
        ];
      };
      access_reviews: {
        Row: {
          cadence_days: number | null;
          completed_at: string | null;
          created_at: string;
          due_at: string | null;
          id: string;
          owner_user_id: string | null;
          scope: string;
          status: string;
        };
        Insert: {
          cadence_days?: number | null;
          completed_at?: string | null;
          created_at?: string;
          due_at?: string | null;
          id?: string;
          owner_user_id?: string | null;
          scope: string;
          status: string;
        };
        Update: {
          cadence_days?: number | null;
          completed_at?: string | null;
          created_at?: string;
          due_at?: string | null;
          id?: string;
          owner_user_id?: string | null;
          scope?: string;
          status?: string;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_type: string;
          after_hash: string | null;
          before_hash: string | null;
          device_id: string | null;
          digital_store_id: string | null;
          environment: string;
          id: string;
          occurred_at: string;
          permission_key: string | null;
          reason: string | null;
          request_id: string | null;
          resource_id: string | null;
          resource_type: string | null;
          service_identity_id: string | null;
          store_location_id: string | null;
          tenant_id: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_type: string;
          after_hash?: string | null;
          before_hash?: string | null;
          device_id?: string | null;
          digital_store_id?: string | null;
          environment: string;
          id?: string;
          occurred_at?: string;
          permission_key?: string | null;
          reason?: string | null;
          request_id?: string | null;
          resource_id?: string | null;
          resource_type?: string | null;
          service_identity_id?: string | null;
          store_location_id?: string | null;
          tenant_id?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_type?: string;
          after_hash?: string | null;
          before_hash?: string | null;
          device_id?: string | null;
          digital_store_id?: string | null;
          environment?: string;
          id?: string;
          occurred_at?: string;
          permission_key?: string | null;
          reason?: string | null;
          request_id?: string | null;
          resource_id?: string | null;
          resource_type?: string | null;
          service_identity_id?: string | null;
          store_location_id?: string | null;
          tenant_id?: string | null;
        };
        Relationships: [];
      };
      evidence_packages: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          created_at: string;
          file_refs: Json | null;
          id: string;
          manifest_hash: string;
          package_type: string;
          scope: string | null;
          version: number;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          file_refs?: Json | null;
          id?: string;
          manifest_hash: string;
          package_type: string;
          scope?: string | null;
          version?: number;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          file_refs?: Json | null;
          id?: string;
          manifest_hash?: string;
          package_type?: string;
          scope?: string | null;
          version?: number;
        };
        Relationships: [];
      };
      sensitive_action_approvals: {
        Row: {
          action_result_ref: string | null;
          approval_request_id: string;
          executed_at: string;
          executed_by: string | null;
          execution_token_id: string | null;
          id: string;
        };
        Insert: {
          action_result_ref?: string | null;
          approval_request_id: string;
          executed_at?: string;
          executed_by?: string | null;
          execution_token_id?: string | null;
          id?: string;
        };
        Update: {
          action_result_ref?: string | null;
          approval_request_id?: string;
          executed_at?: string;
          executed_by?: string | null;
          execution_token_id?: string | null;
          id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  kitluy_auth: {
    Tables: {
      access_requests: {
        Row: {
          created_at: string;
          expires_at: string | null;
          id: string;
          reason: string;
          requested_role_key: string | null;
          requested_scopes: Json | null;
          requester_id: string;
          status: string;
          subject_id: string;
          ticket_ref: string | null;
        };
        Insert: {
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          reason: string;
          requested_role_key?: string | null;
          requested_scopes?: Json | null;
          requester_id: string;
          status?: string;
          subject_id: string;
          ticket_ref?: string | null;
        };
        Update: {
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          reason?: string;
          requested_role_key?: string | null;
          requested_scopes?: Json | null;
          requester_id?: string;
          status?: string;
          subject_id?: string;
          ticket_ref?: string | null;
        };
        Relationships: [];
      };
      admin_user_profiles: {
        Row: {
          assurance_level: string | null;
          created_at: string;
          disabled_at: string | null;
          last_reauth_at: string | null;
          security_metadata: Json | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          assurance_level?: string | null;
          created_at?: string;
          disabled_at?: string | null;
          last_reauth_at?: string | null;
          security_metadata?: Json | null;
          status: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          assurance_level?: string | null;
          created_at?: string;
          disabled_at?: string | null;
          last_reauth_at?: string | null;
          security_metadata?: Json | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      approval_decisions: {
        Row: {
          approval_request_id: string;
          approver_id: string;
          decided_at: string;
          decision: string;
          evidence_file_id: string | null;
          id: string;
          reason: string | null;
        };
        Insert: {
          approval_request_id: string;
          approver_id: string;
          decided_at?: string;
          decision: string;
          evidence_file_id?: string | null;
          id?: string;
          reason?: string | null;
        };
        Update: {
          approval_request_id?: string;
          approver_id?: string;
          decided_at?: string;
          decision?: string;
          evidence_file_id?: string | null;
          id?: string;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "approval_decisions_approval_request_id_fkey";
            columns: ["approval_request_id"];
            isOneToOne: false;
            referencedRelation: "approval_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      approval_policies: {
        Row: {
          created_at: string;
          environment: string;
          evidence_required: boolean;
          id: string;
          permission_key: string;
          policy_key: string;
          quorum: number;
          reason_required: boolean;
          reauth_required: boolean;
          status: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          environment: string;
          evidence_required?: boolean;
          id?: string;
          permission_key: string;
          policy_key: string;
          quorum?: number;
          reason_required?: boolean;
          reauth_required?: boolean;
          status: string;
          version: number;
        };
        Update: {
          created_at?: string;
          environment?: string;
          evidence_required?: boolean;
          id?: string;
          permission_key?: string;
          policy_key?: string;
          quorum?: number;
          reason_required?: boolean;
          reauth_required?: boolean;
          status?: string;
          version?: number;
        };
        Relationships: [];
      };
      approval_requests: {
        Row: {
          action: string;
          created_at: string;
          environment: string;
          expires_at: string | null;
          id: string;
          payload_hash: string;
          policy_id: string;
          reason: string;
          requester_id: string;
          resource_id: string | null;
          resource_type: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          environment: string;
          expires_at?: string | null;
          id?: string;
          payload_hash: string;
          policy_id: string;
          reason: string;
          requester_id: string;
          resource_id?: string | null;
          resource_type: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          environment?: string;
          expires_at?: string | null;
          id?: string;
          payload_hash?: string;
          policy_id?: string;
          reason?: string;
          requester_id?: string;
          resource_id?: string | null;
          resource_type?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "approval_requests_policy_id_fkey";
            columns: ["policy_id"];
            isOneToOne: false;
            referencedRelation: "approval_policies";
            referencedColumns: ["id"];
          },
        ];
      };
      assignment_scopes: {
        Row: {
          created_at: string;
          environment: string;
          exclusion_set_id: string | null;
          id: string;
          include_descendants: boolean;
          role_assignment_id: string;
          scope_id: string | null;
          scope_type: string;
        };
        Insert: {
          created_at?: string;
          environment: string;
          exclusion_set_id?: string | null;
          id?: string;
          include_descendants?: boolean;
          role_assignment_id: string;
          scope_id?: string | null;
          scope_type: string;
        };
        Update: {
          created_at?: string;
          environment?: string;
          exclusion_set_id?: string | null;
          id?: string;
          include_descendants?: boolean;
          role_assignment_id?: string;
          scope_id?: string | null;
          scope_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "assignment_scopes_role_assignment_id_fkey";
            columns: ["role_assignment_id"];
            isOneToOne: false;
            referencedRelation: "role_assignments";
            referencedColumns: ["id"];
          },
        ];
      };
      authorization_decisions: {
        Row: {
          actor_id: string | null;
          actor_type: string;
          decided_at: string;
          environment: string;
          id: string;
          permission_key: string;
          policy_version: string | null;
          reason_code: string | null;
          request_id: string | null;
          resource_id: string | null;
          resource_type: string | null;
          result: string;
          scope_snapshot: Json | null;
          subject_id: string | null;
          tenant_id: string | null;
        };
        Insert: {
          actor_id?: string | null;
          actor_type: string;
          decided_at?: string;
          environment: string;
          id?: string;
          permission_key: string;
          policy_version?: string | null;
          reason_code?: string | null;
          request_id?: string | null;
          resource_id?: string | null;
          resource_type?: string | null;
          result: string;
          scope_snapshot?: Json | null;
          subject_id?: string | null;
          tenant_id?: string | null;
        };
        Update: {
          actor_id?: string | null;
          actor_type?: string;
          decided_at?: string;
          environment?: string;
          id?: string;
          permission_key?: string;
          policy_version?: string | null;
          reason_code?: string | null;
          request_id?: string | null;
          resource_id?: string | null;
          resource_type?: string | null;
          result?: string;
          scope_snapshot?: Json | null;
          subject_id?: string | null;
          tenant_id?: string | null;
        };
        Relationships: [];
      };
      authorization_decisions_default: {
        Row: {
          actor_id: string | null;
          actor_type: string;
          decided_at: string;
          environment: string;
          id: string;
          permission_key: string;
          policy_version: string | null;
          reason_code: string | null;
          request_id: string | null;
          resource_id: string | null;
          resource_type: string | null;
          result: string;
          scope_snapshot: Json | null;
          subject_id: string | null;
          tenant_id: string | null;
        };
        Insert: {
          actor_id?: string | null;
          actor_type: string;
          decided_at?: string;
          environment: string;
          id?: string;
          permission_key: string;
          policy_version?: string | null;
          reason_code?: string | null;
          request_id?: string | null;
          resource_id?: string | null;
          resource_type?: string | null;
          result: string;
          scope_snapshot?: Json | null;
          subject_id?: string | null;
          tenant_id?: string | null;
        };
        Update: {
          actor_id?: string | null;
          actor_type?: string;
          decided_at?: string;
          environment?: string;
          id?: string;
          permission_key?: string;
          policy_version?: string | null;
          reason_code?: string | null;
          request_id?: string | null;
          resource_id?: string | null;
          resource_type?: string | null;
          result?: string;
          scope_snapshot?: Json | null;
          subject_id?: string | null;
          tenant_id?: string | null;
        };
        Relationships: [];
      };
      break_glass_sessions: {
        Row: {
          actor_id: string;
          created_at: string;
          ended_at: string | null;
          environment: string;
          expires_at: string;
          grants: Json;
          id: string;
          incident_id: string;
          review_status: string;
          started_at: string;
        };
        Insert: {
          actor_id: string;
          created_at?: string;
          ended_at?: string | null;
          environment: string;
          expires_at: string;
          grants: Json;
          id?: string;
          incident_id: string;
          review_status: string;
          started_at?: string;
        };
        Update: {
          actor_id?: string;
          created_at?: string;
          ended_at?: string | null;
          environment?: string;
          expires_at?: string;
          grants?: Json;
          id?: string;
          incident_id?: string;
          review_status?: string;
          started_at?: string;
        };
        Relationships: [];
      };
      execution_tokens: {
        Row: {
          approval_request_id: string;
          created_at: string;
          expires_at: string;
          id: string;
          payload_hash: string;
          revoked_at: string | null;
          token_hash: string;
          used_at: string | null;
        };
        Insert: {
          approval_request_id: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          payload_hash: string;
          revoked_at?: string | null;
          token_hash: string;
          used_at?: string | null;
        };
        Update: {
          approval_request_id?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          payload_hash?: string;
          revoked_at?: string | null;
          token_hash?: string;
          used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "execution_tokens_approval_request_id_fkey";
            columns: ["approval_request_id"];
            isOneToOne: false;
            referencedRelation: "approval_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      permissions: {
        Row: {
          created_at: string;
          environments: string[];
          id: string;
          permission_key: string;
          resource_types: string[];
          risk_class: string;
          status: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          environments?: string[];
          id?: string;
          permission_key: string;
          resource_types?: string[];
          risk_class: string;
          status: string;
          version: number;
        };
        Update: {
          created_at?: string;
          environments?: string[];
          id?: string;
          permission_key?: string;
          resource_types?: string[];
          risk_class?: string;
          status?: string;
          version?: number;
        };
        Relationships: [];
      };
      role_assignments: {
        Row: {
          created_at: string;
          granted_by: string | null;
          id: string;
          review_due_at: string | null;
          role_template_id: string;
          status: string;
          subject_id: string;
          subject_type: string;
          team_id: string | null;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          created_at?: string;
          granted_by?: string | null;
          id?: string;
          review_due_at?: string | null;
          role_template_id: string;
          status?: string;
          subject_id: string;
          subject_type: string;
          team_id?: string | null;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          created_at?: string;
          granted_by?: string | null;
          id?: string;
          review_due_at?: string | null;
          role_template_id?: string;
          status?: string;
          subject_id?: string;
          subject_type?: string;
          team_id?: string | null;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "role_assignments_role_template_id_fkey";
            columns: ["role_template_id"];
            isOneToOne: false;
            referencedRelation: "role_templates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "role_assignments_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      role_permission_grants: {
        Row: {
          constraint_set_id: string | null;
          created_at: string;
          effect: string;
          id: string;
          permission_id: string;
          role_template_id: string;
        };
        Insert: {
          constraint_set_id?: string | null;
          created_at?: string;
          effect?: string;
          id?: string;
          permission_id: string;
          role_template_id: string;
        };
        Update: {
          constraint_set_id?: string | null;
          created_at?: string;
          effect?: string;
          id?: string;
          permission_id?: string;
          role_template_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "role_permission_grants_permission_id_fkey";
            columns: ["permission_id"];
            isOneToOne: false;
            referencedRelation: "permissions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "role_permission_grants_role_template_id_fkey";
            columns: ["role_template_id"];
            isOneToOne: false;
            referencedRelation: "role_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      role_templates: {
        Row: {
          created_at: string;
          effective_from: string | null;
          effective_to: string | null;
          id: string;
          name: string;
          role_key: string;
          status: string;
          system_role: boolean;
          version: number;
        };
        Insert: {
          created_at?: string;
          effective_from?: string | null;
          effective_to?: string | null;
          id?: string;
          name: string;
          role_key: string;
          status: string;
          system_role?: boolean;
          version: number;
        };
        Update: {
          created_at?: string;
          effective_from?: string | null;
          effective_to?: string | null;
          id?: string;
          name?: string;
          role_key?: string;
          status?: string;
          system_role?: boolean;
          version?: number;
        };
        Relationships: [];
      };
      separation_of_duties_rules: {
        Row: {
          created_at: string;
          effective_from: string | null;
          effective_to: string | null;
          id: string;
          left_permission_key: string;
          right_permission_key: string;
          rule_key: string;
          status: string;
          treatment: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          effective_from?: string | null;
          effective_to?: string | null;
          id?: string;
          left_permission_key: string;
          right_permission_key: string;
          rule_key: string;
          status: string;
          treatment: string;
          version: number;
        };
        Update: {
          created_at?: string;
          effective_from?: string | null;
          effective_to?: string | null;
          id?: string;
          left_permission_key?: string;
          right_permission_key?: string;
          rule_key?: string;
          status?: string;
          treatment?: string;
          version?: number;
        };
        Relationships: [];
      };
      service_identities: {
        Row: {
          created_at: string;
          credential_ref: string;
          environment: string;
          id: string;
          rotation_due_at: string | null;
          service_key: string;
          status: string;
          updated_at: string;
          workload: string;
        };
        Insert: {
          created_at?: string;
          credential_ref: string;
          environment: string;
          id?: string;
          rotation_due_at?: string | null;
          service_key: string;
          status: string;
          updated_at?: string;
          workload: string;
        };
        Update: {
          created_at?: string;
          credential_ref?: string;
          environment?: string;
          id?: string;
          rotation_due_at?: string | null;
          service_key?: string;
          status?: string;
          updated_at?: string;
          workload?: string;
        };
        Relationships: [];
      };
      team_memberships: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          review_due_at: string | null;
          status: string;
          team_id: string;
          user_id: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          review_due_at?: string | null;
          status?: string;
          team_id: string;
          user_id: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          review_due_at?: string | null;
          status?: string;
          team_id?: string;
          user_id?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "team_memberships_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      teams: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          owner_user_id: string | null;
          review_cadence_days: number | null;
          status: string;
          team_key: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          owner_user_id?: string | null;
          review_cadence_days?: number | null;
          status: string;
          team_key: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          owner_user_id?: string | null;
          review_cadence_days?: number | null;
          status?: string;
          team_key?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      temporary_grants: {
        Row: {
          approver_id: string | null;
          created_at: string;
          environment: string;
          expires_at: string;
          id: string;
          permission_key: string;
          reason: string;
          scope: Json | null;
          starts_at: string;
          subject_id: string;
        };
        Insert: {
          approver_id?: string | null;
          created_at?: string;
          environment: string;
          expires_at: string;
          id?: string;
          permission_key: string;
          reason: string;
          scope?: Json | null;
          starts_at: string;
          subject_id: string;
        };
        Update: {
          approver_id?: string | null;
          created_at?: string;
          environment?: string;
          expires_at?: string;
          id?: string;
          permission_key?: string;
          reason?: string;
          scope?: Json | null;
          starts_at?: string;
          subject_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      assert_permission: {
        Args: {
          p_environment?: string;
          p_permission_key: string;
          p_resource_id?: string;
          p_resource_type?: string;
        };
        Returns: undefined;
      };
      consume_execution_token: {
        Args: { p_payload_hash: string; p_token: string };
        Returns: string;
      };
      current_actor_context: { Args: never; Returns: Json };
      current_digital_store_ids: { Args: never; Returns: string[] };
      current_location_ids: { Args: never; Returns: string[] };
      current_tenant_ids: { Args: never; Returns: string[] };
      has_permission: {
        Args: {
          p_environment?: string;
          p_permission_key: string;
          p_resource_id?: string;
          p_resource_type?: string;
        };
        Returns: boolean;
      };
      record_authorization_decision: {
        Args: {
          p_actor_id: string;
          p_actor_type: string;
          p_environment: string;
          p_permission_key: string;
          p_reason_code?: string;
          p_request_id?: string;
          p_resource_id: string;
          p_resource_type: string;
          p_result: string;
          p_scope_snapshot?: Json;
          p_tenant_id?: string;
        };
        Returns: undefined;
      };
      require_reauthentication: {
        Args: { p_max_age_seconds: number };
        Returns: boolean;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  kitluy_core: {
    Tables: {
      catalog_item_translations: {
        Row: {
          catalog_item_id: string;
          created_at: string;
          description: string | null;
          id: string;
          locale: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          catalog_item_id: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          locale: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          catalog_item_id?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          locale?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "catalog_item_translations_catalog_item_id_fkey";
            columns: ["catalog_item_id"];
            isOneToOne: false;
            referencedRelation: "catalog_items";
            referencedColumns: ["id"];
          },
        ];
      };
      catalog_items: {
        Row: {
          code: string;
          created_at: string;
          digital_store_id: string;
          id: string;
          item_type: string;
          metadata: Json | null;
          name: string;
          status: string;
          tenant_id: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          code: string;
          created_at?: string;
          digital_store_id: string;
          id?: string;
          item_type: string;
          metadata?: Json | null;
          name: string;
          status?: string;
          tenant_id: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          code?: string;
          created_at?: string;
          digital_store_id?: string;
          id?: string;
          item_type?: string;
          metadata?: Json | null;
          name?: string;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "catalog_items_digital_store_id_fkey";
            columns: ["digital_store_id"];
            isOneToOne: false;
            referencedRelation: "digital_stores";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "catalog_items_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "catalog_items_tenant_store_fk";
            columns: ["tenant_id", "digital_store_id"];
            isOneToOne: false;
            referencedRelation: "digital_stores";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      consent_grants: {
        Row: {
          channel: string;
          consent_purpose_version_id: string;
          customer_id: string;
          evidence_ref: string | null;
          granted_at: string;
          id: string;
          recorded_by: string | null;
          source: string;
          tenant_id: string;
        };
        Insert: {
          channel: string;
          consent_purpose_version_id: string;
          customer_id: string;
          evidence_ref?: string | null;
          granted_at?: string;
          id?: string;
          recorded_by?: string | null;
          source: string;
          tenant_id: string;
        };
        Update: {
          channel?: string;
          consent_purpose_version_id?: string;
          customer_id?: string;
          evidence_ref?: string | null;
          granted_at?: string;
          id?: string;
          recorded_by?: string | null;
          source?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "consent_grants_consent_purpose_version_id_fkey";
            columns: ["consent_purpose_version_id"];
            isOneToOne: false;
            referencedRelation: "consent_purpose_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "consent_grants_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "consent_grants_tenant_customer_fk";
            columns: ["tenant_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "consent_grants_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      consent_purpose_versions: {
        Row: {
          consent_purpose_id: string;
          created_at: string;
          effective_from: string;
          effective_to: string | null;
          id: string;
          notice_text: string | null;
          policy_ref: string | null;
          version: number;
        };
        Insert: {
          consent_purpose_id: string;
          created_at?: string;
          effective_from?: string;
          effective_to?: string | null;
          id?: string;
          notice_text?: string | null;
          policy_ref?: string | null;
          version: number;
        };
        Update: {
          consent_purpose_id?: string;
          created_at?: string;
          effective_from?: string;
          effective_to?: string | null;
          id?: string;
          notice_text?: string | null;
          policy_ref?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "consent_purpose_versions_consent_purpose_id_fkey";
            columns: ["consent_purpose_id"];
            isOneToOne: false;
            referencedRelation: "consent_purposes";
            referencedColumns: ["id"];
          },
        ];
      };
      consent_purposes: {
        Row: {
          communication_class: string;
          created_at: string;
          description: string | null;
          id: string;
          purpose_key: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          communication_class: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          purpose_key: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          communication_class?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          purpose_key?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      consent_withdrawals: {
        Row: {
          consent_grant_id: string;
          id: string;
          reason_code: string | null;
          recorded_by: string | null;
          source: string;
          tenant_id: string;
          withdrawn_at: string;
        };
        Insert: {
          consent_grant_id: string;
          id?: string;
          reason_code?: string | null;
          recorded_by?: string | null;
          source: string;
          tenant_id: string;
          withdrawn_at?: string;
        };
        Update: {
          consent_grant_id?: string;
          id?: string;
          reason_code?: string | null;
          recorded_by?: string | null;
          source?: string;
          tenant_id?: string;
          withdrawn_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "consent_withdrawals_consent_grant_id_fkey";
            columns: ["consent_grant_id"];
            isOneToOne: true;
            referencedRelation: "consent_grants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "consent_withdrawals_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_contacts: {
        Row: {
          consent_status: string;
          created_at: string;
          customer_id: string;
          display_value: string | null;
          id: string;
          is_primary: boolean;
          masked_value: string | null;
          normalized_value: string;
          status: string;
          tenant_id: string;
          type: string;
          updated_at: string;
          verified_at: string | null;
        };
        Insert: {
          consent_status?: string;
          created_at?: string;
          customer_id: string;
          display_value?: string | null;
          id?: string;
          is_primary?: boolean;
          masked_value?: string | null;
          normalized_value: string;
          status?: string;
          tenant_id: string;
          type: string;
          updated_at?: string;
          verified_at?: string | null;
        };
        Update: {
          consent_status?: string;
          created_at?: string;
          customer_id?: string;
          display_value?: string | null;
          id?: string;
          is_primary?: boolean;
          masked_value?: string | null;
          normalized_value?: string;
          status?: string;
          tenant_id?: string;
          type?: string;
          updated_at?: string;
          verified_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "customer_contacts_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_contacts_tenant_customer_fk";
            columns: ["tenant_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "customer_contacts_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_merge_requests: {
        Row: {
          decided_at: string | null;
          id: string;
          match_evidence: Json | null;
          merging_customer_id: string;
          reason: string | null;
          requested_at: string;
          requested_by: string;
          reviewed_by: string | null;
          status: string;
          surviving_customer_id: string;
          tenant_id: string;
        };
        Insert: {
          decided_at?: string | null;
          id?: string;
          match_evidence?: Json | null;
          merging_customer_id: string;
          reason?: string | null;
          requested_at?: string;
          requested_by: string;
          reviewed_by?: string | null;
          status?: string;
          surviving_customer_id: string;
          tenant_id: string;
        };
        Update: {
          decided_at?: string | null;
          id?: string;
          match_evidence?: Json | null;
          merging_customer_id?: string;
          reason?: string | null;
          requested_at?: string;
          requested_by?: string;
          reviewed_by?: string | null;
          status?: string;
          surviving_customer_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_merge_requests_merging_customer_id_fkey";
            columns: ["merging_customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_merge_requests_surviving_customer_id_fkey";
            columns: ["surviving_customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_merge_requests_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_merge_requests_tenant_merging_fk";
            columns: ["tenant_id", "merging_customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "customer_merge_requests_tenant_survivor_fk";
            columns: ["tenant_id", "surviving_customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      customer_merge_results: {
        Row: {
          completed_at: string;
          completed_by: string | null;
          id: string;
          merge_request_id: string;
          merged_customer_id: string;
          moved_links: Json | null;
          surviving_customer_id: string;
          tenant_id: string;
        };
        Insert: {
          completed_at?: string;
          completed_by?: string | null;
          id?: string;
          merge_request_id: string;
          merged_customer_id: string;
          moved_links?: Json | null;
          surviving_customer_id: string;
          tenant_id: string;
        };
        Update: {
          completed_at?: string;
          completed_by?: string | null;
          id?: string;
          merge_request_id?: string;
          merged_customer_id?: string;
          moved_links?: Json | null;
          surviving_customer_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_merge_results_merge_request_id_fkey";
            columns: ["merge_request_id"];
            isOneToOne: true;
            referencedRelation: "customer_merge_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_merge_results_merged_customer_id_fkey";
            columns: ["merged_customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_merge_results_surviving_customer_id_fkey";
            columns: ["surviving_customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_merge_results_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_status_history: {
        Row: {
          actor_id: string | null;
          customer_id: string;
          from_status: string | null;
          id: string;
          occurred_at: string;
          reason_code: string | null;
          tenant_id: string;
          to_status: string;
        };
        Insert: {
          actor_id?: string | null;
          customer_id: string;
          from_status?: string | null;
          id?: string;
          occurred_at?: string;
          reason_code?: string | null;
          tenant_id: string;
          to_status: string;
        };
        Update: {
          actor_id?: string | null;
          customer_id?: string;
          from_status?: string | null;
          id?: string;
          occurred_at?: string;
          reason_code?: string | null;
          tenant_id?: string;
          to_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_status_history_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_status_history_tenant_customer_fk";
            columns: ["tenant_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "customer_status_history_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_store_relationships: {
        Row: {
          created_at: string;
          customer_id: string;
          digital_store_id: string;
          first_seen_at: string;
          id: string;
          last_activity_at: string | null;
          source_code: string | null;
          status: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          customer_id: string;
          digital_store_id: string;
          first_seen_at?: string;
          id?: string;
          last_activity_at?: string | null;
          source_code?: string | null;
          status?: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          customer_id?: string;
          digital_store_id?: string;
          first_seen_at?: string;
          id?: string;
          last_activity_at?: string | null;
          source_code?: string | null;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_store_relationships_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_store_relationships_digital_store_id_fkey";
            columns: ["digital_store_id"];
            isOneToOne: false;
            referencedRelation: "digital_stores";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_store_relationships_tenant_customer_fk";
            columns: ["tenant_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "customer_store_relationships_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_store_relationships_tenant_store_fk";
            columns: ["tenant_id", "digital_store_id"];
            isOneToOne: false;
            referencedRelation: "digital_stores";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      customers: {
        Row: {
          created_at: string;
          display_name: string | null;
          id: string;
          merged_into_customer_id: string | null;
          preferred_locale: string | null;
          status: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          id?: string;
          merged_into_customer_id?: string | null;
          preferred_locale?: string | null;
          status?: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          id?: string;
          merged_into_customer_id?: string | null;
          preferred_locale?: string | null;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customers_merged_into_customer_id_fkey";
            columns: ["merged_into_customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customers_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      digital_store_location_links: {
        Row: {
          created_at: string;
          digital_store_id: string;
          id: string;
          reason_code: string | null;
          store_location_id: string;
          tenant_id: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          created_at?: string;
          digital_store_id: string;
          id?: string;
          reason_code?: string | null;
          store_location_id: string;
          tenant_id: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          created_at?: string;
          digital_store_id?: string;
          id?: string;
          reason_code?: string | null;
          store_location_id?: string;
          tenant_id?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "digital_store_location_links_digital_store_id_fkey";
            columns: ["digital_store_id"];
            isOneToOne: false;
            referencedRelation: "digital_stores";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "digital_store_location_links_store_location_id_fkey";
            columns: ["store_location_id"];
            isOneToOne: false;
            referencedRelation: "store_locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "digital_store_location_links_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      digital_stores: {
        Row: {
          created_at: string;
          default_currency_code: string;
          default_locale: string;
          id: string;
          name: string;
          primary_vertical_code: string;
          status: string;
          store_code: string;
          tenant_id: string;
          timezone: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          default_currency_code?: string;
          default_locale?: string;
          id?: string;
          name: string;
          primary_vertical_code: string;
          status?: string;
          store_code: string;
          tenant_id: string;
          timezone?: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          default_currency_code?: string;
          default_locale?: string;
          id?: string;
          name?: string;
          primary_vertical_code?: string;
          status?: string;
          store_code?: string;
          tenant_id?: string;
          timezone?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "digital_stores_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      feature_flags: {
        Row: {
          created_at: string;
          environment: string;
          flag_key: string;
          id: string;
          scope_id: string | null;
          scope_type: string;
          state: string;
          updated_at: string;
          valid_from: string;
          valid_to: string | null;
          value: Json | null;
          version: number;
        };
        Insert: {
          created_at?: string;
          environment: string;
          flag_key: string;
          id?: string;
          scope_id?: string | null;
          scope_type: string;
          state: string;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
          value?: Json | null;
          version?: number;
        };
        Update: {
          created_at?: string;
          environment?: string;
          flag_key?: string;
          id?: string;
          scope_id?: string | null;
          scope_type?: string;
          state?: string;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
          value?: Json | null;
          version?: number;
        };
        Relationships: [];
      };
      memberships: {
        Row: {
          created_at: string;
          id: string;
          status: string;
          tenant_id: string;
          user_id: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          status?: string;
          tenant_id: string;
          user_id: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          status?: string;
          tenant_id?: string;
          user_id?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "memberships_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      partner_accounts: {
        Row: {
          contact_email: string | null;
          contact_name: string | null;
          contact_phone: string | null;
          created_at: string;
          id: string;
          partner_type: string;
          tenant_id: string;
          updated_at: string;
          verification_status: string;
        };
        Insert: {
          contact_email?: string | null;
          contact_name?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          id?: string;
          partner_type: string;
          tenant_id: string;
          updated_at?: string;
          verification_status?: string;
        };
        Update: {
          contact_email?: string | null;
          contact_name?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          id?: string;
          partner_type?: string;
          tenant_id?: string;
          updated_at?: string;
          verification_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "partner_accounts_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: true;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      plans: {
        Row: {
          created_at: string;
          effective_from: string;
          effective_to: string | null;
          id: string;
          plan_code: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          effective_from: string;
          effective_to?: string | null;
          id?: string;
          plan_code: string;
          status: string;
        };
        Update: {
          created_at?: string;
          effective_from?: string;
          effective_to?: string | null;
          id?: string;
          plan_code?: string;
          status?: string;
        };
        Relationships: [];
      };
      privacy_request_decisions: {
        Row: {
          decided_at: string;
          decided_by: string | null;
          decision: string;
          evidence_ref: string | null;
          id: string;
          privacy_request_id: string;
          reason: string | null;
        };
        Insert: {
          decided_at?: string;
          decided_by?: string | null;
          decision: string;
          evidence_ref?: string | null;
          id?: string;
          privacy_request_id: string;
          reason?: string | null;
        };
        Update: {
          decided_at?: string;
          decided_by?: string | null;
          decision?: string;
          evidence_ref?: string | null;
          id?: string;
          privacy_request_id?: string;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "privacy_request_decisions_privacy_request_id_fkey";
            columns: ["privacy_request_id"];
            isOneToOne: false;
            referencedRelation: "privacy_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      privacy_requests: {
        Row: {
          customer_id: string;
          id: string;
          request_type: string;
          requested_at: string;
          requested_by: string | null;
          scope: Json | null;
          tenant_id: string;
          verification_ref: string | null;
        };
        Insert: {
          customer_id: string;
          id?: string;
          request_type: string;
          requested_at?: string;
          requested_by?: string | null;
          scope?: Json | null;
          tenant_id: string;
          verification_ref?: string | null;
        };
        Update: {
          customer_id?: string;
          id?: string;
          request_type?: string;
          requested_at?: string;
          requested_by?: string | null;
          scope?: Json | null;
          tenant_id?: string;
          verification_ref?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "privacy_requests_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "privacy_requests_tenant_customer_fk";
            columns: ["tenant_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "privacy_requests_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      reference_value_translations: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          label: string;
          locale: string;
          reference_value_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          label: string;
          locale: string;
          reference_value_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          label?: string;
          locale?: string;
          reference_value_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reference_value_translations_reference_value_id_fkey";
            columns: ["reference_value_id"];
            isOneToOne: false;
            referencedRelation: "reference_values";
            referencedColumns: ["id"];
          },
        ];
      };
      reference_values: {
        Row: {
          created_at: string;
          effective_from: string;
          effective_to: string | null;
          id: string;
          metadata: Json | null;
          registry_key: string;
          sort_order: number;
          status: string;
          updated_at: string;
          value_code: string;
        };
        Insert: {
          created_at?: string;
          effective_from?: string;
          effective_to?: string | null;
          id?: string;
          metadata?: Json | null;
          registry_key: string;
          sort_order?: number;
          status?: string;
          updated_at?: string;
          value_code: string;
        };
        Update: {
          created_at?: string;
          effective_from?: string;
          effective_to?: string | null;
          id?: string;
          metadata?: Json | null;
          registry_key?: string;
          sort_order?: number;
          status?: string;
          updated_at?: string;
          value_code?: string;
        };
        Relationships: [];
      };
      store_locations: {
        Row: {
          address_line1: string | null;
          address_line2: string | null;
          city: string | null;
          country_code: string;
          created_at: string;
          digital_store_id: string;
          hub_required: boolean;
          id: string;
          location_code: string;
          name: string;
          operating_status: string;
          postal_code: string | null;
          province: string | null;
          tenant_id: string;
          timezone: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          address_line1?: string | null;
          address_line2?: string | null;
          city?: string | null;
          country_code?: string;
          created_at?: string;
          digital_store_id: string;
          hub_required?: boolean;
          id?: string;
          location_code: string;
          name: string;
          operating_status?: string;
          postal_code?: string | null;
          province?: string | null;
          tenant_id: string;
          timezone?: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          address_line1?: string | null;
          address_line2?: string | null;
          city?: string | null;
          country_code?: string;
          created_at?: string;
          digital_store_id?: string;
          hub_required?: boolean;
          id?: string;
          location_code?: string;
          name?: string;
          operating_status?: string;
          postal_code?: string | null;
          province?: string | null;
          tenant_id?: string;
          timezone?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "store_locations_digital_store_id_fkey";
            columns: ["digital_store_id"];
            isOneToOne: false;
            referencedRelation: "digital_stores";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "store_locations_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenants: {
        Row: {
          created_at: string;
          default_locale: string;
          display_name: string | null;
          id: string;
          legal_name: string;
          status: string;
          tenant_code: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          default_locale?: string;
          display_name?: string | null;
          id?: string;
          legal_name: string;
          status?: string;
          tenant_code: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          default_locale?: string;
          display_name?: string | null;
          id?: string;
          legal_name?: string;
          status?: string;
          tenant_code?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  kitluy_finance: {
    Tables: {
      idempotency_records: {
        Row: {
          created_at: string;
          expires_at: string | null;
          id: string;
          idempotency_key: string;
          request_hash: string;
          response_ref: string | null;
          scope_key: string;
          status: string;
          tenant_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          idempotency_key: string;
          request_hash: string;
          response_ref?: string | null;
          scope_key: string;
          status?: string;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          idempotency_key?: string;
          request_hash?: string;
          response_ref?: string | null;
          scope_key?: string;
          status?: string;
          tenant_id?: string;
        };
        Relationships: [];
      };
      journal_entries: {
        Row: {
          actor_service_key: string | null;
          actor_user_id: string | null;
          business_date: string;
          business_date_policy_version: string | null;
          correlation_id: string | null;
          created_at: string;
          currency_code: string;
          description: string | null;
          device_id: string | null;
          digital_store_id: string;
          entry_type: string;
          id: string;
          origin: string;
          origin_device_id: string | null;
          origin_sequence: number | null;
          original_business_date: string | null;
          period_classification: string;
          pos_session_id: string | null;
          posted_at: string;
          posting_rule_key: string;
          posting_rule_version: string | null;
          reason_code: string | null;
          reverses_journal_entry_id: string | null;
          shift_id: string | null;
          source_id: string;
          source_type: string;
          store_location_id: string | null;
          tenant_id: string;
        };
        Insert: {
          actor_service_key?: string | null;
          actor_user_id?: string | null;
          business_date: string;
          business_date_policy_version?: string | null;
          correlation_id?: string | null;
          created_at?: string;
          currency_code: string;
          description?: string | null;
          device_id?: string | null;
          digital_store_id: string;
          entry_type: string;
          id?: string;
          origin?: string;
          origin_device_id?: string | null;
          origin_sequence?: number | null;
          original_business_date?: string | null;
          period_classification?: string;
          pos_session_id?: string | null;
          posted_at?: string;
          posting_rule_key: string;
          posting_rule_version?: string | null;
          reason_code?: string | null;
          reverses_journal_entry_id?: string | null;
          shift_id?: string | null;
          source_id: string;
          source_type: string;
          store_location_id?: string | null;
          tenant_id: string;
        };
        Update: {
          actor_service_key?: string | null;
          actor_user_id?: string | null;
          business_date?: string;
          business_date_policy_version?: string | null;
          correlation_id?: string | null;
          created_at?: string;
          currency_code?: string;
          description?: string | null;
          device_id?: string | null;
          digital_store_id?: string;
          entry_type?: string;
          id?: string;
          origin?: string;
          origin_device_id?: string | null;
          origin_sequence?: number | null;
          original_business_date?: string | null;
          period_classification?: string;
          pos_session_id?: string | null;
          posted_at?: string;
          posting_rule_key?: string;
          posting_rule_version?: string | null;
          reason_code?: string | null;
          reverses_journal_entry_id?: string | null;
          shift_id?: string | null;
          source_id?: string;
          source_type?: string;
          store_location_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "journal_entries_reverses_journal_entry_id_fkey";
            columns: ["reverses_journal_entry_id"];
            isOneToOne: false;
            referencedRelation: "journal_entries";
            referencedColumns: ["id"];
          },
        ];
      };
      journal_postings: {
        Row: {
          amount_minor: number;
          created_at: string;
          currency_code: string;
          direction: string;
          id: string;
          journal_entry_id: string;
          line_no: number;
          memo: string | null;
          metadata: Json | null;
          subledger_account_id: string;
          tenant_id: string;
        };
        Insert: {
          amount_minor: number;
          created_at?: string;
          currency_code: string;
          direction: string;
          id?: string;
          journal_entry_id: string;
          line_no: number;
          memo?: string | null;
          metadata?: Json | null;
          subledger_account_id: string;
          tenant_id: string;
        };
        Update: {
          amount_minor?: number;
          created_at?: string;
          currency_code?: string;
          direction?: string;
          id?: string;
          journal_entry_id?: string;
          line_no?: number;
          memo?: string | null;
          metadata?: Json | null;
          subledger_account_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "journal_postings_journal_entry_id_fkey";
            columns: ["journal_entry_id"];
            isOneToOne: false;
            referencedRelation: "journal_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "journal_postings_subledger_account_id_fkey";
            columns: ["subledger_account_id"];
            isOneToOne: false;
            referencedRelation: "subledger_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "journal_postings_tenant_account_fk";
            columns: ["tenant_id", "subledger_account_id"];
            isOneToOne: false;
            referencedRelation: "subledger_accounts";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "journal_postings_tenant_entry_fk";
            columns: ["tenant_id", "journal_entry_id"];
            isOneToOne: false;
            referencedRelation: "journal_entries";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      source_postings: {
        Row: {
          created_at: string;
          digital_store_id: string | null;
          error_code: string | null;
          first_posted_at: string;
          id: string;
          idempotency_key: string;
          journal_entry_id: string | null;
          last_observed_at: string;
          posting_rule_key: string;
          posting_rule_version: string | null;
          source_hash: string | null;
          source_id: string;
          source_type: string;
          status: string;
          tenant_id: string;
        };
        Insert: {
          created_at?: string;
          digital_store_id?: string | null;
          error_code?: string | null;
          first_posted_at?: string;
          id?: string;
          idempotency_key: string;
          journal_entry_id?: string | null;
          last_observed_at?: string;
          posting_rule_key: string;
          posting_rule_version?: string | null;
          source_hash?: string | null;
          source_id: string;
          source_type: string;
          status?: string;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          digital_store_id?: string | null;
          error_code?: string | null;
          first_posted_at?: string;
          id?: string;
          idempotency_key?: string;
          journal_entry_id?: string | null;
          last_observed_at?: string;
          posting_rule_key?: string;
          posting_rule_version?: string | null;
          source_hash?: string | null;
          source_id?: string;
          source_type?: string;
          status?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "source_postings_journal_entry_id_fkey";
            columns: ["journal_entry_id"];
            isOneToOne: false;
            referencedRelation: "journal_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "source_postings_tenant_entry_fk";
            columns: ["tenant_id", "journal_entry_id"];
            isOneToOne: false;
            referencedRelation: "journal_entries";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      subledger_account_translations: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          locale: string;
          name: string;
          subledger_account_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          locale: string;
          name: string;
          subledger_account_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          locale?: string;
          name?: string;
          subledger_account_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "subledger_account_translations_subledger_account_id_fkey";
            columns: ["subledger_account_id"];
            isOneToOne: false;
            referencedRelation: "subledger_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      subledger_accounts: {
        Row: {
          account_class: string;
          account_code: string;
          created_at: string;
          digital_store_id: string | null;
          effective_from: string;
          effective_to: string | null;
          id: string;
          normal_side: string;
          status: string;
          tenant_id: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          account_class: string;
          account_code: string;
          created_at?: string;
          digital_store_id?: string | null;
          effective_from?: string;
          effective_to?: string | null;
          id?: string;
          normal_side: string;
          status?: string;
          tenant_id: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          account_class?: string;
          account_code?: string;
          created_at?: string;
          digital_store_id?: string | null;
          effective_from?: string;
          effective_to?: string | null;
          id?: string;
          normal_side?: string;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      post_journal_entry_v1: {
        Args: {
          p_actor_service_key: string;
          p_actor_user_id: string;
          p_business_date: string;
          p_correlation_id?: string;
          p_currency_code: string;
          p_description: string;
          p_digital_store_id: string;
          p_entry_type: string;
          p_idempotency_key: string;
          p_posting_rule_key: string;
          p_posting_rule_version: string;
          p_postings: Json;
          p_reason_code: string;
          p_reverses_journal_entry_id?: string;
          p_source_hash: string;
          p_source_id: string;
          p_source_type: string;
          p_store_location_id: string;
          p_tenant_id: string;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  kitluy_laundry: {
    Tables: {
      booking_production_state: {
        Row: {
          created_at: string;
          digital_store_id: string;
          order_id: string;
          production_status: string;
          store_location_id: string | null;
          tenant_id: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          digital_store_id: string;
          order_id: string;
          production_status?: string;
          store_location_id?: string | null;
          tenant_id: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          digital_store_id?: string;
          order_id?: string;
          production_status?: string;
          store_location_id?: string | null;
          tenant_id?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [];
      };
      booking_status_history: {
        Row: {
          actor_service_key: string | null;
          actor_user_id: string | null;
          aggregate_version: number;
          device_id: string | null;
          from_status: string | null;
          id: string;
          idempotency_key: string | null;
          occurred_at: string;
          order_id: string;
          reason_code: string | null;
          recorded_at: string;
          tenant_id: string;
          to_status: string;
        };
        Insert: {
          actor_service_key?: string | null;
          actor_user_id?: string | null;
          aggregate_version: number;
          device_id?: string | null;
          from_status?: string | null;
          id?: string;
          idempotency_key?: string | null;
          occurred_at?: string;
          order_id: string;
          reason_code?: string | null;
          recorded_at?: string;
          tenant_id: string;
          to_status: string;
        };
        Update: {
          actor_service_key?: string | null;
          actor_user_id?: string | null;
          aggregate_version?: number;
          device_id?: string | null;
          from_status?: string | null;
          id?: string;
          idempotency_key?: string | null;
          occurred_at?: string;
          order_id?: string;
          reason_code?: string | null;
          recorded_at?: string;
          tenant_id?: string;
          to_status?: string;
        };
        Relationships: [];
      };
      garment_exceptions: {
        Row: {
          approval_request_id: string | null;
          blocking: boolean;
          description: string;
          exception_type: string;
          garment_id: string | null;
          id: string;
          opened_at: string;
          opened_by: string | null;
          order_id: string;
          resolution_reason_code: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          severity: string | null;
          tenant_id: string;
        };
        Insert: {
          approval_request_id?: string | null;
          blocking?: boolean;
          description: string;
          exception_type: string;
          garment_id?: string | null;
          id?: string;
          opened_at?: string;
          opened_by?: string | null;
          order_id: string;
          resolution_reason_code?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          severity?: string | null;
          tenant_id: string;
        };
        Update: {
          approval_request_id?: string | null;
          blocking?: boolean;
          description?: string;
          exception_type?: string;
          garment_id?: string | null;
          id?: string;
          opened_at?: string;
          opened_by?: string | null;
          order_id?: string;
          resolution_reason_code?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          severity?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "garment_exceptions_same_order_garment_fk";
            columns: ["order_id", "garment_id"];
            isOneToOne: false;
            referencedRelation: "garments";
            referencedColumns: ["order_id", "id"];
          },
        ];
      };
      garment_scan_events: {
        Row: {
          actor_service_key: string | null;
          actor_user_id: string | null;
          aggregate_version: number;
          device_id: string | null;
          digital_store_id: string;
          from_state: string | null;
          garment_id: string | null;
          id: string;
          idempotency_key: string;
          metadata: Json | null;
          occurred_at: string;
          order_id: string;
          reason_code: string | null;
          recorded_at: string;
          scan_type: string;
          storage_position_id: string | null;
          store_location_id: string;
          tenant_id: string;
          terminal_role: string;
          to_state: string | null;
        };
        Insert: {
          actor_service_key?: string | null;
          actor_user_id?: string | null;
          aggregate_version: number;
          device_id?: string | null;
          digital_store_id: string;
          from_state?: string | null;
          garment_id?: string | null;
          id?: string;
          idempotency_key: string;
          metadata?: Json | null;
          occurred_at?: string;
          order_id: string;
          reason_code?: string | null;
          recorded_at?: string;
          scan_type: string;
          storage_position_id?: string | null;
          store_location_id: string;
          tenant_id: string;
          terminal_role: string;
          to_state?: string | null;
        };
        Update: {
          actor_service_key?: string | null;
          actor_user_id?: string | null;
          aggregate_version?: number;
          device_id?: string | null;
          digital_store_id?: string;
          from_state?: string | null;
          garment_id?: string | null;
          id?: string;
          idempotency_key?: string;
          metadata?: Json | null;
          occurred_at?: string;
          order_id?: string;
          reason_code?: string | null;
          recorded_at?: string;
          scan_type?: string;
          storage_position_id?: string | null;
          store_location_id?: string;
          tenant_id?: string;
          terminal_role?: string;
          to_state?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "garment_scan_events_same_order_garment_fk";
            columns: ["order_id", "garment_id"];
            isOneToOne: false;
            referencedRelation: "garments";
            referencedColumns: ["order_id", "id"];
          },
          {
            foreignKeyName: "garment_scan_events_storage_position_fk";
            columns: ["storage_position_id"];
            isOneToOne: false;
            referencedRelation: "ready_storage_positions";
            referencedColumns: ["id"];
          },
        ];
      };
      garments: {
        Row: {
          color: string | null;
          container_id: string | null;
          created_at: string;
          fabric: string | null;
          garment_type: string | null;
          id: string;
          intake_notes: string | null;
          order_id: string;
          piece_count: number | null;
          status: string;
          tag_code: string | null;
          tenant_id: string;
          unit_kind: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          color?: string | null;
          container_id?: string | null;
          created_at?: string;
          fabric?: string | null;
          garment_type?: string | null;
          id?: string;
          intake_notes?: string | null;
          order_id: string;
          piece_count?: number | null;
          status?: string;
          tag_code?: string | null;
          tenant_id: string;
          unit_kind: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          color?: string | null;
          container_id?: string | null;
          created_at?: string;
          fabric?: string | null;
          garment_type?: string | null;
          id?: string;
          intake_notes?: string | null;
          order_id?: string;
          piece_count?: number | null;
          status?: string;
          tag_code?: string | null;
          tenant_id?: string;
          unit_kind?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "garments_same_order_container_fk";
            columns: ["order_id", "container_id"];
            isOneToOne: false;
            referencedRelation: "garments";
            referencedColumns: ["order_id", "id"];
          },
        ];
      };
      laundry_tags: {
        Row: {
          garment_id: string | null;
          id: string;
          issued_at: string;
          issued_by: string | null;
          order_id: string;
          print_job_id: string | null;
          replacement_reason_code: string | null;
          replaces_tag_id: string | null;
          tag_code: string;
          template_version: string | null;
          tenant_id: string;
          voided_at: string | null;
          voided_by: string | null;
        };
        Insert: {
          garment_id?: string | null;
          id?: string;
          issued_at?: string;
          issued_by?: string | null;
          order_id: string;
          print_job_id?: string | null;
          replacement_reason_code?: string | null;
          replaces_tag_id?: string | null;
          tag_code: string;
          template_version?: string | null;
          tenant_id: string;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          garment_id?: string | null;
          id?: string;
          issued_at?: string;
          issued_by?: string | null;
          order_id?: string;
          print_job_id?: string | null;
          replacement_reason_code?: string | null;
          replaces_tag_id?: string | null;
          tag_code?: string;
          template_version?: string | null;
          tenant_id?: string;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "laundry_tags_replaces_tag_id_fkey";
            columns: ["replaces_tag_id"];
            isOneToOne: false;
            referencedRelation: "laundry_tags";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "laundry_tags_same_order_garment_fk";
            columns: ["order_id", "garment_id"];
            isOneToOne: false;
            referencedRelation: "garments";
            referencedColumns: ["order_id", "id"];
          },
        ];
      };
      pickup_handoffs: {
        Row: {
          approval_request_id: string | null;
          balance_settled: boolean;
          collector_reference: string | null;
          collector_verified: boolean;
          collector_verified_by: string | null;
          created_at: string;
          digital_store_id: string;
          exception_reason_code: string | null;
          handed_over_at: string | null;
          id: string;
          order_id: string;
          release_completeness_verified: boolean;
          released_by: string | null;
          released_device_id: string | null;
          status: string;
          store_location_id: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          approval_request_id?: string | null;
          balance_settled?: boolean;
          collector_reference?: string | null;
          collector_verified?: boolean;
          collector_verified_by?: string | null;
          created_at?: string;
          digital_store_id: string;
          exception_reason_code?: string | null;
          handed_over_at?: string | null;
          id?: string;
          order_id: string;
          release_completeness_verified?: boolean;
          released_by?: string | null;
          released_device_id?: string | null;
          status?: string;
          store_location_id: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          approval_request_id?: string | null;
          balance_settled?: boolean;
          collector_reference?: string | null;
          collector_verified?: boolean;
          collector_verified_by?: string | null;
          created_at?: string;
          digital_store_id?: string;
          exception_reason_code?: string | null;
          handed_over_at?: string | null;
          id?: string;
          order_id?: string;
          release_completeness_verified?: boolean;
          released_by?: string | null;
          released_device_id?: string | null;
          status?: string;
          store_location_id?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ready_storage_assignments: {
        Row: {
          assigned_at: string;
          assigned_by: string | null;
          assigned_device_id: string | null;
          clear_reason_code: string | null;
          cleared_at: string | null;
          cleared_by: string | null;
          cleared_device_id: string | null;
          garment_id: string | null;
          id: string;
          order_id: string;
          position_id: string;
          tenant_id: string;
        };
        Insert: {
          assigned_at?: string;
          assigned_by?: string | null;
          assigned_device_id?: string | null;
          clear_reason_code?: string | null;
          cleared_at?: string | null;
          cleared_by?: string | null;
          cleared_device_id?: string | null;
          garment_id?: string | null;
          id?: string;
          order_id: string;
          position_id: string;
          tenant_id: string;
        };
        Update: {
          assigned_at?: string;
          assigned_by?: string | null;
          assigned_device_id?: string | null;
          clear_reason_code?: string | null;
          cleared_at?: string | null;
          cleared_by?: string | null;
          cleared_device_id?: string | null;
          garment_id?: string | null;
          id?: string;
          order_id?: string;
          position_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ready_storage_assignments_position_id_fkey";
            columns: ["position_id"];
            isOneToOne: false;
            referencedRelation: "ready_storage_positions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ready_storage_assignments_same_order_garment_fk";
            columns: ["order_id", "garment_id"];
            isOneToOne: false;
            referencedRelation: "garments";
            referencedColumns: ["order_id", "id"];
          },
        ];
      };
      ready_storage_positions: {
        Row: {
          created_at: string;
          digital_store_id: string;
          id: string;
          position_code: string;
          position_type: string | null;
          status: string;
          store_location_id: string;
          tenant_id: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          digital_store_id: string;
          id?: string;
          position_code: string;
          position_type?: string | null;
          status?: string;
          store_location_id: string;
          tenant_id: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          created_at?: string;
          digital_store_id?: string;
          id?: string;
          position_code?: string;
          position_type?: string | null;
          status?: string;
          store_location_id?: string;
          tenant_id?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [];
      };
      service_addons: {
        Row: {
          addon_code: string;
          created_at: string;
          digital_store_id: string;
          id: string;
          name: string;
          pricing_mode: string;
          service_id: string;
          status: string;
          tenant_id: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          addon_code: string;
          created_at?: string;
          digital_store_id: string;
          id?: string;
          name: string;
          pricing_mode: string;
          service_id: string;
          status?: string;
          tenant_id: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          addon_code?: string;
          created_at?: string;
          digital_store_id?: string;
          id?: string;
          name?: string;
          pricing_mode?: string;
          service_id?: string;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "service_addons_service_id_fkey";
            columns: ["service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
        ];
      };
      service_prices: {
        Row: {
          created_at: string;
          created_by: string | null;
          currency_code: string;
          digital_store_id: string;
          effective_from: string;
          effective_to: string | null;
          id: string;
          min_charge_minor: number | null;
          pricing_mode: string;
          service_id: string;
          store_location_id: string | null;
          tenant_id: string;
          unit_price_minor: number;
          version: number;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          currency_code: string;
          digital_store_id: string;
          effective_from: string;
          effective_to?: string | null;
          id?: string;
          min_charge_minor?: number | null;
          pricing_mode: string;
          service_id: string;
          store_location_id?: string | null;
          tenant_id: string;
          unit_price_minor: number;
          version?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          currency_code?: string;
          digital_store_id?: string;
          effective_from?: string;
          effective_to?: string | null;
          id?: string;
          min_charge_minor?: number | null;
          pricing_mode?: string;
          service_id?: string;
          store_location_id?: string | null;
          tenant_id?: string;
          unit_price_minor?: number;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "service_prices_service_id_fkey";
            columns: ["service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
        ];
      };
      services: {
        Row: {
          catalog_item_id: string;
          created_at: string;
          digital_store_id: string;
          id: string;
          pricing_modes: string[];
          production_profile: string | null;
          service_code: string;
          status: string;
          tenant_id: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          catalog_item_id: string;
          created_at?: string;
          digital_store_id: string;
          id?: string;
          pricing_modes: string[];
          production_profile?: string | null;
          service_code: string;
          status?: string;
          tenant_id: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          catalog_item_id?: string;
          created_at?: string;
          digital_store_id?: string;
          id?: string;
          pricing_modes?: string[];
          production_profile?: string | null;
          service_code?: string;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  kitluy_orders: {
    Tables: {
      order_adjustments: {
        Row: {
          adjustment_type: string;
          amount_minor: number;
          approval_request_id: string | null;
          created_at: string;
          created_by: string | null;
          currency_code: string;
          id: string;
          line_id: string | null;
          order_id: string;
          reason_code: string;
          source_ref: string | null;
          tenant_id: string;
        };
        Insert: {
          adjustment_type: string;
          amount_minor: number;
          approval_request_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency_code: string;
          id?: string;
          line_id?: string | null;
          order_id: string;
          reason_code: string;
          source_ref?: string | null;
          tenant_id: string;
        };
        Update: {
          adjustment_type?: string;
          amount_minor?: number;
          approval_request_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency_code?: string;
          id?: string;
          line_id?: string | null;
          order_id?: string;
          reason_code?: string;
          source_ref?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_adjustments_line_id_fkey";
            columns: ["line_id"];
            isOneToOne: false;
            referencedRelation: "order_lines";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_adjustments_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_adjustments_tenant_order_fk";
            columns: ["tenant_id", "order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      order_events: {
        Row: {
          actor_service_key: string | null;
          actor_user_id: string | null;
          device_id: string | null;
          event_type: string;
          from_status: string | null;
          from_version: number | null;
          id: string;
          idempotency_key: string | null;
          metadata: Json | null;
          occurred_at: string;
          order_id: string;
          reason_code: string | null;
          recorded_at: string;
          tenant_id: string;
          to_status: string | null;
          to_version: number | null;
        };
        Insert: {
          actor_service_key?: string | null;
          actor_user_id?: string | null;
          device_id?: string | null;
          event_type: string;
          from_status?: string | null;
          from_version?: number | null;
          id?: string;
          idempotency_key?: string | null;
          metadata?: Json | null;
          occurred_at?: string;
          order_id: string;
          reason_code?: string | null;
          recorded_at?: string;
          tenant_id: string;
          to_status?: string | null;
          to_version?: number | null;
        };
        Update: {
          actor_service_key?: string | null;
          actor_user_id?: string | null;
          device_id?: string | null;
          event_type?: string;
          from_status?: string | null;
          from_version?: number | null;
          id?: string;
          idempotency_key?: string | null;
          metadata?: Json | null;
          occurred_at?: string;
          order_id?: string;
          reason_code?: string | null;
          recorded_at?: string;
          tenant_id?: string;
          to_status?: string | null;
          to_version?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "order_events_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_events_tenant_order_fk";
            columns: ["tenant_id", "order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      order_lines: {
        Row: {
          catalog_item_id: string;
          created_at: string;
          currency_code: string;
          digital_store_id: string;
          discount_minor: number;
          id: string;
          line_no: number;
          order_id: string;
          price_version: number | null;
          pricing_mode: string;
          quantity: number | null;
          service_code: string;
          subtotal_minor: number;
          tax_minor: number;
          tenant_id: string;
          total_minor: number;
          unit_price_minor: number;
          weight_grams: number | null;
          weight_rounding_rule: string | null;
        };
        Insert: {
          catalog_item_id: string;
          created_at?: string;
          currency_code: string;
          digital_store_id: string;
          discount_minor?: number;
          id?: string;
          line_no: number;
          order_id: string;
          price_version?: number | null;
          pricing_mode: string;
          quantity?: number | null;
          service_code: string;
          subtotal_minor?: number;
          tax_minor?: number;
          tenant_id: string;
          total_minor?: number;
          unit_price_minor: number;
          weight_grams?: number | null;
          weight_rounding_rule?: string | null;
        };
        Update: {
          catalog_item_id?: string;
          created_at?: string;
          currency_code?: string;
          digital_store_id?: string;
          discount_minor?: number;
          id?: string;
          line_no?: number;
          order_id?: string;
          price_version?: number | null;
          pricing_mode?: string;
          quantity?: number | null;
          service_code?: string;
          subtotal_minor?: number;
          tax_minor?: number;
          tenant_id?: string;
          total_minor?: number;
          unit_price_minor?: number;
          weight_grams?: number | null;
          weight_rounding_rule?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "order_lines_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_lines_store_order_fk";
            columns: ["digital_store_id", "order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["digital_store_id", "id"];
          },
          {
            foreignKeyName: "order_lines_tenant_order_fk";
            columns: ["tenant_id", "order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      order_notes: {
        Row: {
          body: string;
          created_at: string;
          created_by: string | null;
          id: string;
          note_type: string;
          order_id: string;
          tenant_id: string;
          visibility: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          note_type: string;
          order_id: string;
          tenant_id: string;
          visibility?: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          note_type?: string;
          order_id?: string;
          tenant_id?: string;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_notes_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_notes_tenant_order_fk";
            columns: ["tenant_id", "order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      orders: {
        Row: {
          created_at: string;
          created_by: string | null;
          currency_code: string;
          customer_id: string | null;
          digital_store_id: string;
          discount_minor: number;
          due_at: string | null;
          id: string;
          idempotency_key: string;
          intake_verified_at: string | null;
          intake_verified_by: string | null;
          order_number: string;
          payment_state: string;
          pre_intake_reference: string | null;
          required_deposit_minor: number | null;
          source_code: string;
          status: string;
          store_location_id: string | null;
          subtotal_minor: number;
          tax_minor: number;
          tenant_id: string;
          total_minor: number;
          updated_at: string;
          version: number;
          vertical_code: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          currency_code: string;
          customer_id?: string | null;
          digital_store_id: string;
          discount_minor?: number;
          due_at?: string | null;
          id?: string;
          idempotency_key: string;
          intake_verified_at?: string | null;
          intake_verified_by?: string | null;
          order_number: string;
          payment_state?: string;
          pre_intake_reference?: string | null;
          required_deposit_minor?: number | null;
          source_code: string;
          status?: string;
          store_location_id?: string | null;
          subtotal_minor?: number;
          tax_minor?: number;
          tenant_id: string;
          total_minor?: number;
          updated_at?: string;
          version?: number;
          vertical_code: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          currency_code?: string;
          customer_id?: string | null;
          digital_store_id?: string;
          discount_minor?: number;
          due_at?: string | null;
          id?: string;
          idempotency_key?: string;
          intake_verified_at?: string | null;
          intake_verified_by?: string | null;
          order_number?: string;
          payment_state?: string;
          pre_intake_reference?: string | null;
          required_deposit_minor?: number | null;
          source_code?: string;
          status?: string;
          store_location_id?: string | null;
          subtotal_minor?: number;
          tax_minor?: number;
          tenant_id?: string;
          total_minor?: number;
          updated_at?: string;
          version?: number;
          vertical_code?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  kitluy_payments: {
    Tables: {
      khqr_transactions: {
        Row: {
          amount_minor: number;
          confirmed_at: string | null;
          created_at: string;
          currency_code: string;
          expires_at: string | null;
          id: string;
          merchant_ref: string;
          provider_transaction_id: string | null;
          qr_payload_hash: string;
          status: string;
          tenant_id: string;
          tender_id: string;
          updated_at: string;
        };
        Insert: {
          amount_minor: number;
          confirmed_at?: string | null;
          created_at?: string;
          currency_code: string;
          expires_at?: string | null;
          id?: string;
          merchant_ref: string;
          provider_transaction_id?: string | null;
          qr_payload_hash: string;
          status?: string;
          tenant_id: string;
          tender_id: string;
          updated_at?: string;
        };
        Update: {
          amount_minor?: number;
          confirmed_at?: string | null;
          created_at?: string;
          currency_code?: string;
          expires_at?: string | null;
          id?: string;
          merchant_ref?: string;
          provider_transaction_id?: string | null;
          qr_payload_hash?: string;
          status?: string;
          tenant_id?: string;
          tender_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "khqr_transactions_tenant_tender_fk";
            columns: ["tenant_id", "tender_id"];
            isOneToOne: false;
            referencedRelation: "tenders";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "khqr_transactions_tender_id_fkey";
            columns: ["tender_id"];
            isOneToOne: false;
            referencedRelation: "tenders";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_attempts: {
        Row: {
          attempted_at: string;
          client_result: string | null;
          error_code: string | null;
          id: string;
          provider_attempt_ref: string | null;
          provider_key: string;
          request_hash: string | null;
          status: string;
          tenant_id: string;
          tender_id: string;
          updated_at: string;
        };
        Insert: {
          attempted_at?: string;
          client_result?: string | null;
          error_code?: string | null;
          id?: string;
          provider_attempt_ref?: string | null;
          provider_key: string;
          request_hash?: string | null;
          status?: string;
          tenant_id: string;
          tender_id: string;
          updated_at?: string;
        };
        Update: {
          attempted_at?: string;
          client_result?: string | null;
          error_code?: string | null;
          id?: string;
          provider_attempt_ref?: string | null;
          provider_key?: string;
          request_hash?: string | null;
          status?: string;
          tenant_id?: string;
          tender_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_attempts_tenant_tender_fk";
            columns: ["tenant_id", "tender_id"];
            isOneToOne: false;
            referencedRelation: "tenders";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "payment_attempts_tender_id_fkey";
            columns: ["tender_id"];
            isOneToOne: false;
            referencedRelation: "tenders";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_provider_events: {
        Row: {
          id: string;
          payload_hash: string;
          processed_at: string | null;
          provider_event_id: string;
          provider_key: string;
          provider_transaction_id: string | null;
          received_at: string;
          reported_amount_minor: number | null;
          reported_currency_code: string | null;
          signature_valid: boolean;
          status: string;
          tenant_id: string | null;
          tender_id: string | null;
          variance_minor: number | null;
        };
        Insert: {
          id?: string;
          payload_hash: string;
          processed_at?: string | null;
          provider_event_id: string;
          provider_key: string;
          provider_transaction_id?: string | null;
          received_at?: string;
          reported_amount_minor?: number | null;
          reported_currency_code?: string | null;
          signature_valid: boolean;
          status: string;
          tenant_id?: string | null;
          tender_id?: string | null;
          variance_minor?: number | null;
        };
        Update: {
          id?: string;
          payload_hash?: string;
          processed_at?: string | null;
          provider_event_id?: string;
          provider_key?: string;
          provider_transaction_id?: string | null;
          received_at?: string;
          reported_amount_minor?: number | null;
          reported_currency_code?: string | null;
          signature_valid?: boolean;
          status?: string;
          tenant_id?: string | null;
          tender_id?: string | null;
          variance_minor?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "payment_provider_events_tender_id_fkey";
            columns: ["tender_id"];
            isOneToOne: false;
            referencedRelation: "tenders";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_reconciliation_lines: {
        Row: {
          actual_minor: number | null;
          created_at: string;
          currency_code: string;
          difference_minor: number | null;
          difference_reason_code: string | null;
          expected_minor: number;
          id: string;
          provider_transaction_ref: string | null;
          reconciliation_id: string;
          resolution_ref: string | null;
          resolved_at: string | null;
          review_actor: string | null;
          review_status: string | null;
          status: string;
          tenant_id: string;
          tender_id: string | null;
          updated_at: string;
        };
        Insert: {
          actual_minor?: number | null;
          created_at?: string;
          currency_code: string;
          difference_minor?: number | null;
          difference_reason_code?: string | null;
          expected_minor: number;
          id?: string;
          provider_transaction_ref?: string | null;
          reconciliation_id: string;
          resolution_ref?: string | null;
          resolved_at?: string | null;
          review_actor?: string | null;
          review_status?: string | null;
          status: string;
          tenant_id: string;
          tender_id?: string | null;
          updated_at?: string;
        };
        Update: {
          actual_minor?: number | null;
          created_at?: string;
          currency_code?: string;
          difference_minor?: number | null;
          difference_reason_code?: string | null;
          expected_minor?: number;
          id?: string;
          provider_transaction_ref?: string | null;
          reconciliation_id?: string;
          resolution_ref?: string | null;
          resolved_at?: string | null;
          review_actor?: string | null;
          review_status?: string | null;
          status?: string;
          tenant_id?: string;
          tender_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_reconciliation_lines_reconciliation_id_fkey";
            columns: ["reconciliation_id"];
            isOneToOne: false;
            referencedRelation: "payment_reconciliations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_reconciliation_lines_tenant_recon_fk";
            columns: ["tenant_id", "reconciliation_id"];
            isOneToOne: false;
            referencedRelation: "payment_reconciliations";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "payment_reconciliation_lines_tenant_tender_fk";
            columns: ["tenant_id", "tender_id"];
            isOneToOne: false;
            referencedRelation: "tenders";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "payment_reconciliation_lines_tender_id_fkey";
            columns: ["tender_id"];
            isOneToOne: false;
            referencedRelation: "tenders";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_reconciliations: {
        Row: {
          completed_at: string | null;
          created_at: string;
          currency_code: string;
          digital_store_id: string | null;
          id: string;
          period_end: string;
          period_start: string;
          provider_key: string;
          reopen_reason_code: string | null;
          reviewed_by: string | null;
          scope: string;
          source_as_of: string | null;
          status: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          currency_code: string;
          digital_store_id?: string | null;
          id?: string;
          period_end: string;
          period_start: string;
          provider_key: string;
          reopen_reason_code?: string | null;
          reviewed_by?: string | null;
          scope: string;
          source_as_of?: string | null;
          status?: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          currency_code?: string;
          digital_store_id?: string | null;
          id?: string;
          period_end?: string;
          period_start?: string;
          provider_key?: string;
          reopen_reason_code?: string | null;
          reviewed_by?: string | null;
          scope?: string;
          source_as_of?: string | null;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      payment_status_history: {
        Row: {
          actor_service_key: string | null;
          actor_user_id: string | null;
          from_status: string | null;
          id: string;
          occurred_at: string;
          reason_code: string | null;
          recorded_at: string;
          tenant_id: string;
          tender_id: string;
          to_status: string;
        };
        Insert: {
          actor_service_key?: string | null;
          actor_user_id?: string | null;
          from_status?: string | null;
          id?: string;
          occurred_at?: string;
          reason_code?: string | null;
          recorded_at?: string;
          tenant_id: string;
          tender_id: string;
          to_status: string;
        };
        Update: {
          actor_service_key?: string | null;
          actor_user_id?: string | null;
          from_status?: string | null;
          id?: string;
          occurred_at?: string;
          reason_code?: string | null;
          recorded_at?: string;
          tenant_id?: string;
          tender_id?: string;
          to_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_status_history_tenant_tender_fk";
            columns: ["tenant_id", "tender_id"];
            isOneToOne: false;
            referencedRelation: "tenders";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "payment_status_history_tender_id_fkey";
            columns: ["tender_id"];
            isOneToOne: false;
            referencedRelation: "tenders";
            referencedColumns: ["id"];
          },
        ];
      };
      refunds: {
        Row: {
          amount_minor: number;
          approval_request_id: string | null;
          approved_at: string | null;
          approved_by: string | null;
          completed_at: string | null;
          currency_code: string;
          digital_store_id: string;
          id: string;
          idempotency_key: string;
          order_id: string;
          reason_code: string;
          requested_at: string;
          requested_by: string;
          status: string;
          tenant_id: string;
          tender_id: string;
          updated_at: string;
        };
        Insert: {
          amount_minor: number;
          approval_request_id?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          completed_at?: string | null;
          currency_code: string;
          digital_store_id: string;
          id?: string;
          idempotency_key: string;
          order_id: string;
          reason_code: string;
          requested_at?: string;
          requested_by: string;
          status?: string;
          tenant_id: string;
          tender_id: string;
          updated_at?: string;
        };
        Update: {
          amount_minor?: number;
          approval_request_id?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          completed_at?: string | null;
          currency_code?: string;
          digital_store_id?: string;
          id?: string;
          idempotency_key?: string;
          order_id?: string;
          reason_code?: string;
          requested_at?: string;
          requested_by?: string;
          status?: string;
          tenant_id?: string;
          tender_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "refunds_tenant_tender_fk";
            columns: ["tenant_id", "tender_id"];
            isOneToOne: false;
            referencedRelation: "tenders";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "refunds_tender_id_fkey";
            columns: ["tender_id"];
            isOneToOne: false;
            referencedRelation: "tenders";
            referencedColumns: ["id"];
          },
        ];
      };
      settlement_refs: {
        Row: {
          created_at: string;
          currency_code: string;
          fee_minor: number | null;
          id: string;
          net_minor: number | null;
          provider_key: string;
          reconciliation_status: string;
          settled_amount_minor: number;
          settled_at: string | null;
          settlement_id: string;
          tenant_id: string;
          tender_id: string;
        };
        Insert: {
          created_at?: string;
          currency_code: string;
          fee_minor?: number | null;
          id?: string;
          net_minor?: number | null;
          provider_key: string;
          reconciliation_status: string;
          settled_amount_minor: number;
          settled_at?: string | null;
          settlement_id: string;
          tenant_id: string;
          tender_id: string;
        };
        Update: {
          created_at?: string;
          currency_code?: string;
          fee_minor?: number | null;
          id?: string;
          net_minor?: number | null;
          provider_key?: string;
          reconciliation_status?: string;
          settled_amount_minor?: number;
          settled_at?: string | null;
          settlement_id?: string;
          tenant_id?: string;
          tender_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "settlement_refs_tenant_tender_fk";
            columns: ["tenant_id", "tender_id"];
            isOneToOne: false;
            referencedRelation: "tenders";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "settlement_refs_tender_id_fkey";
            columns: ["tender_id"];
            isOneToOne: false;
            referencedRelation: "tenders";
            referencedColumns: ["id"];
          },
        ];
      };
      tenders: {
        Row: {
          amount_minor: number;
          applied_minor: number | null;
          captured_at: string | null;
          change_due_minor: number | null;
          created_at: string;
          created_by: string | null;
          currency_code: string;
          digital_store_id: string;
          id: string;
          idempotency_key: string;
          method_code: string;
          order_id: string;
          provider_key: string | null;
          shift_id: string | null;
          status: string;
          store_location_id: string | null;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          amount_minor: number;
          applied_minor?: number | null;
          captured_at?: string | null;
          change_due_minor?: number | null;
          created_at?: string;
          created_by?: string | null;
          currency_code: string;
          digital_store_id: string;
          id?: string;
          idempotency_key: string;
          method_code: string;
          order_id: string;
          provider_key?: string | null;
          shift_id?: string | null;
          status?: string;
          store_location_id?: string | null;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          amount_minor?: number;
          applied_minor?: number | null;
          captured_at?: string | null;
          change_due_minor?: number | null;
          created_at?: string;
          created_by?: string | null;
          currency_code?: string;
          digital_store_id?: string;
          id?: string;
          idempotency_key?: string;
          method_code?: string;
          order_id?: string;
          provider_key?: string | null;
          shift_id?: string | null;
          status?: string;
          store_location_id?: string | null;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      voids: {
        Row: {
          amount_minor: number | null;
          approval_request_id: string | null;
          currency_code: string | null;
          decision: string;
          id: string;
          occurred_at: string;
          order_id: string | null;
          reason_code: string;
          requested_by: string;
          required_action: string | null;
          tenant_id: string;
          tender_id: string | null;
          void_type: string;
        };
        Insert: {
          amount_minor?: number | null;
          approval_request_id?: string | null;
          currency_code?: string | null;
          decision: string;
          id?: string;
          occurred_at?: string;
          order_id?: string | null;
          reason_code: string;
          requested_by: string;
          required_action?: string | null;
          tenant_id: string;
          tender_id?: string | null;
          void_type: string;
        };
        Update: {
          amount_minor?: number | null;
          approval_request_id?: string | null;
          currency_code?: string | null;
          decision?: string;
          id?: string;
          occurred_at?: string;
          order_id?: string | null;
          reason_code?: string;
          requested_by?: string;
          required_action?: string | null;
          tenant_id?: string;
          tender_id?: string | null;
          void_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "voids_tenant_tender_fk";
            columns: ["tenant_id", "tender_id"];
            isOneToOne: false;
            referencedRelation: "tenders";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "voids_tender_id_fkey";
            columns: ["tender_id"];
            isOneToOne: false;
            referencedRelation: "tenders";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  kitluy_admin: {
    Enums: {},
  },
  kitluy_audit: {
    Enums: {},
  },
  kitluy_auth: {
    Enums: {},
  },
  kitluy_core: {
    Enums: {},
  },
  kitluy_finance: {
    Enums: {},
  },
  kitluy_laundry: {
    Enums: {},
  },
  kitluy_orders: {
    Enums: {},
  },
  kitluy_payments: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
