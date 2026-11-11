/** The controlled category icon set (mirrors catalog.taxonomy.CATEGORY_ICONS) — imported explicitly to keep the bundle small. */
import {
  Activity, Baby, Backpack, Briefcase, Brush, Crown, Droplet, Flower, Flower2, Footprints, Gem, Glasses, Heart, HeartHandshake, Leaf, Moon, MoonStar, Package, Palette, Ribbon, Scissors, Shirt, ShoppingBag, Snowflake, Sparkles, SprayCan, Star, Sun, Tag, Umbrella, Wallet, Watch, Wind,
  FolderTree,
  type LucideIcon,
} from 'lucide-react';

export const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  'shirt': Shirt,
  'baby': Baby,
  'footprints': Footprints,
  'shopping-bag': ShoppingBag,
  'glasses': Glasses,
  'gem': Gem,
  'sparkles': Sparkles,
  'palette': Palette,
  'activity': Activity,
  'moon': Moon,
  'heart': Heart,
  'moon-star': MoonStar,
  'heart-handshake': HeartHandshake,
  'scissors': Scissors,
  'watch': Watch,
  'crown': Crown,
  'droplet': Droplet,
  'flower': Flower,
  'flower-2': Flower2,
  'wind': Wind,
  'sun': Sun,
  'brush': Brush,
  'spray-can': SprayCan,
  'package': Package,
  'tag': Tag,
  'star': Star,
  'leaf': Leaf,
  'snowflake': Snowflake,
  'umbrella': Umbrella,
  'briefcase': Briefcase,
  'backpack': Backpack,
  'wallet': Wallet,
  'ribbon': Ribbon,
};


/** Renders a category's icon by name (static lookup — never a component created during render). */
export function CategoryIcon({ name, className, strokeWidth = 1.5 }: { name?: string | null; className?: string; strokeWidth?: number }) {
  const I = (name && CATEGORY_ICON_MAP[name]) || FolderTree;
  return <I className={className} strokeWidth={strokeWidth} aria-hidden />;
}
