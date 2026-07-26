-- =====================================================================
-- KitLuy Suite — Vertical + Franchise + Menu Migration
-- Version:  v1.0.0
-- Filename: kitluy-vertical-franchise-migration-sql-v1.0.0.sql
-- Owner:    Het Sovannara, HET Digital Ecosystem
-- Source:   kitluy-suite-rebuild-bible-md-v1.1.0.md
-- Purpose:  Unblock BOTH laundry + café go-live on one platform
--           (deployment shape: different stores, different verticals).
--
--   Section 1 — menu.* schema           (resolves R-4: menu.items is the item home)
--   Section 2 — pos.stores.vertical_type (resolves R-6: the vertical routing keystone)
--   Section 3 — cp.franchise_agreements  (resolves R-5: franchise layer, v1.1.0)
--   Section 4 — cafe.* FK reconciliation (resolves R-2/R-3: point FKs at real targets)
--
-- POLICY (project §7.1): Claude WRITES migrations; the BE team APPLIES them.
--                        This file is NOT to be auto-applied.
--
-- DEPENDENCY ORDER (apply prerequisites first):
--   001 trading core (cp, fin, core, inv, sal, pos, pur, tax) — required
--   cafe_schema_init (creates cafe.* tables)                  — required for Section 4
--   THEN this migration.
--
-- All money: numeric(18,4) USD-primary STORAGE; KHR-integer DISPLAY (R-1).
--   *_khr integer columns are DERIVED from numeric at write time via formatKHR()
--   in the edge layer — they are not the source of truth, the numeric is.
-- =====================================================================

begin;

-- =====================================================================
-- SECTION 1 — menu.* SCHEMA  (R-4: item/category/modifier home)
-- Café cart lines reference menu.items (NOT inv.items). inv.* remains
-- the stock/ingredient layer; menu.* is the sellable-catalog layer.
-- =====================================================================

create schema if not exists menu;
comment on schema menu is 'Sellable catalog (categories, items, modifiers). R-4: item home for POS cart lines. Distinct from inv.* (stock).';

