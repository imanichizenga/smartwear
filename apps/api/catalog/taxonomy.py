"""
Controlled fashion & beauty taxonomy.

ROOTS is the only place a top-level category can come from. The eight core roots are seeded and
always present. A Super Admin may switch on the optional roots below — every one of them is still
fashion or beauty. Nothing else can ever become a root: there is no free-text root creation.

SEED_TREE is the default depth-3 tree (root → group → leaf) with English and Swahili names, the
attributes that apply at each level (inherited downwards) and the size chart family used by default.
"""
from __future__ import annotations

from dataclasses import dataclass, field

MAX_DEPTH = 3  # root = 0, so at most root → group → type → sub-type


@dataclass(frozen=True)
class RootSpec:
    key: str
    name: str
    name_sw: str
    kind: str  # "fashion" | "beauty"
    department: str | None
    icon: str
    core: bool = True
    description: str = ""


ROOTS: tuple[RootSpec, ...] = (
    RootSpec("women", "Women", "Wanawake", "fashion", "women", "shirt", description="Dresses, tops, tailoring and everything in between."),
    RootSpec("men", "Men", "Wanaume", "fashion", "men", "shirt", description="Shirts, tailoring, denim and essentials."),
    RootSpec("kids", "Kids", "Watoto", "fashion", "kids", "baby", description="Clothing for babies, girls and boys."),
    RootSpec("shoes", "Shoes", "Viatu", "fashion", None, "footprints", description="Heels, sneakers, sandals and boots."),
    RootSpec("bags", "Bags", "Mikoba", "fashion", None, "shopping-bag", description="Handbags, totes, backpacks and small leather goods."),
    RootSpec("accessories", "Accessories", "Vifaa", "fashion", None, "glasses", description="Belts, scarves, hats, sunglasses and hair accessories."),
    RootSpec("jewellery-watches", "Jewellery & Watches", "Vito na Saa", "fashion", None, "gem", description="Fine and fashion jewellery, and watches."),
    RootSpec("beauty", "Beauty", "Urembo", "beauty", None, "sparkles", description="Makeup, skincare, haircare, fragrance, nails and tools."),
    # Optional roots — fashion/beauty only, enabled by a Super Admin.
    RootSpec("african-fashion", "African Fashion", "Mitindo ya Kiafrika", "fashion", None, "palette", core=False, description="Kitenge, kanga, kanzu and contemporary African design."),
    RootSpec("activewear", "Activewear", "Mavazi ya Mazoezi", "fashion", None, "activity", core=False, description="Performance and athleisure."),
    RootSpec("modest-wear", "Modest Wear", "Mavazi ya Staha", "fashion", None, "moon", core=False, description="Abayas, hijabs, kaftans and modest essentials."),
    RootSpec("bridal", "Bridal & Occasion", "Harusi na Sherehe", "fashion", None, "heart", core=False, description="Wedding, bridesmaid and occasion wear."),
    RootSpec("lingerie", "Lingerie & Sleepwear", "Nguo za Ndani na za Kulalia", "fashion", None, "moon-star", core=False, description="Bras, briefs, shapewear and nightwear."),
    RootSpec("maternity", "Maternity", "Mavazi ya Ujauzito", "fashion", "women", "heart-handshake", core=False, description="Pregnancy and nursing wear."),
    RootSpec("mens-grooming", "Men's Grooming", "Urembo wa Wanaume", "beauty", "men", "scissors", core=False, description="Beard care, shaving and men's skincare."),
)
ROOT_BY_KEY = {r.key: r for r in ROOTS}
CORE_ROOT_KEYS = tuple(r.key for r in ROOTS if r.core)

# Icons the admin may pick for categories (Lucide names) — keeps iconography consistent.
CATEGORY_ICONS = (
    "shirt", "baby", "footprints", "shopping-bag", "glasses", "gem", "sparkles", "palette", "activity", "moon", "heart",
    "moon-star", "heart-handshake", "scissors", "watch", "crown", "droplet", "flower", "flower-2", "wind", "sun", "brush",
    "spray-can", "package", "tag", "star", "leaf", "snowflake", "umbrella", "briefcase", "backpack", "wallet", "ribbon",
)


@dataclass
class Node:
    slug: str
    name: str
    name_sw: str
    attributes: list[str] = field(default_factory=list)
    size_chart: str | None = None
    children: list[Node] = field(default_factory=list)
    icon: str | None = None
    department: str | None = None


def n(slug: str, name: str, name_sw: str, *children: Node, attrs: list[str] | None = None, chart: str | None = None, icon: str | None = None, dept: str | None = None) -> Node:
    return Node(slug, name, name_sw, attrs or [], chart, list(children), icon, dept)


APPAREL = ["occasion", "fit", "pattern", "material", "season"]
DRESS = ["neckline", "sleeve", "length"]
TOPS = ["neckline", "sleeve"]
BOTTOMS = ["rise", "leg", "length"]
SHOE = ["heel_height", "toe_shape", "closure", "shoe_material", "occasion"]
BAG = ["bag_size", "closure", "strap", "bag_material"]
JEWEL = ["metal", "stone", "jewellery_style"]
SKIN = ["skin_type", "skin_concern", "key_ingredient", "formulation"]
MAKEUP_FACE = ["finish", "coverage", "skin_type", "undertone"]
HAIR = ["hair_type", "hair_concern"]
FRAG = ["scent_family", "concentration"]


