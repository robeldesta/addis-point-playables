// The AI computer's books: every bag of feed and every egg in and out, and who did what.
// Rows are what a database table would hold; the camera column says whether a camera confirmed it.

export interface FeedRow {
  id: number;
  t: number; // sim minute
  type: "Delivery" | "Issued" | "Taken, not booked";
  bags: number; // + in, - out
  by: string;
  note: string;
  book: number; // stock by the books after this row
  camera: boolean;
}

export interface EggRow {
  id: number;
  t: number;
  type: "Counted at table" | "Picked up" | "Missing";
  eggs: number; // + into store, - out
  crates: number;
  by: string;
  note: string;
  store: number; // eggs in the store after this row
  camera: boolean;
}

export interface LitterRow {
  id: number;
  t: number;
  type: "Weighed out" | "Issued to fertilizer";
  kg: number; // + into the litter store, - out to production
  sacks: number;
  by: string;
  note: string; // where it came from, or the fertilizer batch
  store: number; // kg waiting in the litter store after this row
  camera: boolean;
}

export interface Kpi {
  eggs: number; // eggs collected from nests
  trips: number; // trips to the egg table
  feeders: number; // feeders filled
  bags: number; // feed bags taken from the store
  drinkers: number; // drinkers checked
  checked: number; // hens examined
  treated: number;
  removed: number; // dead hens taken out
  raked: number; // wet patches raked
  sacks: number; // litter sacks weighed out
  kg: number; // litter kg weighed out
  metres: number; // distance walked
  response: number[]; // minutes from AI alert to the vet arriving
}
export const emptyKpi = (): Kpi => ({ eggs: 0, trips: 0, feeders: 0, bags: 0, drinkers: 0, checked: 0, treated: 0, removed: 0, raked: 0, sacks: 0, kg: 0, metres: 0, response: [] });

export const CRATE = 360; // 12 trays of 30
export const BAG_KG = 50;
export const MANURE_KG = 0.1; // kg of manure each hen adds to the litter per day (estimate)

export class Records {
  feed: FeedRow[] = [];
  eggs: EggRow[] = [];
  kpi = new Map<number, Kpi>();
  kpiYesterday = new Map<number, Kpi>();
  book: number; // feed bags by the books
  store = 0; // eggs counted and waiting for pick-up
  private nextId = 1;
  feedUsedToday = 0; // bags issued today
  feedUsedYesterday = 0;
  litter: LitterRow[] = [];
  litterStore = 0; // kg weighed out, waiting for fertilizer production
  litterSacks = 0;
  litterInHouse = 3000; // kg of manure and bedding still on the floor (estimate)
  litterOutToday = 0;
  litterOutYesterday = 0;
  fertilizerTotal = 0; // kg issued to production since the start
  batches = 0;

  constructor(openingBags: number) {
    this.book = openingBags;
  }

  of(worker: number): Kpi {
    let k = this.kpi.get(worker);
    if (!k) { k = emptyKpi(); this.kpi.set(worker, k); }
    return k;
  }

  feedRow(t: number, type: FeedRow["type"], bags: number, by: string, note: string, camera: boolean): void {
    if (type !== "Taken, not booked") this.book += bags;
    if (type === "Issued") this.feedUsedToday -= bags;
    this.feed.unshift({ id: this.nextId++, t, type, bags, by, note, book: this.book, camera });
    if (this.feed.length > 300) this.feed.length = 300;
  }

  eggRow(t: number, type: EggRow["type"], eggs: number, by: string, note: string, camera: boolean): void {
    if (type !== "Missing") this.store += eggs;
    this.eggs.unshift({ id: this.nextId++, t, type, eggs, crates: Math.abs(eggs) / CRATE, by, note, store: this.store, camera });
    if (this.eggs.length > 300) this.eggs.length = 300;
  }

  litterRow(t: number, type: LitterRow["type"], kg: number, sacks: number, by: string, note: string, camera: boolean): void {
    this.litterStore = Math.max(0, this.litterStore + kg);
    this.litterSacks = Math.max(0, this.litterSacks + sacks);
    if (type === "Weighed out") { this.litterInHouse = Math.max(0, this.litterInHouse - kg); this.litterOutToday += kg; }
    else this.fertilizerTotal -= kg;
    this.litter.unshift({ id: this.nextId++, t, type, kg, sacks, by, note, store: this.litterStore, camera });
    if (this.litter.length > 300) this.litter.length = 300;
  }

  newDay(): void {
    this.litterOutYesterday = this.litterOutToday;
    this.litterOutToday = 0;
    this.kpiYesterday = this.kpi;
    this.kpi = new Map();
    this.feedUsedYesterday = this.feedUsedToday;
    this.feedUsedToday = 0;
  }
}
