import { PIECES } from '../core/state';

class XorShift32 {
  state: number;
  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x6d2b79f5;
  }
  nextUint() {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }
  next() {
    return this.nextUint() / 0x100000000;
  }
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}

class PieceRandomizer {
  [key: string]: any;
  constructor(seed: number, type: 'calm' | 'bag7' | 'bag14', avoidFirst = false) {
    this.rng = new XorShift32(seed);
    this.type = type;
    this.avoidFirst = avoidFirst;
    this.queue = [];
    this.firstBag = true;
  }
  refill() {
    if (this.type === 'bag14') {
      this.queue.push(...this.rng.shuffle([...PIECES, ...PIECES]));
    } else {
      const bag = this.rng.shuffle([...PIECES]);
      if ((this.type === 'calm' || this.avoidFirst) && this.firstBag && ['S', 'Z', 'O'].includes(bag[0])) {
        const index = bag.findIndex((p) => ['I', 'J', 'L', 'T'].includes(p));
        [bag[0], bag[index]] = [bag[index], bag[0]];
      }
      this.queue.push(...bag);
    }
    this.firstBag = false;
  }
  ensure(count) {
    while (this.queue.length < count) this.refill();
  }
  next() {
    this.ensure(1);
    return this.queue.shift();
  }
  peek(count) {
    this.ensure(count);
    return this.queue.slice(0, count);
  }
}

export { PieceRandomizer, XorShift32 };
