import {
  BarChart3, Boxes, ClipboardList, FolderTree, Gauge, Home, Image as ImageIcon, LayoutGrid, Map, MapPin, Megaphone, MessageCircle, Package,
  RotateCcw, Ruler, ScrollText, Settings, Star, Store, Tag, Ticket, Users, UsersRound, Bike, HandCoins, Wallet, type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  perm: string;
  keywords?: string;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { label: 'Overview', items: [{ href: '/', label: 'Dashboard', icon: Gauge, perm: 'dashboard.view' }] },
  {
    label: 'Sell',
    items: [
      { href: '/orders', label: 'Orders', icon: ClipboardList, perm: 'orders.view', keywords: 'sales kanban invoice' },
      { href: '/dispatch', label: 'Dispatch', icon: Map, perm: 'dispatch.view', keywords: 'live map control room riders' },
      { href: '/payments', label: 'Payments', icon: Wallet, perm: 'orders.view', keywords: 'transactions snippe mobile money mpesa refunds' },
      { href: '/customers', label: 'Customers', icon: Users, perm: 'customers.view', keywords: 'wholesale clients' },
      { href: '/returns', label: 'Returns', icon: RotateCcw, perm: 'returns.manage', keywords: 'exchanges refunds' },
      { href: '/reviews', label: 'Reviews', icon: Star, perm: 'reviews.moderate' },
      { href: '/support', label: 'Support inbox', icon: MessageCircle, perm: 'support.chat', keywords: 'chat help' },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { href: '/products', label: 'Products', icon: Package, perm: 'products.view', keywords: 'items media pricing' },
      { href: '/catalog/categories', label: 'Categories', icon: FolderTree, perm: 'catalog.manage', keywords: 'taxonomy tree departments' },
      { href: '/catalog/brands', label: 'Brands', icon: Tag, perm: 'catalog.manage' },
      { href: '/catalog/collections', label: 'Collections', icon: LayoutGrid, perm: 'catalog.manage', keywords: 'drops edits' },
      { href: '/catalog/attributes', label: 'Attributes & sizes', icon: Ruler, perm: 'catalog.manage', keywords: 'size charts badges' },
      { href: '/inventory', label: 'Inventory', icon: Boxes, perm: 'inventory.view', keywords: 'stock transfers' },
    ],
  },
  {
    label: 'Delivery',
    items: [
      { href: '/riders', label: 'Riders', icon: Bike, perm: 'riders.view', keywords: 'drivers couriers' },
      { href: '/payouts', label: 'Rider payouts', icon: HandCoins, perm: 'riders.view', keywords: 'earnings pay riders snippe disbursement' },
      { href: '/stores', label: 'Stores & offices', icon: Store, perm: 'stores.manage', keywords: 'locations warehouse' },
      { href: '/zones', label: 'Delivery zones', icon: MapPin, perm: 'settings.manage', keywords: 'polygons fees' },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { href: '/marketing/home', label: 'Home layout', icon: Home, perm: 'marketing.manage', keywords: 'sections builder' },
      { href: '/marketing/looks', label: 'Looks & stories', icon: ImageIcon, perm: 'marketing.manage', keywords: 'feed reels' },
      { href: '/marketing/promos', label: 'Promo codes', icon: Ticket, perm: 'marketing.manage', keywords: 'discounts coupons' },
      { href: '/marketing/campaigns', label: 'Campaigns', icon: Megaphone, perm: 'marketing.manage', keywords: 'push sms' },
    ],
  },
  { label: 'Insights', items: [{ href: '/reports', label: 'Reports', icon: BarChart3, perm: 'reports.view' }] },
  {
    label: 'Admin',
    items: [
      { href: '/settings', label: 'Settings', icon: Settings, perm: 'settings.view', keywords: 'integrations s3 beem google maps keys' },
      { href: '/team', label: 'Team & roles', icon: UsersRound, perm: 'team.manage', keywords: 'admins invite' },
      { href: '/audit', label: 'Audit log', icon: ScrollText, perm: 'audit.view', keywords: 'history changes' },
    ],
  },
];

export const can = (perms: string[], p: string) => perms.includes('*') || perms.includes(p);
export const navFor = (perms: string[]) => NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(perms, i.perm)) })).filter((g) => g.items.length);
