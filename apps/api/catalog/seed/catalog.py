"""
Seed catalog for local development and demos.

Every image is from Unsplash (https://unsplash.com/license — free for commercial use, no permission needed).
Images were hand-picked so no brand logo, watermark or text sits on the product; the IDs below are
Unsplash CDN photo IDs and the credit page is listed in docs/IMAGE_CREDITS.md.

Brands are fictional. Prices are TZS (no minor units).
"""
from __future__ import annotations

from dataclasses import dataclass, field

UNSPLASH = "https://images.unsplash.com/photo-{id}?w=2000&q=85&fm=jpg"


@dataclass(frozen=True)
class BrandSeed:
    name: str
    country: str
    story: str
    story_sw: str = ""
    featured: bool = False


BRANDS: tuple[BrandSeed, ...] = (
    BrandSeed("Maison Pwani", "Tanzania", "Coastal tailoring from Dar es Salaam — breathable linens and fluid silhouettes cut for the Indian Ocean breeze.", "Mitindo ya pwani kutoka Dar es Salaam.", True),
    BrandSeed("Kanga House", "Tanzania", "Contemporary prints rooted in the kanga tradition, block-printed in small runs.", "Michoro ya kisasa yenye asili ya kanga.", True),
    BrandSeed("Atelier Msasani", "Tanzania", "Evening and occasion wear, finished by hand in our Msasani studio.", "Mavazi ya sherehe yaliyoshonwa kwa mkono."),
    BrandSeed("Kilele Studio", "Kenya", "Modern menswear essentials with a tailored edge.", "Mavazi muhimu ya wanaume."),
    BrandSeed("Dar Denim Works", "Tanzania", "Selvedge and organic denim, washed and finished in Tanzania.", "Jinzi zilizotengenezwa Tanzania."),
    BrandSeed("Savanna Leather Co.", "Tanzania", "Full-grain leather goods made by artisans in Arusha.", "Bidhaa za ngozi halisi kutoka Arusha.", True),
    BrandSeed("Zanzi Gold", "Tanzania", "Fine jewellery inspired by Stone Town doors and the tides of Zanzibar.", "Vito vilivyoongozwa na Zanzibar."),
    BrandSeed("Baobab Botanics", "Tanzania", "Clean skincare powered by baobab, moringa and shea from East Africa.", "Huduma ya ngozi kwa viambato asilia.", True),
    BrandSeed("Nuru Beauty", "Tanzania", "Makeup designed for every shade of melanin-rich skin.", "Vipodozi kwa kila rangi ya ngozi."),
    BrandSeed("Oud & Ember", "Oman", "Small-batch perfumes and attars built around precious oud.", "Manukato ya udi."),
    BrandSeed("Mtoto Mdogo", "Tanzania", "Soft, durable clothes for little adventurers.", "Nguo laini za watoto."),
    BrandSeed("Upepo Eyewear", "Kenya", "Lightweight frames with UV400 lenses for equatorial sun.", "Miwani ya jua."),
)

# 12 of the 16 core sizes used across apparel; shoes use EU sizes.
W_SIZES = ("XS", "S", "M", "L", "XL")
M_SIZES = ("S", "M", "L", "XL", "XXL")
SUIT_SIZES = ("46", "48", "50", "52", "54")
JEANS_W = ("26", "28", "30", "32")
JEANS_M = ("30", "32", "34", "36")
SHOE_W = ("37", "38", "39", "40", "41")
SHOE_M = ("41", "42", "43", "44", "45")
KIDS = ("2-3Y", "4-5Y", "6-7Y", "8-9Y")
ONE = ("One size",)


@dataclass(frozen=True)
class ProductSeed:
    category: str
    title: str
    title_sw: str
    brand: str
    images: tuple[str, ...]
    price: int
    tagline: str
    description: str
    colours: tuple[tuple[str, str], ...] = ()
    sizes: tuple[str, ...] = ()
    shades: tuple[tuple[str, str], ...] = ()
    volumes: tuple[str, ...] = ()
    attributes: dict = field(default_factory=dict)
    materials: str = ""
    care: str = ""
    story: str = ""
    fit_note: str | None = None
    compare_at: int | None = None
    badges: tuple[str, ...] = ()
    featured: bool = False
    tags: tuple[str, ...] = ()
    beauty: dict | None = None
    origin: str = "Tanzania"
    wholesale: bool = True
    alt: str = ""