-- ---- menu.categories ------------------------------------------------
create table if not exists menu.categories (
    category_id     uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null,            -- → cp.tenants(id)
    store_id        uuid not null,            -- → pos.stores(store_id)
    name_en         text not null,
    name_km         text,                     -- Khmer (allow +40% width in UI)
    display_order   integer not null default 0,
    is_active       boolean not null default true,
    metadata        jsonb not null default '{}',
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
comment on table menu.categories is 'Menu categories per store. Drives T1 category grid + T3 station routing (cafe.t3_assignments.category_id).';

-- ---- menu.items -----------------------------------------------------
-- This is the canonical sellable item. pos.cart_lines.item_id → here.
create table if not exists menu.items (
    item_id             uuid primary key default gen_random_uuid(),
    tenant_id           uuid not null,        -- → cp.tenants(id)
    store_id            uuid not null,        -- → pos.stores(store_id)
    category_id         uuid not null references menu.categories(category_id) on delete restrict,
    sku                 text,                 -- optional; used by retail vertical
    name_en             text not null,
    name_km             text,
    -- MONEY (R-1): numeric is the source of truth; _khr is derived display.
    base_price          numeric(18,4) not null default 0,   -- in store primary currency (USD default)
    base_price_khr      integer not null default 0,         -- DERIVED KHR-integer (display)
    is_available        boolean not null default true,      -- 86 toggle target (T3)
    track_inventory     boolean not null default false,     -- café drinks = true (recipe deducts)
    display_order       integer not null default 0,
    metadata            jsonb not null default '{}',
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    unique (store_id, sku)
);
comment on table menu.items is 'Canonical sellable item. R-4: pos.cart_lines.item_id and cafe.recipes.item_id reference this. base_price (numeric) is truth; base_price_khr is derived display (R-1).';
comment on column menu.items.base_price is 'Source-of-truth price in store primary currency, numeric(18,4) (R-1).';
comment on column menu.items.base_price_khr is 'DERIVED KHR-integer for display; written via formatKHR(base_price, rate). Never edited directly.';

create index if not exists idx_menu_items_store on menu.items(store_id);
create index if not exists idx_menu_items_category on menu.items(category_id);

-- ---- menu.modifier_groups -------------------------------------------
create table if not exists menu.modifier_groups (
    group_id        uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null,
    store_id        uuid not null,
    name_en         text not null,
    name_km         text,
    selection_rule  text not null default 'optional_many'
        check (selection_rule in ('required_one','optional_one','optional_many')),
    min_select      integer not null default 0,
    max_select      integer,
    display_order   integer not null default 0,
    is_active       boolean not null default true,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
comment on table menu.modifier_groups is 'Modifier groups (Size, Sugar, Ice, Toppings). selection_rule governs pick-one vs pick-many.';

-- ---- menu.modifiers -------------------------------------------------
create table if not exists menu.modifiers (
    modifier_id     uuid primary key default gen_random_uuid(),
    group_id        uuid not null references menu.modifier_groups(group_id) on delete cascade,
    name_en         text not null,
    name_km         text,
    upcharge        numeric(18,4) not null default 0,   -- source of truth
    upcharge_khr    integer not null default 0,         -- DERIVED display (R-1)
    is_available    boolean not null default true,
    display_order   integer not null default 0,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
comment on table menu.modifiers is 'Individual modifier options. upcharge (numeric) is truth; upcharge_khr is derived display (R-1).';

-- ---- menu.item_modifier_group_links ---------------------------------
create table if not exists menu.item_modifier_group_links (
    item_id         uuid not null references menu.items(item_id) on delete cascade,
    group_id        uuid not null references menu.modifier_groups(group_id) on delete cascade,
    display_order   integer not null default 0,
    primary key (item_id, group_id)
);
comment on table menu.item_modifier_group_links is 'Which modifier groups attach to which item.';

-- ---- RLS for menu.* (tenant-scoped, matches bible §6.4 pattern) -----
alter table menu.categories                enable row level security;
alter table menu.items                     enable row level security;
alter table menu.modifier_groups           enable row level security;
alter table menu.modifiers                 enable row level security;
alter table menu.item_modifier_group_links enable row level security;

drop policy if exists menu_categories_tenant_isolation on menu.categories;
create policy menu_categories_tenant_isolation on menu.categories
    for all
    using      (core.is_service_role() or tenant_id = core.current_tenant_id())
    with check (core.is_service_role() or tenant_id = core.current_tenant_id());

drop policy if exists menu_items_tenant_isolation on menu.items;
create policy menu_items_tenant_isolation on menu.items
    for all
    using      (core.is_service_role() or tenant_id = core.current_tenant_id())
    with check (core.is_service_role() or tenant_id = core.current_tenant_id());

drop policy if exists menu_modifier_groups_tenant_isolation on menu.modifier_groups;
create policy menu_modifier_groups_tenant_isolation on menu.modifier_groups
    for all
    using      (core.is_service_role() or tenant_id = core.current_tenant_id())
    with check (core.is_service_role() or tenant_id = core.current_tenant_id());

-- modifiers + links inherit scope via their parent group; service role + parent tenant.
drop policy if exists menu_modifiers_tenant_isolation on menu.modifiers;
create policy menu_modifiers_tenant_isolation on menu.modifiers
    for all
    using (core.is_service_role() or group_id in (
        select group_id from menu.modifier_groups
        where tenant_id = core.current_tenant_id()
    ))
    with check (core.is_service_role() or group_id in (
        select group_id from menu.modifier_groups
        where tenant_id = core.current_tenant_id()
    ));

drop policy if exists menu_item_links_tenant_isolation on menu.item_modifier_group_links;
create policy menu_item_links_tenant_isolation on menu.item_modifier_group_links
    for all
    using (core.is_service_role() or item_id in (
        select item_id from menu.items where tenant_id = core.current_tenant_id()
    ))
    with check (core.is_service_role() or item_id in (
        select item_id from menu.items where tenant_id = core.current_tenant_id()
    ));


-- =====================================================================
-- SECTION 2 — pos.stores.vertical_type  (R-6: THE ROUTING KEYSTONE)
-- "Different stores, different verticals, one platform."
-- The POS shell reads this at boot to load the matching vertical bundle.
-- IMMUTABLE after insert — this is what ENFORCES "1 store = 1 vertical".
-- =====================================================================

-- 2.1 — enum type
do $$
begin
    if not exists (select 1 from pg_type where typname = 'vertical_type') then
        create type pos.vertical_type as enum ('laundry','cafe','restaurant','retail');
    end if;
end$$;

-- 2.2 — add the column (nullable first so existing rows don't break, then enforce)
alter table pos.stores
    add column if not exists vertical_type pos.vertical_type;

-- 2.3 — backfill guidance:
--   Existing stores MUST be assigned a vertical before NOT NULL is enforced.
--   The BE team runs (example):
--     update pos.stores set vertical_type = 'laundry' where store_code like 'LD-%';
--     update pos.stores set vertical_type = 'cafe'    where store_code like 'CF-%';
--   AFTER backfill, enforce NOT NULL:
--     alter table pos.stores alter column vertical_type set not null;
-- (Left as a documented manual step because we cannot know existing store mappings here.)

comment on column pos.stores.vertical_type is 'R-6 keystone. IMMUTABLE industry of the store (laundry/cafe/restaurant/retail). Read at POS boot to load the vertical bundle. Enforces 1 store = 1 vertical.';

-- 2.4 — IMMUTABILITY TRIGGER: reject any UPDATE that changes vertical_type.
--   This is the real enforcement of "1 store = 1 vertical". Without it the
--   column is just a label. A store's industry is fixed at provisioning.
create or replace function pos.enforce_vertical_type_immutable()
returns trigger
language plpgsql
as $$
begin
    if tg_op = 'UPDATE'
       and old.vertical_type is not null
       and new.vertical_type is distinct from old.vertical_type then
        raise exception
            'vertical_type is immutable (store %): cannot change from % to %. 1 store = 1 vertical; provision a new store instead.',
            old.store_id, old.vertical_type, new.vertical_type
            using errcode = 'check_violation';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_vertical_type_immutable on pos.stores;
create trigger trg_vertical_type_immutable
    before update on pos.stores
    for each row
    execute function pos.enforce_vertical_type_immutable();

comment on function pos.enforce_vertical_type_immutable() is 'R-6: blocks any UPDATE changing pos.stores.vertical_type. Enforces 1 store = 1 vertical at the DB layer.';


-- =====================================================================
-- SECTION 3 — cp.franchise_agreements  (R-5, RESOLVED v1.1.0)
-- Matches kitluy-suite-rebuild-bible-md-v1.1.0.md §6.2.1 exactly.
-- Single-owner chains do NOT have rows here (tenants.billing_mode='direct').
-- =====================================================================

-- 3.1 — align cp.tenants.billing_mode CHECK to the resolved 3 values.
--   Old (v1.0.0): ('direct','franchise'). New (v1.1.0): direct/brand_consolidated/franchisee_direct.
do $$
declare
    conname text;
begin
    select c.conname into conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'cp' and t.relname = 'tenants'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%billing_mode%';
    if conname is not null then
        execute format('alter table cp.tenants drop constraint %I', conname);
    end if;
end$$;

alter table cp.tenants
    add constraint tenants_billing_mode_check
    check (billing_mode in ('direct','brand_consolidated','franchisee_direct'));

comment on column cp.tenants.billing_mode is 'R-5 RESOLVED v1.1.0: direct | brand_consolidated | franchisee_direct. Subscription payer derived from this (subscription-payer-resolve). Franchise detail in cp.franchise_agreements.';

-- 3.2 — the franchise agreement table
create table if not exists cp.franchise_agreements (
    id                    uuid primary key default gen_random_uuid(),
    brand_tenant_id       uuid not null references cp.tenants(id) on delete cascade,
    franchisee_company_id uuid not null references fin.companies(id) on delete restrict,
    billing_mode          text not null
        check (billing_mode in ('brand_consolidated','franchisee_direct')),  -- 'direct' invalid here by definition
    royalty_pct           numeric(5,2),                 -- optional flat royalty; null = none
    menu_push_rights      text not null default 'approve'
        check (menu_push_rights in ('full','approve','none')),
    status                text not null default 'active'
        check (status in ('active','suspended','terminated')),
    start_date            date not null default current_date,
    end_date              date,
    metadata              jsonb not null default '{}',
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    unique (brand_tenant_id, franchisee_company_id)
);
comment on table cp.franchise_agreements is 'R-5 RESOLVED v1.1.0. Brand tenant ↔ franchisee company. billing_mode derives subscription payer. Single-owner chains have no rows here.';

create index if not exists idx_franchise_brand on cp.franchise_agreements(brand_tenant_id);
create index if not exists idx_franchise_franchisee on cp.franchise_agreements(franchisee_company_id);

-- 3.3 — RLS: brand-tenant isolation
alter table cp.franchise_agreements enable row level security;
drop policy if exists franchise_brand_isolation on cp.franchise_agreements;
create policy franchise_brand_isolation on cp.franchise_agreements
    for all
    using      (core.is_service_role() or brand_tenant_id = core.current_tenant_id())
    with check (core.is_service_role() or brand_tenant_id = core.current_tenant_id());


-- =====================================================================
-- SECTION 4 — cafe.* FK RECONCILIATION  (R-2 / R-3)
-- Repoint café FKs from ghost targets to real ones:
--   core.stores  → pos.stores
--   pos.items    → menu.items   (Section 1)
--   pos.terminals→ pos.registers
--   core.users   → cp.accounts
--   ops.cafe_orders keeps its cart_id link to pos.carts (R-3: carts = financial truth)
--
-- DEPENDENCY: cafe.* tables must already exist (cafe_schema_init). This
-- section ALTERs their FKs. If a constraint name differs in your build,
-- the BE team adjusts the drop targets. Written defensively.
-- =====================================================================

-- Helper note: each block (a) drops any existing FK on the column if present,
-- (b) adds the correct FK. We guard with IF EXISTS on tables to avoid hard
-- failure when a café table hasn't been created yet.

-- 4.1 — cafe.ingredients.store_id → pos.stores
do $$
begin
    if to_regclass('cafe.ingredients') is not null then
        -- drop any FK currently on store_id (name-agnostic)
        execute (
            select string_agg(format('alter table cafe.ingredients drop constraint %I;', conname), ' ')
            from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
            where n.nspname='cafe' and t.relname='ingredients' and c.contype='f'
              and pg_get_constraintdef(c.oid) ilike '%(store_id)%'
        );
        alter table cafe.ingredients
            add constraint cafe_ingredients_store_fk
            foreign key (store_id) references pos.stores(store_id) on delete cascade;
    end if;
end$$;

-- 4.2 — cafe.modifier_groups / recipes etc. that referenced pos.items → menu.items
--      (café recipes are keyed to the sellable item)
do $$
begin
    if to_regclass('cafe.recipes') is not null then
        execute (
            select string_agg(format('alter table cafe.recipes drop constraint %I;', conname), ' ')
            from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
            where n.nspname='cafe' and t.relname='recipes' and c.contype='f'
              and pg_get_constraintdef(c.oid) ilike '%(item_id)%'
        );
        alter table cafe.recipes
            add constraint cafe_recipes_item_fk
            foreign key (item_id) references menu.items(item_id) on delete cascade;
    end if;
end$$;

-- 4.3 — cafe.t3_assignments.terminal_id → pos.registers ; .category_id → menu.categories
do $$
begin
    if to_regclass('cafe.t3_assignments') is not null then
        execute (
            select string_agg(format('alter table cafe.t3_assignments drop constraint %I;', conname), ' ')
            from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
            where n.nspname='cafe' and t.relname='t3_assignments' and c.contype='f'
              and (pg_get_constraintdef(c.oid) ilike '%(terminal_id)%'
                   or pg_get_constraintdef(c.oid) ilike '%(category_id)%')
        );
        alter table cafe.t3_assignments
            add constraint cafe_t3_terminal_fk
            foreign key (terminal_id) references pos.registers(register_id) on delete cascade;
        alter table cafe.t3_assignments
            add constraint cafe_t3_category_fk
            foreign key (category_id) references menu.categories(category_id) on delete cascade;
    end if;
end$$;

-- 4.4 — cafe.tabs.opened_by_user_id → cp.accounts ; .store_id → pos.stores
do $$
begin
    if to_regclass('cafe.tabs') is not null then
        execute (
            select string_agg(format('alter table cafe.tabs drop constraint %I;', conname), ' ')
            from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
            where n.nspname='cafe' and t.relname='tabs' and c.contype='f'
              and (pg_get_constraintdef(c.oid) ilike '%(opened_by_user_id)%'
                   or pg_get_constraintdef(c.oid) ilike '%(store_id)%')
        );
        alter table cafe.tabs
            add constraint cafe_tabs_store_fk
            foreign key (store_id) references pos.stores(store_id) on delete cascade;
        alter table cafe.tabs
            add constraint cafe_tabs_user_fk
            foreign key (opened_by_user_id) references cp.accounts(id) on delete restrict;
    end if;
end$$;

-- 4.5 — ops.cafe_orders FK reconciliation (R-3: keep cart_id → pos.carts as truth link)
do $$
begin
    if to_regclass('ops.cafe_orders') is not null then
        execute (
            select string_agg(format('alter table ops.cafe_orders drop constraint %I;', conname), ' ')
            from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
            where n.nspname='ops' and t.relname='cafe_orders' and c.contype='f'
              and (pg_get_constraintdef(c.oid) ilike '%(store_id)%'
                   or pg_get_constraintdef(c.oid) ilike '%(created_by_user_id)%')
        );
        alter table ops.cafe_orders
            add constraint cafe_orders_store_fk
            foreign key (store_id) references pos.stores(store_id) on delete cascade;
        alter table ops.cafe_orders
            add constraint cafe_orders_user_fk
            foreign key (created_by_user_id) references cp.accounts(id) on delete restrict;
        -- cart_id → pos.carts (financial source of truth). Add only if column exists.
        if exists (
            select 1 from information_schema.columns
            where table_schema='ops' and table_name='cafe_orders' and column_name='cart_id'
        ) then
            alter table ops.cafe_orders
                add constraint cafe_orders_cart_fk
                foreign key (cart_id) references pos.carts(cart_id) on delete restrict;
        end if;
    end if;
end$$;

commit;

-- =====================================================================
-- POST-APPLY MANUAL STEPS (BE team) — cannot be automated here:
--   1. Backfill pos.stores.vertical_type for every existing store, then:
--        alter table pos.stores alter column vertical_type set not null;
--   2. If cafe.* tables were NOT yet created, apply cafe_schema_init FIRST,
--      then re-run Section 4 of this migration.
--   3. Verify RLS: every new table returns rowsecurity = true.
--   4. Smoke test: create one 'laundry' store + one 'cafe' store under one
--      tenant; confirm POS shell routes each to the correct vertical bundle;
--      confirm UPDATE of vertical_type raises the immutability exception.
-- =====================================================================