def _women_men(prefix: str, dept: str, sw_suffix: str) -> list[Node]:
    clothing = [
        n(f"{prefix}-shirts", "Shirts", "Mashati", attrs=TOPS),
        n(f"{prefix}-t-shirts", "T-shirts & Polos", "Fulana na Polo", attrs=TOPS),
        n(f"{prefix}-trousers", "Trousers", "Suruali", attrs=BOTTOMS),
        n(f"{prefix}-jeans", "Jeans", "Jinsi", attrs=BOTTOMS + ["wash"]),
        n(f"{prefix}-shorts", "Shorts", "Kaptula", attrs=BOTTOMS),
        n(f"{prefix}-knitwear", "Knitwear", "Sweta", attrs=TOPS),
        n(f"{prefix}-jackets-coats", "Jackets & Coats", "Jaketi na Makoti", attrs=["sleeve", "length"]),
        n(f"{prefix}-suits-blazers", "Suits & Blazers", "Suti na Blazer", attrs=["lapel", "fit"]),
        n(f"{prefix}-activewear", "Activewear", "Mavazi ya Mazoezi"),
        n(f"{prefix}-loungewear", "Loungewear & Nightwear", "Nguo za Nyumbani na za Kulalia"),
        n(f"{prefix}-swimwear", "Swimwear", "Mavazi ya Kuogelea"),
        n(f"{prefix}-african-prints", "Kitenge & African Prints", "Vitenge na Mitindo ya Kiafrika", attrs=["print_style"]),
    ]
    return clothing