P = ProductSeed
PRODUCTS: tuple[ProductSeed, ...] = (
    # ---------------------------------------------------------------- women
    P("women-maxi-dresses", "Zuri linen maxi dress", "Gauni refu la kitani Zuri", "Maison Pwani", ("1515372039744-b8f02a3ae446",), 85000,
      "Breathable linen for Dar afternoons", "<p>An airy maxi cut from <strong>pure washed linen</strong>, with an off-shoulder neckline and a tiered skirt that moves with you.</p>",
      colours=(("Ivory", "#F3EDE2"), ("Sand", "#D8C3A5")), sizes=W_SIZES,
      attributes={"occasion": ["everyday", "vacation"], "material": ["linen"], "neckline": "off-shoulder", "sleeve": "short", "length": "maxi", "fit": "relaxed", "pattern": "solid", "season": "hot"},
      materials="100% linen", care="Cold hand wash. Line dry in shade. Warm iron.", fit_note="true", badges=("new", "made-in-tz"), featured=True, tags=("linen", "summer"),
      story="Cut in our Mikocheni studio from European flax, garment-washed for a soft hand.", alt="Model in an ivory off-shoulder linen maxi dress"),
    P("women-midi-dresses", "Pwani floral wrap dress", "Gauni la maua Pwani", "Maison Pwani", ("1496747611176-843222e1e57c",), 78000,
      "A wrap that flatters everyone", "<p>A floral wrap midi with a tie waist and flutter sleeves, printed on fluid viscose.</p>",
      colours=(("Ocean floral", "#E9E3DA"),), sizes=W_SIZES,
      attributes={"occasion": ["everyday", "vacation", "wedding-guest"], "material": ["viscose"], "neckline": "v-neck", "sleeve": "short", "length": "midi", "pattern": "floral"},
      materials="100% viscose", care="Gentle machine wash 30°C.", fit_note="true", badges=("bestseller",), alt="Woman in a floral wrap dress by the sea"),
    P("women-evening-dresses", "Malkia off-shoulder gown", "Gauni la jioni Malkia", "Atelier Msasani", ("1566174053879-31528523f8ae",), 245000,
      "Plum satin, sculpted by hand", "<p>A floor-length gown in heavy satin with a sculpted off-shoulder bodice and a soft fishtail hem.</p>",
      colours=(("Plum", "#5B1F45"), ("Midnight", "#1B1F3A")), sizes=W_SIZES,
      attributes={"occasion": ["evening", "wedding-guest", "party"], "material": ["satin"], "neckline": "off-shoulder", "sleeve": "sleeveless", "length": "maxi", "fit": "slim"},
      materials="Satin (95% polyester, 5% elastane); fully lined", care="Dry clean only.", fit_note="small", badges=("limited",), featured=True,
      story="Each gown is finished by hand — allow us to steam it before delivery.", wholesale=False, alt="Model in a plum satin off-shoulder gown"),
    P("women-midi-dresses", "Kanga swing dress", "Gauni la kanga", "Kanga House", ("1572804013309-59a88b7e92f1",), 92000,
      "Our bestselling kanga print, reimagined", "<p>A full-skirted swing dress in a bold red floral inspired by kanga borders, with a self-belt.</p>",
      colours=(("Red bloom", "#C2262E"),), sizes=W_SIZES,
      attributes={"occasion": ["party", "wedding-guest"], "material": ["cotton"], "neckline": "v-neck", "sleeve": "short", "length": "midi", "pattern": "floral"},
      materials="100% cotton poplin", care="Machine wash 30°C inside out.", fit_note="true", badges=("made-in-tz", "bestseller"), featured=True, alt="Woman in a red floral swing dress"),
    P("women-maxi-dresses", "Rubi flowing maxi", "Gauni refu Rubi", "Atelier Msasani", ("1595777457583-95e059d581b8",), 135000,
      "Made for spinning", "<p>A sleeveless maxi with a sunray-pleated skirt in lightweight chiffon.</p>",
      colours=(("Rubi red", "#B3122A"), ("Emerald", "#1F5E4A")), sizes=W_SIZES,
      attributes={"occasion": ["evening", "wedding-guest"], "material": ["chiffon"], "neckline": "halter", "sleeve": "sleeveless", "length": "maxi"},
      materials="100% polyester chiffon, lined", care="Hand wash cold.", fit_note="true", alt="Woman twirling in a red chiffon maxi"),
    P("women-mini-dresses", "Asali ruffle dress", "Gauni fupi Asali", "Maison Pwani", ("1581044777550-4cfa60707c03",), 69000,
      "Romantic ruffles, featherlight", "<p>An off-shoulder mini with cascading ruffles in a ditsy blush print.</p>",
      colours=(("Blush floral", "#F2D7DA"),), sizes=W_SIZES,
      attributes={"occasion": ["party", "vacation"], "material": ["polyester"], "neckline": "off-shoulder", "sleeve": "puff", "length": "mini", "pattern": "floral"},
      materials="100% recycled polyester", care="Machine wash 30°C.", fit_note="large", badges=("new",), alt="Woman in a blush ruffled off-shoulder dress"),
    P("women-tops", "Embroidered cotton blouse", "Blauzi ya pamba yenye darizi", "Kanga House", ("1564257631407-4deb1f99d992",), 48000,
      "Hand-embroidered florals", "<p>A cropped camp-collar blouse with hand-embroidered blooms.</p>",
      colours=(("White", "#F7F5F0"),), sizes=W_SIZES,
      attributes={"occasion": ["everyday", "vacation"], "material": ["cotton"], "neckline": "collared", "sleeve": "short", "pattern": "floral"},
      materials="100% cotton", care="Hand wash cold. Do not tumble dry.", fit_note="true", badges=("made-in-tz",), alt="Embroidered white cotton blouse"),
    P("women-tops", "Striped linen overshirt", "Shati la kitani lenye mistari", "Maison Pwani", ("1584030373081-f37b7bb4fa8e",), 56000,
      "Wear it open or tucked", "<p>A relaxed, dropped-shoulder overshirt in a fine pinstripe linen.</p>",
      colours=(("Ivory stripe", "#ECE8E0"),), sizes=W_SIZES,
      attributes={"occasion": ["everyday", "work"], "material": ["linen"], "sleeve": "long", "pattern": "stripe", "fit": "oversized"},
      materials="100% linen", care="Machine wash 30°C.", fit_note="large", alt="Striped linen overshirt on a hanger"),
    P("women-trousers", "Pinstripe wide-leg trousers", "Suruali pana zenye mistari", "Maison Pwani", ("1509631179647-0177331693ae",), 74000,
      "High waist, long line", "<p>Fluid wide-leg trousers with a high rise and pressed front crease.</p>",
      colours=(("Black stripe", "#1C1C1E"),), sizes=W_SIZES,
      attributes={"occasion": ["work", "evening"], "material": ["viscose"], "rise": "high", "leg": "wide", "length": "full", "pattern": "stripe"},
      materials="70% viscose, 30% linen", care="Machine wash 30°C.", fit_note="true", alt="Model in black pinstripe wide-leg trousers"),
    P("women-trousers", "Blush cuffed joggers", "Suruali laini za waridi", "Maison Pwani", ("1594633312681-425c7b97ccd1",), 52000,
      "Polished comfort", "<p>Soft twill joggers with patch pockets and cuffed ankles.</p>",
      colours=(("Blush", "#E7B9A9"), ("Olive", "#6B6B47")), sizes=W_SIZES,
      attributes={"occasion": ["everyday"], "material": ["cotton"], "rise": "high", "leg": "tapered", "length": "cropped"},
      materials="98% cotton, 2% elastane", care="Machine wash 30°C.", fit_note="true", alt="Model in blush cuffed joggers"),
    P("women-jeans", "High-rise straight jeans", "Jinzi zilizonyooka", "Dar Denim Works", ("1598554747436-c9293d6a588f",), 88000,
      "Organic denim, perfect straight leg", "<p>A vintage-inspired straight leg in rigid organic denim that softens with wear.</p>",
      colours=(("Mid wash", "#6F8CB4"),), sizes=JEANS_W,
      attributes={"occasion": ["everyday"], "material": ["denim"], "rise": "high", "leg": "straight", "wash": "mid"},
      materials="100% organic cotton denim, 13oz", care="Wash rarely, cold, inside out.", fit_note="small", badges=("bestseller",), tags=("denim",), alt="Model in high-rise straight jeans"),
    P("women-jumpsuits", "Olive utility playsuit", "Playsuit ya kijani", "Maison Pwani", ("1618932260643-eee4a2f652a6",), 64000,
      "Belted, buttoned, done", "<p>A strappy belted playsuit in washed olive twill.</p>",
      colours=(("Olive", "#4E5A3A"),), sizes=W_SIZES,
      attributes={"occasion": ["everyday", "vacation"], "material": ["cotton"], "neckline": "square", "sleeve": "sleeveless", "length": "mini"},
      materials="100% cotton twill", care="Machine wash 30°C.", fit_note="true", alt="Olive belted playsuit"),
    P("women-knitwear", "Fringed crochet poncho", "Poncho ya kufuma", "Kanga House", ("1434389677669-e08b4cac3105",), 58000,
      "Hand-crocheted in Bagamoyo", "<p>An open-weave poncho finished with a hand-knotted fringe.</p>",
      colours=(("Cream", "#EEE6D6"),), sizes=ONE,
      attributes={"occasion": ["vacation", "everyday"], "material": ["cotton", "knit"], "pattern": "solid"},
      materials="100% cotton yarn", care="Hand wash cold, dry flat.", badges=("made-in-tz",), story="Each poncho takes our Bagamoyo collective around two days to crochet.", alt="Cream crochet poncho on a hanger"),
    P("women-knitwear", "Colour-block knit sweater", "Sweta ya rangi mbili", "Kilele Studio", ("1475180098004-ca77a66827be",), 72000,
      "For cool Arusha evenings", "<p>A chunky crew-neck in a bold colour-block intarsia.</p>",
      colours=(("Rust & ivory", "#B5683A"),), sizes=W_SIZES,
      attributes={"occasion": ["everyday"], "material": ["wool", "knit"], "neckline": "crew", "sleeve": "long", "season": "cool"},
      materials="60% wool, 40% acrylic", care="Hand wash cold, dry flat.", fit_note="large", alt="Woman in a rust and ivory colour-block sweater"),
    P("women-jackets-coats", "Tartan wool coat", "Koti la sufu", "Atelier Msasani", ("1485968579580-b6d095142e6e",), 210000,
      "Travel-ready tailoring", "<p>A single-breasted, mid-length coat in a deep green tartan wool blend.</p>",
      colours=(("Forest tartan", "#23392F"),), sizes=W_SIZES,
      attributes={"occasion": ["work", "everyday"], "material": ["wool"], "pattern": "check", "fit": "tailored", "season": "cool"},
      materials="70% wool, 30% polyamide; viscose lining", care="Dry clean only.", fit_note="true", wholesale=False, alt="Woman in a green tartan wool coat"),
    P("women-jackets-coats", "Powder blue trench", "Koti la mvua la bluu", "Atelier Msasani", ("1539109136881-3be0616acf4b",), 165000,
      "Ready for the long rains", "<p>A water-repellent cotton trench with storm flaps and a removable belt.</p>",
      colours=(("Powder blue", "#A9C4DD"),), sizes=W_SIZES,
      attributes={"occasion": ["work", "everyday"], "material": ["cotton"], "fit": "relaxed", "season": "rainy"},
      materials="100% cotton gabardine, water-repellent finish", care="Dry clean.", fit_note="large", badges=("new",), alt="Woman in a powder blue trench coat"),
    # ---------------------------------------------------------------- men
    P("men-suits-blazers", "Navy tailored suit", "Suti ya bluu", "Kilele Studio", ("1617137968427-85924c800a22", "1617137984095-74e4e5e3613f"), 380000,
      "Half-canvas, made to move", "<p>A two-button, half-canvassed suit in a breathable tropical wool — jacket and trousers.</p>",
      colours=(("Navy", "#1E2A4A"),), sizes=SUIT_SIZES,
      attributes={"occasion": ["work", "wedding-guest"], "material": ["wool"], "lapel": "notch", "fit": "tailored"},
      materials="100% tropical wool, 230g", care="Dry clean only.", fit_note="true", featured=True, badges=("bestseller",), wholesale=False, alt="Man in a navy tailored suit"),
    P("men-suits-blazers", "Charcoal pinstripe suit", "Suti ya kijivu yenye mistari", "Kilele Studio", ("1507679799987-c73779587ccf",), 420000,
      "The boardroom classic", "<p>A peak-lapel, double-vented suit in a fine charcoal pinstripe.</p>",
      colours=(("Charcoal", "#2D2F33"),), sizes=SUIT_SIZES,
      attributes={"occasion": ["work"], "material": ["wool"], "lapel": "peak", "fit": "slim", "pattern": "stripe"},
      materials="100% wool", care="Dry clean only.", fit_note="small", wholesale=False, alt="Man buttoning a charcoal pinstripe suit"),
    P("men-shirts", "Chambray dot shirt", "Shati la chambray", "Kilele Studio", ("1596755094514-f87e34085b2c",), 54000,
      "Smart without trying", "<p>A soft chambray shirt with a micro-dot print and a button-down collar.</p>",
      colours=(("Chambray", "#5D7A99"),), sizes=M_SIZES,
      attributes={"occasion": ["work", "everyday"], "material": ["cotton"], "fit": "regular", "pattern": "polka"},
      materials="100% cotton chambray", care="Machine wash 40°C.", fit_note="true", alt="Chambray dot shirt on a hanger"),
    P("men-shirts", "Everyday oxford shirt", "Shati la oxford", "Kilele Studio", ("1602810318383-e386cc2a3ccf",), 49000,
      "Three colours, endless outfits", "<p>A garment-washed oxford shirt that gets better with every wear.</p>",
      colours=(("White", "#F4F4F2"), ("Plum", "#5C2A42"), ("Slate", "#4F5866")), sizes=M_SIZES,
      attributes={"occasion": ["work", "everyday"], "material": ["cotton"], "fit": "slim"},
      materials="100% cotton oxford", care="Machine wash 40°C.", fit_note="true", badges=("bestseller",), alt="Folded oxford shirts on a wooden table"),
    P("men-t-shirts", "Essential heavyweight tee", "Fulana nzito", "Kilele Studio", ("1521572163474-6864f9cf17ab",), 28000,
      "The tee you'll buy in every colour", "<p>A 240g combed-cotton tee with a structured crew neck that doesn't stretch out.</p>",
      colours=(("White", "#FFFFFF"), ("Black", "#141414"), ("Stone", "#BDB4A6")), sizes=M_SIZES,
      attributes={"occasion": ["everyday"], "material": ["cotton"], "fit": "regular"},
      materials="100% combed cotton, 240gsm", care="Machine wash 30°C.", fit_note="true", tags=("basics",), alt="Man wearing a white heavyweight t-shirt"),
    P("men-jeans", "Selvedge slim jeans", "Jinzi za selvedge", "Dar Denim Works", ("1542272604-787c3835535d",), 115000,
      "Raw selvedge, made to fade", "<p>14oz raw selvedge denim in a slim, tapered leg.</p>",
      colours=(("Raw indigo", "#22304A"), ("Washed black", "#2A2A2C")), sizes=JEANS_M,
      attributes={"occasion": ["everyday"], "material": ["denim"], "leg": "tapered", "rise": "mid", "wash": "dark"},
      materials="100% cotton selvedge denim, 14oz", care="Wash as rarely as possible.", fit_note="true", tags=("denim",), alt="Folded raw and black selvedge jeans"),
    P("men-knitwear", "Pink crew knit", "Sweta ya waridi", "Kilele Studio", ("1516826957135-700dedea698c",), 66000,
      "Fine-gauge, all-season", "<p>A lightweight merino-blend crew neck in dusty pink.</p>",
      colours=(("Dusty pink", "#E7C9C9"),), sizes=M_SIZES,
      attributes={"occasion": ["everyday", "work"], "material": ["wool", "knit"], "fit": "regular"},
      materials="50% merino wool, 50% cotton", care="Hand wash cold.", fit_note="true", alt="Man in a dusty pink crew knit and light jeans"),
    P("men-jackets-coats", "Washed field jacket", "Jaketi la shambani", "Kilele Studio", ("1488161628813-04466f872be2",), 128000,
      "Four pockets, one jacket", "<p>A garment-dyed cotton field jacket with a corduroy collar.</p>",
      colours=(("Black", "#1A1A1A"),), sizes=M_SIZES,
      attributes={"occasion": ["everyday"], "material": ["cotton"], "fit": "relaxed"},
      materials="100% cotton canvas", care="Machine wash 30°C.", fit_note="large", alt="Man in a black field jacket sitting in a circular window"),
    # ---------------------------------------------------------------- kids
    P("kids-boys-shirts", "Little gent cardigan set", "Seti ya cardigan ya mvulana", "Mtoto Mdogo", ("1519238263530-99bdd11df2ea",), 42000,
      "Party-ready in seconds", "<p>A soft knit cardigan with a bow tie, paired with bright cotton shorts.</p>",
      colours=(("Navy & cobalt", "#1F3B73"),), sizes=KIDS,
      attributes={"occasion": ["party"], "material": ["cotton", "knit"]},
      materials="100% cotton", care="Machine wash 30°C.", fit_note="true", alt="Smiling boy in a navy cardigan and blue shorts"),
    P("kids-boys-shirts", "Weekend henley", "Shati la mapumziko la mtoto", "Mtoto Mdogo", ("1503944583220-79d8926ad5e2",), 24000,
      "Soft slub cotton for play", "<p>A long-sleeve henley in breathable slub jersey.</p>",
      colours=(("Oat", "#E6DDCC"),), sizes=KIDS,
      attributes={"occasion": ["everyday"], "material": ["cotton"]},
      materials="100% cotton", care="Machine wash 40°C.", fit_note="true", alt="Two children in casual tops in a park"),
    # ---------------------------------------------------------------- shoes
    P("shoes-women-heels", "Navy suede pumps", "Viatu virefu vya suede", "Savanna Leather Co.", ("1515347619252-60a4bf4fff4f",), 98000,
      "An 85mm heel you can wear all day", "<p>Classic pointed pumps in soft suede with a cushioned leather footbed.</p>",
      colours=(("Navy", "#1F2A44"), ("Black", "#111111")), sizes=SHOE_W,
      attributes={"occasion": ["work", "evening"], "heel_height": "high", "toe_shape": "pointed", "closure": "slip-on", "shoe_material": "suede"},
      materials="Suede upper, leather lining and sole", care="Brush with a suede brush. Use protector spray.", fit_note="true", alt="Hand holding navy suede pumps"),
    P("shoes-women-heels", "Bloom print stilettos", "Viatu vya maua", "Savanna Leather Co.", ("1543163521-1bf539c55dd2",), 112000,
      "Statement-making florals", "<p>Pointed stilettos in a printed satin with a 100mm heel.</p>",
      colours=(("Blue bloom", "#2F6FB3"),), sizes=SHOE_W,
      attributes={"occasion": ["party", "wedding-guest"], "heel_height": "high", "toe_shape": "pointed", "closure": "slip-on", "shoe_material": "synthetic"},
      materials="Printed satin upper, leather sole", care="Spot clean.", fit_note="small", badges=("limited",), alt="Floral print stilettos on a pale blue set"),
    P("shoes-men-formal", "Cognac leather brogues", "Viatu vya ngozi", "Savanna Leather Co.", ("1614252235316-8c857d38b5f4",), 145000,
      "Goodyear-welted, built to resole", "<p>Full-grain cognac brogues on a Goodyear-welted leather sole.</p>",
      colours=(("Cognac", "#8A4B22"),), sizes=SHOE_M,
      attributes={"occasion": ["work", "wedding-guest"], "toe_shape": "round", "closure": "lace-up", "shoe_material": "leather"},
      materials="Full-grain calf leather", care="Polish regularly; use shoe trees.", fit_note="true", featured=True, badges=("made-in-tz",), wholesale=False, alt="Close-up of cognac leather brogues"),
    P("shoes-women-sandals", "Cork footbed sandals", "Sandali za cork", "Savanna Leather Co.", ("1603487742131-4160ec999306",), 62000,
      "Moulds to your foot", "<p>Two-strap sandals with an anatomical cork footbed and buckles.</p>",
      colours=(("Taupe", "#B8AFA3"),), sizes=SHOE_W,
      attributes={"occasion": ["everyday", "vacation"], "heel_height": "flat", "toe_shape": "open", "closure": "buckle", "shoe_material": "suede"},
      materials="Suede straps, cork-latex footbed", care="Keep dry; brush suede.", fit_note="large", alt="Taupe two-strap cork sandals on a fur rug"),
    P("shoes-women-sneakers", "Cloud runner sneakers", "Raba nyepesi", "Savanna Leather Co.", ("1560769629-975ec94e6a86",), 89000,
      "Light, bright, bouncy", "<p>Mesh-and-suede runners on a responsive foam sole.</p>",
      colours=(("Pastel mix", "#E8DCD0"),), sizes=SHOE_W,
      attributes={"occasion": ["everyday", "sport"], "closure": "lace-up", "shoe_material": "knit", "heel_height": "flat"},
      materials="Mesh and suede upper, EVA sole", care="Wipe clean.", fit_note="true", badges=("new",), alt="Pastel running sneakers on a white plinth"),
    # ---------------------------------------------------------------- bags
    P("bags-handbags", "Coral top-handle bag", "Mkoba wa matumbawe", "Savanna Leather Co.", ("1584917865442-de89df76afd3",), 185000,
      "Structured, polished, iconic", "<p>A structured top-handle bag in smooth coral leather with a turn-lock and detachable strap.</p>",
      colours=(("Coral", "#D9472F"),), sizes=ONE,
      attributes={"bag_size": "medium", "closure": "magnetic", "strap": "top-handle", "bag_material": "leather"},
      materials="Full-grain leather; suede interior", care="Store in dust bag; condition twice a year.", featured=True, badges=("exclusive",), wholesale=False, alt="Coral leather top-handle bag on a plinth"),
    P("bags-handbags", "Wicker & leather basket bag", "Mkoba wa ukili", "Kanga House", ("1590874103328-eac38a683ce7",), 96000,
      "Woven by hand in Tanga", "<p>A hand-woven wicker body with a tan leather flap and handle.</p>",
      colours=(("Natural tan", "#C88752"),), sizes=ONE,
      attributes={"bag_size": "medium", "closure": "magnetic", "strap": "top-handle", "bag_material": "straw"},
      materials="Wicker, vegetable-tanned leather", care="Keep dry; wipe leather with a damp cloth.", badges=("made-in-tz",), story="Woven by a women's cooperative in Tanga.", alt="Wicker and tan leather basket bag"),
    P("bags-totes", "Canvas market tote", "Mfuko wa sokoni", "Kanga House", ("1544816155-12df9643f363",), 35000,
      "Carries everything, folds flat", "<p>A heavyweight organic canvas tote with long handles and an inner pocket.</p>",
      colours=(("Kraft", "#B89468"),), sizes=ONE,
      attributes={"bag_size": "large", "strap": "shoulder", "bag_material": "canvas"},
      materials="100% organic cotton canvas, 16oz", care="Spot clean.", tags=("eco",), alt="Kraft canvas tote bag against a grey wall"),
    P("bags-handbags", "Botanical print satchel", "Mkoba wenye michoro ya maua", "Savanna Leather Co.", ("1591561954557-26941169b49e",), 158000,
      "Garden party, carried", "<p>A trapeze satchel in printed leather with a gold-tone clasp.</p>",
      colours=(("Botanical", "#D8B9A0"),), sizes=ONE,
      attributes={"bag_size": "medium", "closure": "magnetic", "strap": "top-handle", "bag_material": "leather"},
      materials="Printed leather", care="Store stuffed in dust bag.", badges=("limited",), wholesale=False, alt="Botanical print leather satchel"),
    P("bags-backpacks", "City commuter backpack", "Begi la mgongoni", "Savanna Leather Co.", ("1553062407-98eeb64c6a62",), 74000,
      "Fits a 15\" laptop", "<p>A water-resistant recycled-nylon backpack with a padded laptop sleeve.</p>",
      colours=(("Navy", "#1E2B44"),), sizes=ONE,
      attributes={"bag_size": "large", "closure": "zip", "strap": "shoulder", "bag_material": "canvas"},
      materials="Recycled nylon; leather trims", care="Wipe clean.", alt="Navy backpack on a light floor"),
    # ---------------------------------------------------------------- accessories
    P("accessories-sunglasses", "Round wire sunglasses", "Miwani ya jua ya duara", "Upepo Eyewear", ("1511499767150-a48a237f0083",), 46000,
      "UV400, featherlight", "<p>Round titanium-alloy frames with green-tinted UV400 lenses.</p>",
      colours=(("Gold / green", "#B8955A"),), sizes=ONE,
      attributes={"frame_shape": "round"},
      materials="Titanium alloy frame, CR-39 lenses", care="Clean with the microfibre case.", alt="Round gold wire sunglasses on a white surface"),
    P("accessories-belts", "Tan leather belt", "Mkanda wa ngozi", "Savanna Leather Co.", ("1624222247344-550fb60583dc",), 38000,
      "One piece of leather, no seams", "<p>A 35mm belt cut from a single piece of vegetable-tanned leather with a brushed steel buckle.</p>",
      colours=(("Tan", "#9A5B2E"),), sizes=("85", "90", "95", "100"),
      attributes={},
      materials="Vegetable-tanned leather, steel buckle", care="Condition occasionally.", badges=("made-in-tz",), alt="Close-up of a tan leather belt and buckle"),
    # ---------------------------------------------------------------- jewellery & watches
    P("jewellery-necklaces", "Freshwater pearl strand", "Mkufu wa lulu", "Zanzi Gold", ("1515562141207-7a88fb7ce338",), 165000,
      "A forever piece", "<p>Hand-knotted freshwater pearls on silk with an 18k gold-plated clasp.</p>",
      colours=(("Ivory pearl", "#F2EDE4"),), sizes=("40 cm", "45 cm"),
      attributes={"metal": "gold-plated", "stone": "pearl", "jewellery_style": "classic"},
      materials="Freshwater pearls, silk thread, 18k gold-plated brass", care="Store flat; keep away from perfume.", wholesale=False, alt="Pearl necklace in a red jewellery box"),
    P("jewellery-earrings", "Tanzanite drop earrings", "Hereni za tanzanite", "Zanzi Gold", ("1535632066927-ab7c9ab60908",), 320000,
      "Our birthstone, set in silver", "<p>Art-deco drops set with blue tanzanite and white topaz in sterling silver.</p>",
      colours=(("Silver / tanzanite", "#3D4FA0"),), sizes=ONE,
      attributes={"metal": "silver", "stone": "tanzanite", "jewellery_style": "statement"},
      materials="Sterling silver, tanzanite, white topaz", care="Polish with a soft cloth.", badges=("exclusive", "made-in-tz"), featured=True, wholesale=False,
      story="Tanzanite is found in only one place on earth — the foothills of Kilimanjaro.", alt="Tanzanite drop earrings on a monstera leaf"),
    P("jewellery-necklaces", "Crescent layered necklace", "Mkufu wa mwezi", "Zanzi Gold", ("1599643478518-a784e5dc4c8f",), 78000,
      "Two chains, one clasp", "<p>A layered pair: a crescent moon pendant and a faceted teal stone.</p>",
      colours=(("Gold", "#C9A45C"),), sizes=ONE,
      attributes={"metal": "gold-plated", "stone": "gemstone", "jewellery_style": "minimal"},
      materials="18k gold-plated brass, glass stone", care="Avoid water.", alt="Layered gold crescent necklace"),
    P("watches-women", "Minimal leather watch", "Saa ya ngozi", "Zanzi Gold", ("1524592094714-0f0654e20314",), 135000,
      "36mm, quiet and precise", "<p>A slim 36mm quartz watch with a white dial and tan leather strap.</p>",
      colours=(("Silver / tan", "#B9B9B9"),), sizes=ONE,
      attributes={"movement": "quartz", "strap_material": "leather", "case_size": "36mm", "water_resistance": "30m"},
      materials="Stainless steel case, sapphire-coated glass, leather strap", care="Avoid swimming.", alt="Hand holding a minimal watch with tan strap"),
    P("watches-smart", "Pulse smart watch", "Saa janja Pulse", "Upepo Eyewear", ("1523275335684-37898b6baf30",), 215000,
      "Health, sleep and payments", "<p>An AMOLED smart watch with heart-rate, sleep and 7-day battery.</p>",
      colours=(("White", "#EDEDED"),), sizes=ONE,
      attributes={"movement": "smart", "strap_material": "silicone", "water_resistance": "50m"},
      materials="Aluminium case, silicone strap", care="Rinse after sport.", wholesale=False, alt="White smart watch on a grey background"),
    # ---------------------------------------------------------------- beauty
    P("makeup-lips", "Velvet matte lipstick", "Rangi ya mdomo matte", "Nuru Beauty", ("1625093742435-6fa192b6fb10",), 32000,
      "Twelve-hour colour that feels like nothing", "<p>A creamy matte with shea and vitamin E, formulated and shade-tested on deep skin tones.</p>",
      shades=(("Mahogany", "#6B2A2A"), ("Rose petal", "#B5606A"), ("Cinnamon", "#8B4A34"), ("Ruby", "#9E1B32")),
      attributes={"finish": "matte"},
      materials="Ingredients: Ricinus communis seed oil, Butyrospermum parkii butter, Tocopherol, …", care="Store below 30°C.", badges=("clean-beauty",), featured=True,
      beauty={"skinTypes": [], "finish": "matte", "ingredients": "Ricinus Communis (Castor) Seed Oil, Butyrospermum Parkii (Shea) Butter, Candelilla Cera, Tocopherol, Iron Oxides (CI 77491, CI 77492, CI 77499).", "volume": "3.5 g", "paoMonths": 18, "crueltyFree": True, "vegan": True},
      alt="Rose lipstick on a white surface"),
    P("makeup-eyes", "Lift & define mascara", "Mascara ya kurefusha", "Nuru Beauty", ("1631214540553-ff044a3ff1d4",), 29000,
      "Length without clumps", "<p>A tubing mascara that lifts, lengthens and washes off with warm water.</p>",
      shades=(("Jet black", "#0A0A0A"), ("Brown black", "#2B1C14")),
      attributes={},
      care="Replace every 6 months.", badges=("new",),
      beauty={"skinTypes": ["sensitive"], "finish": None, "ingredients": "Aqua, Acrylates Copolymer, Cera Alba, Iron Oxides (CI 77499).", "volume": "8 ml", "paoMonths": 6, "crueltyFree": True, "vegan": False},
      alt="Mascara wand on a pink background"),
    P("skincare-serums", "Vitamin C glow serum", "Serum ya vitamini C", "Baobab Botanics", ("1608571423902-eed4a5ad8108",), 58000,
      "Brighter in two weeks", "<p>15% stabilised vitamin C with baobab oil and ferulic acid to even tone and fade dark spots.</p>",
      volumes=("30 ml", "50 ml"),
      attributes={"skin_type": ["normal", "combination", "oily"], "skin_concern": ["hyperpigmentation", "dullness"], "key_ingredient": ["vitamin-c"], "formulation": "serum"},
      care="Store away from light. Use SPF in the morning.", badges=("clean-beauty", "bestseller"), featured=True,
      beauty={"skinTypes": ["normal", "combination", "oily"], "finish": None, "ingredients": "Aqua, Ascorbic Acid (15%), Adansonia Digitata (Baobab) Seed Oil, Ferulic Acid, Tocopherol, Glycerin.", "volume": "30 ml", "paoMonths": 6, "crueltyFree": True, "vegan": True},
      alt="Amber serum bottle on a turned wooden stand"),
    P("skincare-serums", "Baobab & moringa face oil", "Mafuta ya uso ya mbuyu", "Baobab Botanics", ("1617897903246-719242758050",), 46000,
      "Overnight nourishment", "<p>A cold-pressed blend of baobab, moringa and marula oils for deep, non-greasy moisture.</p>",
      volumes=("30 ml",),
      attributes={"skin_type": ["dry", "normal"], "skin_concern": ["dryness", "ageing"], "formulation": "oil"},
      care="Store below 25°C.", badges=("made-in-tz", "clean-beauty"),
      beauty={"skinTypes": ["dry", "normal"], "finish": None, "ingredients": "Adansonia Digitata Seed Oil, Moringa Oleifera Seed Oil, Sclerocarya Birrea Seed Oil, Tocopherol.", "volume": "30 ml", "paoMonths": 12, "crueltyFree": True, "vegan": True},
      alt="Dropper bottle of face oil on a wooden board with eucalyptus"),
    P("skincare-moisturisers", "Daily hydration ritual", "Seti ya unyevu wa kila siku", "Baobab Botanics", ("1631729371254-42c2892f0e6e",), 89000,
      "Cleanse, tone, moisturise", "<p>A three-step set with a gentle gel cleanser, hydrating toner and a lightweight hyaluronic moisturiser.</p>",
      volumes=("Full size", "Travel size"),
      attributes={"skin_type": ["normal", "combination", "sensitive"], "skin_concern": ["dryness"], "key_ingredient": ["hyaluronic", "niacinamide"], "formulation": "gel"},
      care="Store away from direct sun.",
      beauty={"skinTypes": ["normal", "combination", "sensitive"], "finish": None, "ingredients": "See each product for full INCI.", "volume": "3 × 100 ml", "paoMonths": 12, "crueltyFree": True, "vegan": True},
      alt="Three white skincare bottles on a table"),
    P("skincare-cleansers", "Shea cream cleanser", "Kisafishaji cha shea", "Baobab Botanics", ("1601049676869-702ea24cfd58",), 34000,
      "Melts make-up, never strips", "<p>A cushiony cream cleanser with East African shea butter and oat.</p>",
      volumes=("150 ml",),
      attributes={"skin_type": ["dry", "sensitive", "normal"], "key_ingredient": ["shea"], "formulation": "cream"},
      care="Avoid eyes.", badges=("clean-beauty",),
      beauty={"skinTypes": ["dry", "sensitive", "normal"], "finish": None, "ingredients": "Aqua, Butyrospermum Parkii Butter, Avena Sativa Kernel Flour, Glycerin, Cetearyl Alcohol.", "volume": "150 ml", "paoMonths": 12, "crueltyFree": True, "vegan": True},
      alt="Skincare bottles with cotton on a peach background"),
    P("fragrance-oud-attar", "Amber oud eau de parfum", "Manukato ya udi na kaharabu", "Oud & Ember", ("1588405748880-12d1d2a59f75",), 155000,
      "Warm, smoky, unforgettable", "<p>Cambodian oud wrapped in amber, saffron and a whisper of rose. Lasts all evening.</p>",
      volumes=("50 ml", "100 ml"),
      attributes={"scent_family": ["oud", "oriental"], "concentration": "edp"},
      care="Store in a cool, dark place.", featured=True, badges=("exclusive",),
      beauty={"skinTypes": [], "finish": None, "ingredients": "Alcohol Denat., Parfum, Aqua, Linalool, Limonene, Citronellol, Geraniol.", "volume": "50 ml", "paoMonths": 36, "crueltyFree": True, "vegan": False},
      alt="Amber perfume bottle on soft linen in warm light"),
    P("nails-polish", "Gel-effect nail colour", "Rangi ya kucha", "Nuru Beauty", ("1604654894610-df63bc536371",), 18000,
      "Salon shine, no lamp", "<p>A 10-free formula with a gel-like finish that lasts up to 10 days.</p>",
      shades=(("Espresso", "#3B2318"), ("Nude caramel", "#B7835E"), ("Onyx", "#111111"), ("Bordeaux", "#5C1525")),
      attributes={},
      care="Shake before use.",
      beauty={"skinTypes": [], "finish": "glossy", "ingredients": "Butyl Acetate, Ethyl Acetate, Nitrocellulose, Acetyl Tributyl Citrate.", "volume": "12 ml", "paoMonths": 24, "crueltyFree": True, "vegan": True},
      alt="Hand with dark brown and gold nail art against a grey knit"),
)

