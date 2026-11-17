import type { LucideIcon, LucideProps } from 'lucide-react';
import * as L from 'lucide-react';

/** Lucide at the app's thin weight (the mobile app bundles Lucide 300). One icon language everywhere. */
export type IconType = LucideIcon;
export function Icon({ icon: I, size = 20, strokeWidth = 1.5, ...rest }: { icon: LucideIcon } & LucideProps) {
  return <I size={size} strokeWidth={strokeWidth} aria-hidden {...rest} />;
}

export const Ic = {
  heart: L.Heart, house: L.House, compass: L.Compass, search: L.Search, shoppingBag: L.ShoppingBag, user: L.User, x: L.X,
  chevronRight: L.ChevronRight, chevronLeft: L.ChevronLeft, chevronDown: L.ChevronDown, chevronUp: L.ChevronUp,
  arrowLeft: L.ArrowLeft, arrowRight: L.ArrowRight, minus: L.Minus, plus: L.Plus, star: L.Star, mapPin: L.MapPin,
  sparkles: L.Sparkles, image: L.Image, check: L.Check, circleAlert: L.CircleAlert, circleCheck: L.CircleCheck,
  slidersHorizontal: L.SlidersHorizontal, share2: L.Share2, bookmark: L.Bookmark, play: L.Play, pause: L.Pause,
  volume2: L.Volume2, volumeX: L.VolumeX, phone: L.Phone, messageCircle: L.MessageCircle, navigation: L.Navigation,
  locateFixed: L.LocateFixed, bike: L.Bike, store: L.Store, package: L.Package, truck: L.Truck, clock: L.Clock,
  wallet: L.Wallet, banknote: L.Banknote, smartphone: L.Smartphone, creditCard: L.CreditCard, gift: L.Gift, bell: L.Bell,
  globe: L.Globe, moon: L.Moon, sun: L.Sun, sunMoon: L.SunMoon, shield: L.Shield, download: L.Download, trash2: L.Trash2,
  logOut: L.LogOut, ruler: L.Ruler, info: L.Info, mic: L.Mic, camera: L.Camera, qrCode: L.QrCode, keyRound: L.KeyRound,
  crosshair: L.Crosshair, briefcase: L.Briefcase, history: L.History, receipt: L.Receipt, rotateCcw: L.RotateCcw,
  scanLine: L.ScanLine, award: L.Award, crown: L.Crown, heartHandshake: L.HeartHandshake, palette: L.Palette,
  settings: L.Settings, lock: L.Lock, copy: L.Copy, externalLink: L.ExternalLink, eye: L.Eye, listFilter: L.ListFilter,
  arrowUpDown: L.ArrowUpDown, layoutGrid: L.LayoutGrid, tag: L.Tag, shirt: L.Shirt, footprints: L.Footprints, gem: L.Gem,
  glasses: L.Glasses, baby: L.Baby, droplet: L.Droplet, brush: L.Brush, flower: L.Flower, flower2: L.Flower2,
  sprayCan: L.SprayCan, scissors: L.Scissors, watch: L.Watch, moonStar: L.MoonStar, activity: L.Activity, leaf: L.Leaf,
  snowflake: L.Snowflake, umbrella: L.Umbrella, backpack: L.Backpack, ribbon: L.Ribbon, wind: L.Wind,
  bookmarkCheck: L.BookmarkCheck, mail: L.Mail, users: L.Users, map: L.Map, route: L.Route, timer: L.Timer, zap: L.Zap,
  circleDot: L.CircleDot, signal: L.Signal, wifiOff: L.WifiOff, refreshCw: L.RefreshCw, pencil: L.Pencil, send: L.Send,
  flame: L.Flame, smile: L.Smile, keyboard: L.Keyboard,
} satisfies Record<string, LucideIcon>;

/** Category icon names come from the controlled set in catalog.taxonomy.CATEGORY_ICONS. */
export function categoryIcon(name?: string | null): LucideIcon {
  const m: Record<string, LucideIcon> = {
    shirt: Ic.shirt, baby: Ic.baby, footprints: Ic.footprints, 'shopping-bag': Ic.shoppingBag, glasses: Ic.glasses, gem: Ic.gem,
    sparkles: Ic.sparkles, palette: Ic.palette, activity: Ic.activity, moon: Ic.moon, heart: Ic.heart, 'moon-star': Ic.moonStar,
    'heart-handshake': Ic.heartHandshake, scissors: Ic.scissors, watch: Ic.watch, crown: Ic.crown, droplet: Ic.droplet,
    flower: Ic.flower, 'flower-2': Ic.flower2, wind: Ic.wind, sun: Ic.sun, brush: Ic.brush, 'spray-can': Ic.sprayCan,
    package: Ic.package, tag: Ic.tag, star: Ic.star, leaf: Ic.leaf, snowflake: Ic.snowflake, umbrella: Ic.umbrella,
    briefcase: Ic.briefcase, backpack: Ic.backpack, wallet: Ic.wallet, ribbon: Ic.ribbon,
  };
  return (name && m[name]) || Ic.tag;
}
