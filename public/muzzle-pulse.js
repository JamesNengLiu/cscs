// A short time-based pulse, with one guaranteed presentation frame for a new shot.
export function createMuzzlePulse(durationMs=32){
  let until=-Infinity,fresh=false;
  return {trigger(now){if(Number.isFinite(now)){until=now+durationMs;fresh=true;}},
    sample(now){const visible=fresh||now<until;fresh=false;return visible;},reset(){until=-Infinity;fresh=false;}};
}
