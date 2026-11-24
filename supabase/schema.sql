-- Crafted By The Light – database-opzet voor Supabase
-- Plak dit in Supabase > SQL Editor en klik op "Run". Je kunt het veilig opnieuw draaien.

create extension if not exists pgcrypto;

-- Producten -------------------------------------------------------------------
-- variants:  [{id, name, price_cents, stock_mode: 'stock'|'order', stock, lead_time}]
-- colors:    [{name, hex}]
-- fields:    [{id, label, max, required}]   (personalisatie)
create table if not exists products (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  name         text not null,
  category     text,
  description  text,
  photos       text[] not null default '{}',
  glow         text not null default '#FFB000',
  variants     jsonb not null default '[]',
  colors       jsonb not null default '[]',
  fields       jsonb not null default '[]',
  active       boolean not null default false,
  featured     boolean not null default false,
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);

-- Bestellingen ----------------------------------------------------------------
-- items: [{product_id, variant_id, name, variant, color, personal:{label:value}, qty, unit_cents, no_return}]
create table if not exists orders (
  id              uuid primary key default gen_random_uuid(),
  number          text unique not null,
  token           text not null,
  customer        jsonb not null,
  items           jsonb not null,
  country         text not null check (country in ('NL','BE')),
  subtotal_cents  integer not null,
  shipping_cents  integer not null,
  total_cents     integer not null,
  vat_cents       integer not null,
  mollie_id       text unique,
  status          text not null default 'open',
  fulfilment      text not null default 'nieuw'
                  check (fulfilment in ('nieuw','in_productie','verzonden','afgerond','geannuleerd')),
  tracking        text,
  note            text,
  counted         boolean not null default false,
  created_at      timestamptz not null default now(),
  paid_at         timestamptz,
  shipped_at      timestamptz
);
create index if not exists orders_created_idx on orders(created_at desc);

-- Instellingen ----------------------------------------------------------------
create table if not exists settings (
  key   text primary key,
  value jsonb not null
);
insert into settings(key, value) values
  ('shop_open',        'true'),
  ('shipping_nl',      '695'),
  ('shipping_be',      '995'),
  ('vat_rate',         '21'),
  ('accent',           '"#FFB000"'),
  ('notify_email',     '"info@thelightportraits.nl"'),
  ('business',         '{"name":"Crafted By The Light (The Light Portraits)","address":"Mergelweg 221, 6212 XE Maastricht","email":"info@thelightportraits.nl","phone":"06 39 85 52 53","kvk":"","vat_id":""}'),
  ('announcement',     '"Jouw naam erop ✦ Jouw kleur ✦ Verzending NL & BE ✦ iDEAL & Bancontact ✦ Gemaakt in Maastricht ✦"')
on conflict (key) do nothing;

-- Alleen de server (service role) mag bij de data ------------------------------
alter table products enable row level security;
alter table orders   enable row level security;
alter table settings enable row level security;

-- Betaalde bestelling verwerken: precies één keer, en voorraad afboeken ---------
create or replace function apply_paid_order(p_order uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_items jsonb; it jsonb;
begin
  update orders set counted = true, status = 'paid', paid_at = now()
   where id = p_order and counted = false
   returning items into v_items;
  if not found then return false; end if;
  for it in select * from jsonb_array_elements(v_items) loop
    update products p set variants = (
      select jsonb_agg(case
        when v->>'id' = it->>'variant_id' and v->>'stock_mode' = 'stock'
        then jsonb_set(v, '{stock}', to_jsonb(greatest(0, coalesce((v->>'stock')::int, 0) - (it->>'qty')::int)))
        else v end order by ord)
      from jsonb_array_elements(p.variants) with ordinality as x(v, ord))
    where p.id = (it->>'product_id')::uuid and jsonb_array_length(p.variants) > 0;
  end loop;
  return true;
end $$;

revoke all on function apply_paid_order(uuid) from public, anon, authenticated;

-- Foto-opslag -----------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('producten', 'producten', true)
on conflict (id) do nothing;
