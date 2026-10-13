// Money, hunger and thirst, and the food on board. Pure (no three.js), saved between visits.
//
// Hunger and thirst are "how full" (100 = full, 0 = starving / parched) and drop as time passes,
// thirst faster. Food and drinks are bought in the village supermarkets (they go into the pantry
// on the boat) and eaten or drunk from there. Fuel costs money too.

export type ProductId = 'water' | 'juice' | 'milk' | 'apple' | 'orange' | 'pear' | 'banana' | 'bread' | 'rolls' | 'chocolate';

export interface Product {
  id: ProductId;
  name: string;
  /** euros */
  price: number;
  /** how much of the hunger / thirst bar it fills (of 100) */
  food: number;
  drink: number;
}

export const PRODUCTS: Record<ProductId, Product> = {
  water: { id: 'water', name: 'Water 1.5 L', price: 0.79, food: 0, drink: 35 },
  juice: { id: 'juice', name: 'Orange juice 1 L', price: 1.89, food: 6, drink: 28 },
  milk: { id: 'milk', name: 'Milk 1 L', price: 1.15, food: 10, drink: 22 },
  apple: { id: 'apple', name: 'Apple', price: 0.4, food: 7, drink: 4 },
  orange: { id: 'orange', name: 'Orange', price: 0.5, food: 6, drink: 6 },
  pear: { id: 'pear', name: 'Pear', price: 0.45, food: 7, drink: 4 },
  banana: { id: 'banana', name: 'Banana', price: 0.3, food: 9, drink: 0 },
  bread: { id: 'bread', name: 'Bread', price: 2.2, food: 35, drink: 0 },
  rolls: { id: 'rolls', name: 'Rolls (4)', price: 1.6, food: 22, drink: 0 },
  chocolate: { id: 'chocolate', name: 'Chocolate', price: 1.29, food: 12, drink: 0 },
};

export const ECONOMY = {
  startMoney: 150,
  /** euros per litre of diesel at the fuel berths */
  fuelPrice: 1.95,
  /** minutes from full to empty */
  hungerMinutes: 80,
  thirstMinutes: 50,
  pantrySlots: 12,
  /** below this a bar warns (and the HUD says so once) */
  low: 25,
};

export type BuyResult = 'ok' | 'no money' | 'pantry full';

export interface EconomyState {
  money: number;
  hunger: number;
  thirst: number;
  pantry: Array<ProductId | null>;
}

export class Economy {
  money = ECONOMY.startMoney;
  hunger = 70;
  thirst = 75;
  /** what lies on the boat's pantry shelf, slot by slot */
  pantry: Array<ProductId | null> = new Array(ECONOMY.pantrySlots).fill(null);

  constructor() {
    // Something on board to start with: a bottle of water and an apple.
    this.pantry[0] = 'water';
    this.pantry[1] = 'apple';
  }

  /** Time passes (seconds of game time). */
  update(dt: number): void {
    this.hunger = Math.max(0, this.hunger - (dt * 100) / (ECONOMY.hungerMinutes * 60));
    this.thirst = Math.max(0, this.thirst - (dt * 100) / (ECONOMY.thirstMinutes * 60));
  }

  get starving(): boolean {
    return this.hunger <= 0 || this.thirst <= 0;
  }

  /** Buys a product into the first free pantry slot. */
  buy(id: ProductId): BuyResult {
    const price = PRODUCTS[id].price;
    if (this.money < price - 1e-9) return 'no money';
    const slot = this.pantry.indexOf(null);
    if (slot < 0) return 'pantry full';
    this.money = round(this.money - price);
    this.pantry[slot] = id;
    return 'ok';
  }

  /** Eats or drinks what lies in a pantry slot; returns it (undefined if the slot is empty). */
  consume(slot: number): ProductId | undefined {
    const id = this.pantry[slot];
    if (!id) return undefined;
    this.pantry[slot] = null;
    const p = PRODUCTS[id];
    this.hunger = Math.min(100, this.hunger + p.food);
    this.thirst = Math.min(100, this.thirst + p.drink);
    return id;
  }

  /** Pays up to `amount` euros; returns what was actually paid (less when the money runs out). */
  pay(amount: number): number {
    const paid = Math.min(this.money, Math.max(0, amount));
    this.money = round(this.money - paid);
    return paid;
  }

  get state(): EconomyState {
    return { money: this.money, hunger: this.hunger, thirst: this.thirst, pantry: [...this.pantry] };
  }

  set state(s: EconomyState) {
    const num = (v: unknown, fallback: number, max = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : fallback);
    this.money = num(s.money, ECONOMY.startMoney);
    this.hunger = num(s.hunger, 70, 100);
    this.thirst = num(s.thirst, 75, 100);
    const pantry = Array.isArray(s.pantry) ? s.pantry : [];
    this.pantry = Array.from({ length: ECONOMY.pantrySlots }, (_, i) => (typeof pantry[i] === 'string' && pantry[i]! in PRODUCTS ? pantry[i] : null));
  }
}

/** Euros with cents, the way a price tag shows them: "€ 1.29". */
export function euros(amount: number): string {
  return `€ ${amount.toFixed(2)}`;
}

/** Money is kept in whole cents. */
function round(v: number): number {
  return Math.round(v * 100) / 100;
}
