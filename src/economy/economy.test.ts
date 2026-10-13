import { describe, expect, it } from 'vitest';
import { ECONOMY, Economy, euros, PRODUCTS } from './economy';

describe('economy', () => {
  it('gets hungry and thirsty as time passes, thirst faster', () => {
    const e = new Economy();
    e.hunger = e.thirst = 100;
    e.update(ECONOMY.thirstMinutes * 60);
    expect(e.thirst).toBe(0);
    expect(e.hunger).toBeGreaterThan(30);
    expect(e.starving).toBe(true);
  });

  it('buys into the pantry and eats from it', () => {
    const e = new Economy();
    e.pantry.fill(null);
    e.hunger = 50;
    expect(e.buy('bread')).toBe('ok');
    expect(e.money).toBeCloseTo(ECONOMY.startMoney - PRODUCTS.bread.price);
    expect(e.pantry[0]).toBe('bread');
    expect(e.consume(0)).toBe('bread');
    expect(e.hunger).toBe(50 + PRODUCTS.bread.food);
    expect(e.pantry[0]).toBeNull();
    expect(e.consume(0)).toBeUndefined();
  });

  it('refuses without money or room, and never goes over full', () => {
    const e = new Economy();
    e.money = 0.5;
    expect(e.buy('water')).toBe('no money'); // € 0.79
    expect(e.money).toBe(0.5);
    e.money = 100;
    e.pantry.fill('apple');
    expect(e.buy('water')).toBe('pantry full');
    e.thirst = 95;
    e.consume(0);
    e.pantry[0] = 'water';
    e.consume(0);
    expect(e.thirst).toBe(100);
  });

  it('pays only what is there (fuel), in cents', () => {
    const e = new Economy();
    e.money = 10;
    expect(e.pay(3.333)).toBeCloseTo(3.333);
    expect(e.money).toBe(6.67);
    expect(e.pay(50)).toBe(6.67);
    expect(e.money).toBe(0);
    expect(euros(1.5)).toBe('€ 1.50');
  });

  it('restores a saved state, ignoring nonsense', () => {
    const e = new Economy();
    e.state = { money: 42, hunger: 300, thirst: -5, pantry: ['milk', 'pizza' as never, null] };
    expect(e.money).toBe(42);
    expect(e.hunger).toBe(100);
    expect(e.thirst).toBe(0);
    expect(e.pantry.slice(0, 3)).toEqual(['milk', null, null]);
    expect(e.pantry).toHaveLength(ECONOMY.pantrySlots);
  });
});