SEED_TREE: dict[str, list[Node]] = {
    "women": [
        n("women-clothing", "Clothing", "Mavazi",
          n("women-dresses", "Dresses", "Magauni",
            n("women-maxi-dresses", "Maxi dresses", "Magauni marefu"),
            n("women-midi-dresses", "Midi dresses", "Magauni ya kati"),
            n("women-mini-dresses", "Mini dresses", "Magauni mafupi"),
            n("women-evening-dresses", "Evening & occasion", "Magauni ya sherehe"),
            attrs=DRESS),
          n("women-tops", "Tops & Blouses", "Blauzi na Topu", attrs=TOPS),
          n("women-skirts", "Skirts", "Sketi", attrs=["length", "rise"]),
          n("women-trousers", "Trousers", "Suruali", attrs=BOTTOMS),
          n("women-jeans", "Jeans", "Jinsi", attrs=BOTTOMS + ["wash"]),
          n("women-jumpsuits", "Jumpsuits & Playsuits", "Jumpsuti", attrs=["sleeve", "length"]),
          n("women-knitwear", "Knitwear", "Sweta", attrs=TOPS),
          n("women-jackets-coats", "Jackets & Coats", "Jaketi na Makoti", attrs=["sleeve", "length"]),
          n("women-suits-blazers", "Suits & Blazers", "Suti na Blazer", attrs=["lapel", "fit"]),
          n("women-two-piece-sets", "Co-ords & Sets", "Seti za vipande viwili"),
          n("women-kitenge-african-prints", "Kitenge & African Prints", "Vitenge na Mitindo ya Kiafrika", attrs=["print_style"]),
          n("women-abayas-kaftans", "Abayas & Kaftans", "Abaya na Kaftani"),
          n("women-activewear", "Activewear", "Mavazi ya Mazoezi"),
          n("women-swimwear", "Swimwear", "Mavazi ya Kuogelea"),
          n("women-lingerie-nightwear", "Lingerie & Nightwear", "Nguo za Ndani na za Kulalia"),
          attrs=APPAREL, chart="women-apparel"),
    ],
    "men": [
        n("men-clothing", "Clothing", "Mavazi",
          *_women_men("men", "men", ""),
          n("men-kanzu-traditional", "Kanzu & Traditional", "Kanzu na Mavazi ya Asili"),
          attrs=APPAREL, chart="men-apparel"),
    ],
    "kids": [
        n("kids-baby", "Baby (0–24m)", "Watoto Wachanga (miezi 0–24)",
          n("kids-baby-bodysuits", "Bodysuits & Sleepsuits", "Bodisuti"),
          n("kids-baby-sets", "Outfits & Sets", "Seti za Mavazi"),
          attrs=APPAREL, chart="kids-baby"),
        n("kids-girls", "Girls (2–14y)", "Wasichana (miaka 2–14)",
          n("kids-girls-dresses", "Dresses", "Magauni", attrs=DRESS),
          n("kids-girls-tops", "Tops & T-shirts", "Topu na Fulana"),
          n("kids-girls-bottoms", "Trousers, Skirts & Shorts", "Suruali, Sketi na Kaptula"),
          n("kids-girls-shoes", "Shoes", "Viatu", attrs=["closure"], chart="kids-shoes"),
          attrs=APPAREL, chart="kids", dept="kids"),
        n("kids-boys", "Boys (2–14y)", "Wavulana (miaka 2–14)",
          n("kids-boys-shirts", "Shirts & T-shirts", "Mashati na Fulana"),
          n("kids-boys-bottoms", "Trousers & Shorts", "Suruali na Kaptula"),
          n("kids-boys-shoes", "Shoes", "Viatu", attrs=["closure"], chart="kids-shoes"),
          attrs=APPAREL, chart="kids", dept="kids"),
        n("kids-school-uniform", "School & Uniform", "Sare za Shule", attrs=APPAREL, chart="kids"),
    ],
    "shoes": [
        n("shoes-women", "Women's shoes", "Viatu vya Wanawake",
          n("shoes-women-heels", "Heels", "Viatu vya Kisigino"),
          n("shoes-women-flats", "Flats & Ballerinas", "Viatu Bapa"),
          n("shoes-women-sandals", "Sandals & Slides", "Sandali"),
          n("shoes-women-sneakers", "Sneakers", "Raba"),
          n("shoes-women-boots", "Boots", "Buti"),
          n("shoes-women-mules", "Mules & Loafers", "Myuli na Lofa"),
          attrs=SHOE, chart="women-shoes", dept="women"),
        n("shoes-men", "Men's shoes", "Viatu vya Wanaume",
          n("shoes-men-formal", "Formal & Oxfords", "Viatu Rasmi"),
          n("shoes-men-loafers", "Loafers", "Lofa"),
          n("shoes-men-sneakers", "Sneakers", "Raba"),
          n("shoes-men-sandals", "Sandals & Slides", "Sandali"),
          n("shoes-men-boots", "Boots", "Buti"),
          attrs=SHOE, chart="men-shoes", dept="men"),
    ],
    "bags": [
        n("bags-handbags", "Handbags", "Mikoba ya Mkono", attrs=BAG),
        n("bags-totes", "Totes & Shoppers", "Mikoba Mikubwa", attrs=BAG),
        n("bags-crossbody", "Crossbody & Shoulder", "Mikoba ya Bega", attrs=BAG),
        n("bags-clutches", "Clutches & Evening", "Klachi", attrs=BAG),
        n("bags-backpacks", "Backpacks", "Mabegi ya Mgongoni", attrs=BAG),
        n("bags-travel", "Travel & Weekend", "Mabegi ya Safari", attrs=BAG),
        n("bags-wallets", "Wallets & Card holders", "Pochi na Vibeba Kadi", attrs=["bag_material"]),
    ],
    "accessories": [
        n("accessories-belts", "Belts", "Mikanda", attrs=["bag_material"], chart="belts"),
        n("accessories-scarves", "Scarves, Wraps & Kanga", "Skafu na Kanga", attrs=["material", "pattern"]),
        n("accessories-hijabs", "Hijabs & Headwraps", "Hijabu na Vilemba", attrs=["material"]),
        n("accessories-hats", "Hats & Caps", "Kofia", chart="hats"),
        n("accessories-sunglasses", "Sunglasses", "Miwani ya Jua", attrs=["frame_shape"]),
        n("accessories-hair", "Hair accessories", "Mapambo ya Nywele"),
        n("accessories-ties", "Ties & Pocket squares", "Tai"),
    ],
    "jewellery-watches": [
        n("jewellery", "Jewellery", "Vito",
          n("jewellery-necklaces", "Necklaces & Pendants", "Mikufu"),
          n("jewellery-earrings", "Earrings", "Hereni"),
          n("jewellery-rings", "Rings", "Pete", chart="rings"),
          n("jewellery-bracelets", "Bracelets & Bangles", "Bangili"),
          n("jewellery-anklets", "Anklets", "Vikuku vya Miguu"),
          n("jewellery-sets", "Jewellery sets", "Seti za Vito"),
          attrs=JEWEL),
        n("watches", "Watches", "Saa",
          n("watches-women", "Women's watches", "Saa za Wanawake", dept="women"),
          n("watches-men", "Men's watches", "Saa za Wanaume", dept="men"),
          n("watches-smart", "Smart watches", "Saa Janja"),
          attrs=["movement", "strap_material", "case_size", "water_resistance"]),
    ],
    "beauty": [
        n("beauty-makeup", "Makeup", "Vipodozi",
          n("makeup-face", "Face", "Uso", attrs=MAKEUP_FACE),
          n("makeup-eyes", "Eyes", "Macho", attrs=["finish"]),
          n("makeup-lips", "Lips", "Midomo", attrs=["finish"]),
          n("makeup-brows", "Brows", "Nyusi"),
          n("makeup-palettes", "Palettes & Sets", "Paleti na Seti"),
          icon="brush"),
        n("beauty-skincare", "Skincare", "Utunzaji wa Ngozi",
          n("skincare-cleansers", "Cleansers", "Visafishaji"),
          n("skincare-toners", "Toners & Essences", "Tona"),
          n("skincare-serums", "Serums & Treatments", "Seramu"),
          n("skincare-moisturisers", "Moisturisers", "Vilainishi"),
          n("skincare-sunscreen", "Sunscreen", "Kinga ya Jua", attrs=["spf"]),
          n("skincare-masks", "Masks & Exfoliators", "Barakoa na Visugua"),
          n("skincare-body", "Body care", "Utunzaji wa Mwili"),
          attrs=SKIN, icon="droplet"),
        n("beauty-haircare", "Haircare", "Utunzaji wa Nywele",
          n("haircare-shampoo", "Shampoo & Conditioner", "Shampuu na Kondishena"),
          n("haircare-treatments", "Treatments & Oils", "Matibabu na Mafuta"),
          n("haircare-styling", "Styling", "Mitindo"),
          n("haircare-wigs-extensions", "Wigs, Braids & Extensions", "Wigi, Rasta na Nywele za Bandia", attrs=["hair_length", "hair_texture"]),
          n("haircare-tools", "Hair tools", "Vifaa vya Nywele"),
          attrs=HAIR, icon="wind"),
        n("beauty-fragrance", "Fragrance", "Manukato",
          n("fragrance-women", "Women's fragrance", "Manukato ya Wanawake", dept="women"),
          n("fragrance-men", "Men's fragrance", "Manukato ya Wanaume", dept="men"),
          n("fragrance-unisex", "Unisex", "Ya Jinsia Zote"),
          n("fragrance-oud-attar", "Oud, Attar & Bakhoor", "Udi, Atari na Ubani"),
          n("fragrance-body-mists", "Body mists", "Manukato Mepesi"),
          attrs=FRAG, icon="spray-can"),
        n("beauty-nails", "Nails", "Kucha",
          n("nails-polish", "Nail polish", "Rangi ya Kucha", attrs=["finish"]),
          n("nails-care", "Nail care", "Utunzaji wa Kucha"),
          n("nails-press-on", "Press-on nails", "Kucha za Bandia"),
          icon="sparkles"),
        n("beauty-tools", "Tools & Brushes", "Vifaa na Brashi",
          n("tools-brushes", "Brushes & Sponges", "Brashi na Sponji"),
          n("tools-devices", "Beauty devices", "Vifaa vya Urembo"),
          n("tools-bags", "Makeup bags", "Mikoba ya Vipodozi"),
          icon="brush"),
    ],
    "african-fashion": [
        n("african-kitenge", "Kitenge", "Vitenge", attrs=APPAREL + ["print_style"], chart="women-apparel"),
        n("african-kanga", "Kanga & Kikoi", "Kanga na Kikoi", attrs=["pattern"]),
        n("african-kanzu", "Kanzu & Kofia", "Kanzu na Kofia", chart="men-apparel"),
        n("african-beadwork", "Beadwork & Maasai jewellery", "Ushanga na Vito vya Kimaasai", attrs=JEWEL),
    ],
    "activewear": [
        n("activewear-women", "Women", "Wanawake", attrs=APPAREL, chart="women-apparel", dept="women"),
        n("activewear-men", "Men", "Wanaume", attrs=APPAREL, chart="men-apparel", dept="men"),
        n("activewear-footwear", "Training shoes", "Viatu vya Mazoezi", attrs=SHOE),
    ],
    "modest-wear": [
        n("modest-abayas", "Abayas", "Abaya", attrs=APPAREL, chart="women-apparel"),
        n("modest-kaftans", "Kaftans & Jalabiya", "Kaftani na Jalabiya", attrs=APPAREL),
        n("modest-hijabs", "Hijabs & Niqabs", "Hijabu na Nikabu", attrs=["material"]),
    ],
    "bridal": [
        n("bridal-gowns", "Wedding gowns", "Magauni ya Harusi", attrs=DRESS + ["occasion"], chart="women-apparel"),
        n("bridal-bridesmaid", "Bridesmaid", "Wapambe", attrs=DRESS, chart="women-apparel"),
        n("bridal-groom", "Groom & groomsmen", "Bwana Harusi", chart="men-apparel"),
        n("bridal-accessories", "Bridal accessories", "Mapambo ya Harusi"),
    ],
    "lingerie": [
        n("lingerie-bras", "Bras", "Sidiria", chart="bras"),
        n("lingerie-briefs", "Briefs", "Chupi"),
        n("lingerie-shapewear", "Shapewear", "Nguo za Kubana"),
        n("lingerie-sleepwear", "Sleepwear & Robes", "Nguo za Kulalia"),
    ],
    "maternity": [
        n("maternity-dresses", "Maternity dresses", "Magauni ya Ujauzito", attrs=DRESS, chart="women-apparel"),
        n("maternity-nursing", "Nursing", "Nguo za Kunyonyesha"),
    ],
    "mens-grooming": [
        n("grooming-beard", "Beard care", "Utunzaji wa Ndevu"),
        n("grooming-shaving", "Shaving", "Kunyoa"),
        n("grooming-skincare", "Men's skincare", "Ngozi ya Wanaume", attrs=SKIN),
    ],
}

