# Supabase environment configuration

Separate Supabase projects (hard isolation) per environment: development,
staging, production (+ pilot policy) — infra spec §4.2. All project references
are [REQUIRED] owner values recorded in the open-decisions register.
Production service-role credentials never appear in local or dev clients.
