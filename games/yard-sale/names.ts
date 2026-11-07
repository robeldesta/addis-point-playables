// Endless random racer names built from syllables, plus a flag.
const F1 = ["Ka", "Lu", "Mi", "Sven", "Bo", "An", "Ri", "Ta", "Jo", "El", "Mar", "Ni", "Da", "Fre", "Ha", "Ke", "Ola", "Pe", "Sa", "Yu", "Zo", "Ib", "Ar", "Ve", "Li", "To", "Ma", "Ru", "Ce", "Ge"];
const F2 = ["", "ra", "na", "ko", "lin", "ja", "ro", "via", "to", "mi", "lo", "rik", "ne", "sa", "ki", "da", "len", "ri", "us", "ta"];
const L1 = ["Berg", "Frost", "Kal", "Mor", "Sten", "Val", "Hol", "Nord", "Bran", "Ost", "Lind", "Kov", "Tor", "Dal", "Wint", "Grau", "Ise", "Rav", "Sol", "Fje", "Ber", "Mak", "Tan", "Abe", "Oka", "Dub", "Mon", "Rei", "Sch", "Pel"];
const L2 = ["man", "sen", "ov", "ström", "berg", "ski", "ner", "ez", "ek", "dal", "hoff", "aro", "ini", "ovic", "uchi", "lund", "rup", "ard", "ino", "son", "ler", "ova", "ten", "mura", "ace"];
const FLAGS = ["🇳🇴", "🇸🇪", "🇫🇮", "🇦🇹", "🇨🇭", "🇫🇷", "🇮🇹", "🇩🇪", "🇺🇸", "🇨🇦", "🇯🇵", "🇰🇷", "🇸🇮", "🇵🇱", "🇨🇿", "🇸🇰", "🇪🇸", "🇬🇧", "🇳🇿", "🇦🇺", "🇪🇹", "🇰🇪", "🇦🇷", "🇨🇱", "🇧🇷", "🇮🇸", "🇨🇳", "🇮🇳", "🇺🇦", "🇧🇬"];

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function randomName(): { name: string; short: string; flag: string } {
  const first = cap(pick(F1) + pick(F2));
  const last = cap(pick(L1) + pick(L2));
  return { name: `${first} ${last}`, short: `${first.charAt(0)}. ${last}`, flag: pick(FLAGS) };
}

const SUITS = [0x1e88e5, 0x43a047, 0x8e24aa, 0xfb8c00, 0x00acc1, 0xd81b60, 0x3949ab, 0x6d4c41, 0x00897b, 0xc0ca33, 0x5e35b1, 0x546e7a];
export const randomSuit = () => pick(SUITS);