# ---------------------------------------------------------------- attribute catalogue
def _opts(*pairs: tuple[str, str, str]) -> list[dict]:
    return [{"value": v, "label": en, "labelSw": sw} for v, en, sw in pairs]


ATTRIBUTES: list[dict] = [
    {"key": "occasion", "label": "Occasion", "labelSw": "Tukio", "type": "multiselect", "filterable": True, "options": _opts(("everyday", "Everyday", "Kila siku"), ("work", "Work", "Kazini"), ("evening", "Evening", "Jioni"), ("wedding-guest", "Wedding guest", "Mgeni wa harusi"), ("party", "Party", "Sherehe"), ("vacation", "Vacation", "Likizo"), ("religious", "Religious", "Ibada"), ("sport", "Sport", "Michezo"))},
    {"key": "fit", "label": "Fit", "labelSw": "Ukaaji", "type": "select", "filterable": True, "options": _opts(("slim", "Slim", "Mwembamba"), ("regular", "Regular", "Wa kawaida"), ("relaxed", "Relaxed", "Huru"), ("oversized", "Oversized", "Mkubwa"), ("tailored", "Tailored", "Ulioshonwa"))},
    {"key": "pattern", "label": "Pattern", "labelSw": "Mchoro", "type": "select", "filterable": True, "options": _opts(("solid", "Solid", "Rangi moja"), ("stripe", "Stripe", "Mistari"), ("floral", "Floral", "Maua"), ("check", "Check", "Cheki"), ("animal", "Animal print", "Ngozi ya mnyama"), ("african-print", "African print", "Kitenge"), ("geometric", "Geometric", "Kijiometri"), ("polka", "Polka dot", "Vitone"))},
    {"key": "material", "label": "Material", "labelSw": "Kitambaa", "type": "multiselect", "filterable": True, "options": _opts(("cotton", "Cotton", "Pamba"), ("linen", "Linen", "Kitani"), ("silk", "Silk", "Hariri"), ("satin", "Satin", "Satini"), ("wool", "Wool", "Sufu"), ("denim", "Denim", "Jinsi"), ("polyester", "Polyester", "Poliesta"), ("viscose", "Viscose", "Viskosi"), ("chiffon", "Chiffon", "Shifoni"), ("leather", "Leather", "Ngozi"), ("knit", "Knit", "Iliyofumwa"))},
    {"key": "season", "label": "Season", "labelSw": "Msimu", "type": "select", "filterable": False, "options": _opts(("all-year", "All year", "Mwaka mzima"), ("hot", "Hot season", "Kiangazi"), ("rainy", "Rainy season", "Masika"), ("cool", "Cool season", "Kipupwe"))},
    {"key": "neckline", "label": "Neckline", "labelSw": "Shingo", "type": "select", "filterable": True, "options": _opts(("crew", "Crew", "Duara"), ("v-neck", "V-neck", "V"), ("square", "Square", "Mraba"), ("halter", "Halter", "Halta"), ("off-shoulder", "Off-shoulder", "Nje ya bega"), ("collared", "Collared", "Kola"), ("high", "High neck", "Shingo ndefu"), ("sweetheart", "Sweetheart", "Moyo"))},
    {"key": "sleeve", "label": "Sleeve", "labelSw": "Mkono", "type": "select", "filterable": True, "options": _opts(("sleeveless", "Sleeveless", "Bila mikono"), ("short", "Short", "Mfupi"), ("three-quarter", "3/4", "Robo tatu"), ("long", "Long", "Mrefu"), ("puff", "Puff", "Puffu"))},
    {"key": "length", "label": "Length", "labelSw": "Urefu", "type": "select", "filterable": True, "options": _opts(("mini", "Mini", "Fupi"), ("knee", "Knee", "Goti"), ("midi", "Midi", "Kati"), ("maxi", "Maxi", "Ndefu"), ("cropped", "Cropped", "Iliyokatwa"), ("full", "Full length", "Kamili"))},
    {"key": "rise", "label": "Rise", "labelSw": "Kiuno", "type": "select", "filterable": True, "options": _opts(("low", "Low", "Chini"), ("mid", "Mid", "Kati"), ("high", "High", "Juu"))},
    {"key": "leg", "label": "Leg", "labelSw": "Mguu", "type": "select", "filterable": True, "options": _opts(("skinny", "Skinny", "Kubana"), ("straight", "Straight", "Moja kwa moja"), ("wide", "Wide", "Pana"), ("flare", "Flare", "Kengele"), ("tapered", "Tapered", "Kupungua"))},
    {"key": "wash", "label": "Wash", "labelSw": "Rangi ya jinsi", "type": "select", "filterable": True, "options": _opts(("light", "Light", "Nyepesi"), ("mid", "Mid", "Kati"), ("dark", "Dark", "Nzito"), ("black", "Black", "Nyeusi"))},
    {"key": "lapel", "label": "Lapel", "labelSw": "Kola ya koti", "type": "select", "filterable": False, "options": _opts(("notch", "Notch", "Noti"), ("peak", "Peak", "Ncha"), ("shawl", "Shawl", "Shali"))},
    {"key": "print_style", "label": "Print style", "labelSw": "Aina ya mchoro", "type": "select", "filterable": True, "options": _opts(("ankara", "Ankara", "Ankara"), ("kitenge", "Kitenge", "Kitenge"), ("kente", "Kente", "Kente"), ("mudcloth", "Mudcloth", "Bogolan"), ("batik", "Batik", "Batiki"))},
    {"key": "heel_height", "label": "Heel height", "labelSw": "Urefu wa kisigino", "type": "select", "filterable": True, "options": _opts(("flat", "Flat", "Bapa"), ("low", "Low (1–4cm)", "Chini"), ("mid", "Mid (5–8cm)", "Kati"), ("high", "High (9cm+)", "Juu"))},
    {"key": "toe_shape", "label": "Toe", "labelSw": "Ncha", "type": "select", "filterable": False, "options": _opts(("round", "Round", "Duara"), ("pointed", "Pointed", "Ncha"), ("square", "Square", "Mraba"), ("open", "Open", "Wazi"))},
    {"key": "closure", "label": "Closure", "labelSw": "Kufunga", "type": "select", "filterable": False, "options": _opts(("slip-on", "Slip-on", "Kuvaa tu"), ("lace-up", "Lace-up", "Kamba"), ("buckle", "Buckle", "Bakoli"), ("zip", "Zip", "Zipu"), ("magnetic", "Magnetic", "Sumaku"), ("velcro", "Hook & loop", "Velcro"))},
    {"key": "shoe_material", "label": "Upper", "labelSw": "Juu ya kiatu", "type": "select", "filterable": True, "options": _opts(("leather", "Leather", "Ngozi"), ("suede", "Suede", "Swedi"), ("canvas", "Canvas", "Turubai"), ("synthetic", "Synthetic", "Sintetiki"), ("knit", "Knit", "Iliyofumwa"))},
    {"key": "bag_size", "label": "Size", "labelSw": "Ukubwa", "type": "select", "filterable": True, "options": _opts(("mini", "Mini", "Ndogo sana"), ("small", "Small", "Ndogo"), ("medium", "Medium", "Kati"), ("large", "Large", "Kubwa"))},
    {"key": "strap", "label": "Strap", "labelSw": "Mkanda", "type": "select", "filterable": False, "options": _opts(("top-handle", "Top handle", "Mshiko"), ("shoulder", "Shoulder", "Bega"), ("crossbody", "Crossbody", "Kuvuka"), ("chain", "Chain", "Mnyororo"), ("removable", "Removable", "Inayotolewa"))},
    {"key": "bag_material", "label": "Material", "labelSw": "Malighafi", "type": "select", "filterable": True, "options": _opts(("leather", "Leather", "Ngozi"), ("vegan-leather", "Vegan leather", "Ngozi bandia"), ("canvas", "Canvas", "Turubai"), ("straw", "Straw & raffia", "Majani"), ("beaded", "Beaded", "Shanga"))},
    {"key": "metal", "label": "Metal", "labelSw": "Madini", "type": "select", "filterable": True, "options": _opts(("gold", "Gold", "Dhahabu"), ("gold-plated", "Gold plated", "Iliyopakwa dhahabu"), ("silver", "Sterling silver", "Fedha"), ("rose-gold", "Rose gold", "Dhahabu ya waridi"), ("stainless", "Stainless steel", "Chuma cha pua"), ("brass", "Brass", "Shaba"))},
    {"key": "stone", "label": "Stone", "labelSw": "Jiwe", "type": "select", "filterable": True, "options": _opts(("none", "None", "Hakuna"), ("tanzanite", "Tanzanite", "Tanzanite"), ("diamond", "Diamond", "Almasi"), ("pearl", "Pearl", "Lulu"), ("cubic-zirconia", "Cubic zirconia", "Zirkonia"), ("gemstone", "Gemstone", "Kito"))},
    {"key": "jewellery_style", "label": "Style", "labelSw": "Mtindo", "type": "select", "filterable": True, "options": _opts(("minimal", "Minimal", "Rahisi"), ("statement", "Statement", "Kuvutia"), ("classic", "Classic", "Asili"), ("cultural", "Cultural", "Kiutamaduni"))},
    {"key": "movement", "label": "Movement", "labelSw": "Mfumo", "type": "select", "filterable": True, "options": _opts(("quartz", "Quartz", "Kwatzi"), ("automatic", "Automatic", "Otomatiki"), ("smart", "Smart", "Janja"))},
    {"key": "strap_material", "label": "Strap", "labelSw": "Mkanda", "type": "select", "filterable": True, "options": _opts(("leather", "Leather", "Ngozi"), ("metal", "Metal", "Chuma"), ("silicone", "Silicone", "Silikoni"), ("fabric", "Fabric", "Kitambaa"))},
    {"key": "case_size", "label": "Case size", "labelSw": "Ukubwa", "type": "text", "filterable": False, "options": []},
    {"key": "water_resistance", "label": "Water resistance", "labelSw": "Kuzuia maji", "type": "select", "filterable": False, "options": _opts(("none", "None", "Hakuna"), ("30m", "30m", "30m"), ("50m", "50m", "50m"), ("100m", "100m+", "100m+"))},
    {"key": "frame_shape", "label": "Frame", "labelSw": "Fremu", "type": "select", "filterable": True, "options": _opts(("aviator", "Aviator", "Aviator"), ("cat-eye", "Cat-eye", "Jicho la paka"), ("round", "Round", "Duara"), ("square", "Square", "Mraba"), ("oversized", "Oversized", "Kubwa"))},
    {"key": "skin_type", "label": "Skin type", "labelSw": "Aina ya ngozi", "type": "multiselect", "filterable": True, "options": _opts(("dry", "Dry", "Kavu"), ("oily", "Oily", "Yenye mafuta"), ("combination", "Combination", "Mchanganyiko"), ("normal", "Normal", "Kawaida"), ("sensitive", "Sensitive", "Nyeti"))},
    {"key": "skin_concern", "label": "Concern", "labelSw": "Tatizo", "type": "multiselect", "filterable": True, "options": _opts(("hyperpigmentation", "Dark spots", "Madoa"), ("acne", "Blemishes", "Chunusi"), ("dryness", "Dryness", "Ukavu"), ("ageing", "Fine lines", "Mikunjo"), ("dullness", "Dullness", "Kufifia"), ("pores", "Pores", "Vinyweleo"))},
    {"key": "key_ingredient", "label": "Key ingredient", "labelSw": "Kiambato kikuu", "type": "multiselect", "filterable": True, "options": _opts(("vitamin-c", "Vitamin C", "Vitamini C"), ("niacinamide", "Niacinamide", "Niasinamidi"), ("hyaluronic", "Hyaluronic acid", "Asidi ya hyaluroniki"), ("retinol", "Retinol", "Retinoli"), ("shea", "Shea butter", "Siagi ya shea"), ("aha-bha", "AHA / BHA", "AHA / BHA"), ("spf", "SPF", "SPF"))},
    {"key": "formulation", "label": "Formulation", "labelSw": "Muundo", "type": "select", "filterable": False, "options": _opts(("cream", "Cream", "Krimu"), ("gel", "Gel", "Jeli"), ("oil", "Oil", "Mafuta"), ("serum", "Serum", "Seramu"), ("balm", "Balm", "Balmu"), ("foam", "Foam", "Povu"))},
    {"key": "spf", "label": "SPF", "labelSw": "SPF", "type": "select", "filterable": True, "options": _opts(("15", "SPF 15", "SPF 15"), ("30", "SPF 30", "SPF 30"), ("50", "SPF 50+", "SPF 50+"))},
    {"key": "finish", "label": "Finish", "labelSw": "Mwonekano", "type": "select", "filterable": True, "options": _opts(("matte", "Matte", "Matte"), ("satin", "Satin", "Satini"), ("dewy", "Dewy", "Unyevu"), ("glossy", "Glossy", "Ng'aa"), ("shimmer", "Shimmer", "Mng'ao"), ("natural", "Natural", "Asili"))},
    {"key": "coverage", "label": "Coverage", "labelSw": "Ufunikaji", "type": "select", "filterable": True, "options": _opts(("sheer", "Sheer", "Nyepesi"), ("light", "Light", "Kidogo"), ("medium", "Medium", "Kati"), ("full", "Full", "Kamili"))},
    {"key": "undertone", "label": "Undertone", "labelSw": "Toni ya ndani", "type": "select", "filterable": True, "options": _opts(("cool", "Cool", "Baridi"), ("warm", "Warm", "Joto"), ("neutral", "Neutral", "Kati"), ("olive", "Olive", "Zeituni"))},
    {"key": "hair_type", "label": "Hair type", "labelSw": "Aina ya nywele", "type": "multiselect", "filterable": True, "options": _opts(("straight", "Straight", "Singa"), ("wavy", "Wavy", "Mawimbi"), ("curly", "Curly", "Mawimbi madogo"), ("coily", "Coily / 4C", "Kipilipili"), ("relaxed", "Relaxed", "Iliyonyooshwa"), ("locs", "Locs", "Rasta"))},
    {"key": "hair_concern", "label": "Hair concern", "labelSw": "Tatizo la nywele", "type": "multiselect", "filterable": True, "options": _opts(("breakage", "Breakage", "Kukatika"), ("dryness", "Dryness", "Ukavu"), ("growth", "Growth", "Ukuaji"), ("scalp", "Scalp care", "Ngozi ya kichwa"), ("frizz", "Frizz", "Kusimama"))},
    {"key": "hair_length", "label": "Length", "labelSw": "Urefu", "type": "select", "filterable": True, "options": _opts(("short", 'Short (≤12")', "Fupi"), ("medium", 'Medium (14–20")', "Kati"), ("long", 'Long (22"+)', "Ndefu"))},
    {"key": "hair_texture", "label": "Texture", "labelSw": "Muundo", "type": "select", "filterable": True, "options": _opts(("straight", "Straight", "Singa"), ("body-wave", "Body wave", "Mawimbi"), ("deep-wave", "Deep wave", "Mawimbi mazito"), ("kinky", "Kinky", "Kipilipili"), ("braids", "Braids", "Rasta"))},
    {"key": "scent_family", "label": "Scent family", "labelSw": "Familia ya harufu", "type": "multiselect", "filterable": True, "options": _opts(("floral", "Floral", "Maua"), ("woody", "Woody", "Miti"), ("oriental", "Amber & oriental", "Mashariki"), ("fresh", "Fresh & citrus", "Mbichi"), ("gourmand", "Gourmand", "Tamu"), ("oud", "Oud", "Udi"))},
    {"key": "concentration", "label": "Concentration", "labelSw": "Ukolezi", "type": "select", "filterable": True, "options": _opts(("parfum", "Parfum", "Parfum"), ("edp", "Eau de parfum", "EDP"), ("edt", "Eau de toilette", "EDT"), ("attar", "Attar oil", "Atari"), ("mist", "Body mist", "Mist"))},
]

