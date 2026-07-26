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
  public: {
    Enums: {},
  },
} as const;