# Editorial images (hero banners, looks, stories, collection covers). All unbranded.
EDITORIAL = {
    "hero-shopping": "1483985988355-763728e1935b",
    "hero-rack": "1490481651871-ab68de25d43d",
    "hero-african": "1531123897727-8f129e1688ce",
    "rack-neutral": "1558769132-cb1aea458c5e",
    "rack-colour": "1601924994987-69e26d50dc26",
    "rack-studio": "1551232864-3f0890e580d9",
    "beauty-face": "1590735213920-68192a487bc2",
    "beauty-eye": "1487412947147-5cebf100ffc2",
    "beauty-flatlay": "1596462502278-27bfdc403348",
    "skincare-stones": "1612817288484-6f916006741a",
    "look-floral": "1581044777550-4cfa60707c03",
    "look-coat": "1539109136881-3be0616acf4b",
    "look-men": "1488161628813-04466f872be2",
    "look-sweater": "1475180098004-ca77a66827be",
    "look-denim": "1516826957135-700dedea698c",
    "look-stairs": "1515372039744-b8f02a3ae446",
}

STORES = (
    {"code": "masaki", "name": "SmartWear Masaki", "kind": "store", "address": "Haile Selassie Rd, Masaki", "area": "Masaki", "lat": -6.7486, "lng": 39.2789, "phone": "+255754100001"},
    {"code": "mlimani", "name": "SmartWear Mlimani City", "kind": "store", "address": "Mlimani City Mall, Sam Nujoma Rd", "area": "Ubungo", "lat": -6.7722, "lng": 39.2213, "phone": "+255754100002"},
    {"code": "kariakoo", "name": "SmartWear Kariakoo", "kind": "store", "address": "Msimbazi St, Kariakoo", "area": "Kariakoo", "lat": -6.8183, "lng": 39.2733, "phone": "+255754100003"},
    {"code": "mbezi", "name": "SmartWear Mbezi Beach", "kind": "store", "address": "Bagamoyo Rd, Mbezi Beach", "area": "Mbezi Beach", "lat": -6.7262, "lng": 39.2135, "phone": "+255754100004"},
    {"code": "kurasini-wh", "name": "Kurasini Warehouse", "kind": "warehouse", "address": "Kurasini Industrial Area", "area": "Kurasini", "lat": -6.8550, "lng": 39.2900, "phone": "+255754100005", "allows_pickup": False},
)

RIDERS = (
    {"phone": "+255754000101", "name": "Juma Mwinyi", "vehicle": "MOTORBIKE", "plate": "MC 482 DKT", "color": "Red", "make": "TVS HLX 150", "store": "masaki"},
    {"phone": "+255754000102", "name": "Halima Said", "vehicle": "MOTORBIKE", "plate": "MC 219 EAZ", "color": "Black", "make": "Bajaj Boxer", "store": "mlimani"},
    {"phone": "+255754000103", "name": "Baraka Mollel", "vehicle": "BICYCLE", "plate": "", "color": "Blue", "make": "Phoenix", "store": "kariakoo"},
)