# ---------------------------------------------------------------- default size charts
SIZE_CHARTS: dict[str, dict] = {
    "women-apparel": {"name": "Women — clothing", "unit": "cm", "columns": ["UK", "EU", "US", "Bust", "Waist", "Hips"], "rows": [
        ["XS", "6", "34", "2", "80", "63", "88"], ["S", "8–10", "36–38", "4–6", "84–88", "67–71", "92–96"], ["M", "12–14", "40–42", "8–10", "92–96", "75–79", "100–104"],
        ["L", "16–18", "44–46", "12–14", "101–106", "84–89", "109–114"], ["XL", "20–22", "48–50", "16–18", "111–116", "94–99", "119–124"], ["XXL", "24–26", "52–54", "20–22", "121–126", "104–109", "129–134"]]},
    "men-apparel": {"name": "Men — clothing", "unit": "cm", "columns": ["Size", "Chest", "Waist", "Neck"], "rows": [
        ["S", "S", "88–96", "73–81", "37"], ["M", "M", "96–104", "81–89", "39"], ["L", "L", "104–112", "89–97", "41"], ["XL", "XL", "112–124", "97–109", "43"], ["XXL", "XXL", "124–136", "109–121", "45"]]},
    "kids": {"name": "Kids — clothing", "unit": "cm", "columns": ["Age", "Height", "Chest"], "rows": [
        ["2–3y", "2–3y", "92–98", "53–55"], ["4–5y", "4–5y", "104–110", "56–58"], ["6–7y", "6–7y", "116–122", "60–63"], ["8–9y", "8–9y", "128–134", "64–68"], ["10–11y", "10–11y", "140–146", "70–74"], ["12–14y", "12–14y", "152–164", "76–82"]]},
    "kids-baby": {"name": "Baby", "unit": "cm", "columns": ["Age", "Height", "Weight (kg)"], "rows": [
        ["0–3m", "0–3m", "56–62", "4–6"], ["3–6m", "3–6m", "62–68", "6–8"], ["6–12m", "6–12m", "68–80", "8–10"], ["12–18m", "12–18m", "80–86", "10–12"], ["18–24m", "18–24m", "86–92", "12–14"]]},
    "women-shoes": {"name": "Women — shoes", "unit": "cm", "columns": ["EU", "UK", "US", "Foot length"], "rows": [
        ["36", "36", "3", "5.5", "23"], ["37", "37", "4", "6.5", "23.7"], ["38", "38", "5", "7.5", "24.4"], ["39", "39", "6", "8.5", "25"], ["40", "40", "7", "9.5", "25.7"], ["41", "41", "7.5", "10", "26.4"], ["42", "42", "8", "10.5", "27"]]},
    "men-shoes": {"name": "Men — shoes", "unit": "cm", "columns": ["EU", "UK", "US", "Foot length"], "rows": [
        ["40", "40", "6.5", "7.5", "25.4"], ["41", "41", "7", "8", "26"], ["42", "42", "8", "9", "26.7"], ["43", "43", "9", "10", "27.4"], ["44", "44", "9.5", "10.5", "28"], ["45", "45", "10.5", "11.5", "28.7"], ["46", "46", "11", "12", "29.4"]]},
    "kids-shoes": {"name": "Kids — shoes", "unit": "cm", "columns": ["EU", "UK", "Foot length"], "rows": [["24", "24", "7", "15"], ["26", "26", "8.5", "16.3"], ["28", "28", "10", "17.5"], ["30", "30", "11.5", "18.8"], ["32", "32", "13", "20"], ["34", "34", "2", "21.3"]]},
    "rings": {"name": "Rings", "unit": "cm", "columns": ["Size", "Diameter (mm)", "Circumference (mm)"], "rows": [["5", "5", "15.7", "49.3"], ["6", "6", "16.5", "51.9"], ["7", "7", "17.3", "54.4"], ["8", "8", "18.1", "57"], ["9", "9", "18.9", "59.5"]]},
    "bras": {"name": "Bras", "unit": "cm", "columns": ["Band", "Underbust"], "rows": [["32", "32", "68–72"], ["34", "34", "73–77"], ["36", "36", "78–82"], ["38", "38", "83–87"], ["40", "40", "88–92"]]},
    "belts": {"name": "Belts", "unit": "cm", "columns": ["Size", "Waist"], "rows": [["S", "S", "70–80"], ["M", "M", "80–90"], ["L", "L", "90–100"], ["XL", "XL", "100–110"]]},
    "hats": {"name": "Hats", "unit": "cm", "columns": ["Size", "Head"], "rows": [["S", "S", "54–55"], ["M", "M", "56–57"], ["L", "L", "58–59"]]},
}

BADGES = [
    {"key": "new", "label": "New", "labelSw": "Mpya", "tone": "ink"},
    {"key": "limited", "label": "Limited", "labelSw": "Toleo maalum", "tone": "accent"},
    {"key": "bestseller", "label": "Bestseller", "labelSw": "Inayopendwa", "tone": "muted"},
    {"key": "exclusive", "label": "Exclusive", "labelSw": "Kipekee", "tone": "accent"},
    {"key": "made-in-tz", "label": "Made in Tanzania", "labelSw": "Imetengenezwa Tanzania", "tone": "blush"},
    {"key": "clean-beauty", "label": "Clean beauty", "labelSw": "Urembo safi", "tone": "blush"},
]
