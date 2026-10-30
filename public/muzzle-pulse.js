// A short time-based pulse, with one guaranteed presentation frame for a new shot.
export function createMuzzlePulse(durationMs=32){
  let until=-Infinity,fresh=false;
  return {trigger(now,duration=durationMs){if(Number.isFinite(now)){until=now+(Number.isFinite(duration)&&duration>0&&duration<=100?duration:durationMs);fresh=true;}},
    sample(now){const visible=fresh||now<until;fresh=false;return visible;},reset(){until=-Infinity;fresh=false;}};
}
